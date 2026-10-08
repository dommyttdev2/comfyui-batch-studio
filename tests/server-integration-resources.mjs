import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resourceBindings } from '../dist-server/domain/resource-bindings.js';
import { loadConfig } from '../dist-server/server/config.js';
import { FileResources } from '../dist-server/server/file-resources.js';
import { IntegrationSettings } from '../dist-server/server/integration-settings.js';
import { ProjectApi } from '../dist-server/server/project-api.js';
import { ProjectResources } from '../dist-server/server/project-resources.js';
import { R2Service } from '../dist-server/server/r2-service.js';
import { Security } from '../dist-server/server/security.js';
import { startServer } from '../dist-server/server/server.js';
import { WorkflowApi } from '../dist-server/server/workflow-api.js';
import { token, writeAuth } from './server-fixtures.mjs';
import { projectFixture } from './server-project-fixtures.mjs';

const { artifacts } = createRequire(import.meta.url)('./core-support/artifact-fixtures.cjs');
async function setup({ wrongDirectory = false } = {}) {
  const f = await projectFixture();
  const modelRoot = await mkdtemp(path.join(os.tmpdir(), 'web-model-root-'));
  const { models, plan } = artifacts();
  let catalog = {
    ...models.catalog,
    collections: [
      {
        items: [models.checkpoint, ...models.loras].map((s) => ({
          ...s,
          modelType: s.ref.startsWith('lora.') ? 'LORA' : 'Checkpoint',
          versions: [
            {
              ...s,
              baseModel: 'Illustrious',
              files: [{ id: s.fileId, name: s.fileName, type: 'Model' }],
            },
          ],
        })),
      },
    ],
  };
  const catalogs = { read: async () => catalog },
    api = new ProjectApi(f.repo, catalogs);
  const config = await loadConfig({ dataDir: f.dir });
  const workflow = new WorkflowApi(config, f.repo, catalogs);
  let p = (
    await f.repo.execute(f.actor, f.id, 'lease', {}, () =>
      api.projects.acquireLease(f.actor, { projectId: f.id }),
    )
  ).project;
  let n = 0;
  async function mutate(action, extra = {}) {
    const c = { projectId: f.id, expectedRevision: p.revision, leaseId: p.lease.id, ...extra };
    p = (
      await f.repo.execute(f.actor, f.id, 'mutation-' + ++n, { action, ...c }, () =>
        api.projects[action](f.actor, c),
      )
    ).project;
    return p;
  }
  for (const [key, content] of [
    ['story', '# Current story'],
    ['models', JSON.stringify(models)],
    ['promptPlan', JSON.stringify(plan)],
  ]) {
    await mutate('saveDraft', { key, content });
    await mutate('confirm', { key });
  }
  const c = { projectId: f.id, expectedRevision: p.revision, leaseId: p.lease.id };
  p = (
    await f.repo.execute(f.actor, f.id, 'compile', c, () => workflow.workflows.compile(f.actor, c))
  ).project;
  const files = new FileResources(f.dir);
  await files.initialize();
  const entries = [['checkpoints', models.checkpoint], ...models.loras.map((s) => ['loras', s])];
  for (const [folder, s] of entries) {
    const dir = path.join(modelRoot, wrongDirectory ? 'wrong' : folder);
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, s.fileName);
    await writeFile(file, Buffer.from(s.ref));
    await files.register({
      id: s.ref.replaceAll('.', '-'),
      root: modelRoot,
      file,
      projectIds: [f.id],
    });
  }
  const env = {
    BATCH_STUDIO_SECRET_R2_ACCESS_KEY_ID: 'fixture-id',
    BATCH_STUDIO_SECRET_R2_SECRET_ACCESS_KEY: 'fixture-secret',
  };
  const settings = new IntegrationSettings(f.dir, env);
  await settings.initialize();
  await settings.register('environment', { r2: { account: 'a'.repeat(32) } });
  let remote = new Map(
    entries.map(([folder, s]) => [
      'models/' + folder + '/' + s.fileName,
      { size: s.ref.length, etag: s.ref },
    ]),
  );
  let onHead = async () => {};
  const port = {
    send: async (name, input) => {
      if (name === 'ListBuckets') return { Buckets: [{ Name: 'bucket' }] };
      if (name === 'ListObjectsV2')
        return {
          Contents: [...remote].map(([Key, r]) => ({ Key, Size: r.size, ETag: r.etag })),
          IsTruncated: false,
        };
      if (name === 'HeadObject') {
        await onHead();
        const r = remote.get(input.Key);
        if (!r) throw { $metadata: { httpStatusCode: 404 } };
        return { ContentLength: r.size, ETag: r.etag };
      }
      throw Error(name);
    },
    signed: async () => '',
  };
  const r2 = new R2Service(f.dir, settings, new Map(), port);
  await r2.initialize();
  await r2.syncIndex(f.actor);
  let currentActor = f.actor;
  let remoteEndpoint = null;
  const resources = new ProjectResources(
    api,
    workflow,
    catalogs,
    files,
    r2,
    settings,
    async () => currentActor,
    {
      endpoint: async () => {
        if (!remoteEndpoint) throw Object.assign(Error(), { code: 'SSH_TRUST_REQUIRED' });
        return remoteEndpoint;
      },
    },
  );
  const rootId = files.roots(f.actor, f.id)[0].id;
  const bindings = {
    executionTarget: 'local',
    localRootId: rootId,
    r2Bucket: 'bucket',
    r2Prefix: 'models',
    remoteInstanceId: null,
  };
  await mutate('configureResources', { bindings });
  return {
    ...f,
    api,
    resources,
    files,
    modelRoot,
    models,
    remote,
    rootId,
    bindings,
    setRemote: (value) => (remoteEndpoint = value),
    mutate,
    get project() {
      return p;
    },
    onHead: (fn) => (onHead = fn),
    catalog: (value) => (catalog = value),
    setActor: (value) => (currentActor = value),
    close: async () => {
      await f.close();
      await rm(modelRoot, { recursive: true, force: true });
    },
  };
}
test('actual current models/catalog/compiler plus exact Local/R2 resource evidence pass P1 resource Preflight without claiming P6 execution', async () => {
  const f = await setup();
  try {
    const snapshot = await f.resources.snapshot(f.actor, f.id, true);
    assert.equal(snapshot.availability.rows.length, 3);
    assert.ok(snapshot.availability.rows.every((r) => r.local && r.r2));
    assert.equal(snapshot.preflight.state, 'READY');
    assert.equal(snapshot.executionReady, false);
    assert.equal(snapshot.runtimeRequirement, 'P6_REQUIRED');
    assert.match(snapshot.snapshotId, /^[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(snapshot).includes(f.modelRoot));
    assert.ok(!JSON.stringify(snapshot).includes('fixture-secret'));
  } finally {
    await f.close();
  }
});
test('same model basename in the wrong directory never supplies Local placement evidence', async () => {
  const f = await setup({ wrongDirectory: true });
  try {
    const snapshot = await f.resources.snapshot(f.actor, f.id, true);
    assert.ok(
      snapshot.availability.rows.every((r) => !r.local && r.r2 && r.state === 'transfer-required'),
    );
    assert.equal(snapshot.preflight.state, 'BLOCKED');
    assert.ok(snapshot.preflight.blocking.some((i) => i.code === 'MODEL_LOCAL_PLACEMENT_REQUIRED'));
  } finally {
    await f.close();
  }
});
test('changed registered file identity or fresh R2 ETag rejects a stale ready observation', async () => {
  const f = await setup();
  try {
    const key = 'models/checkpoints/base.safetensors';
    f.remote.get(key).etag = 'changed';
    await assert.rejects(f.resources.snapshot(f.actor, f.id), { code: 'R2_INDEX_CHANGED' });
    f.remote.get(key).etag = 'checkpoint.main';
    await writeFile(path.join(f.modelRoot, 'checkpoints', 'base.safetensors'), 'changed');
    await assert.rejects(f.resources.snapshot(f.actor, f.id), { code: 'RESOURCE_CHANGED' });
  } finally {
    await f.close();
  }
});
test('Project revision, catalog generation and read permission changes during IO invalidate the snapshot', async () => {
  const f = await setup();
  try {
    let once = false;
    f.onHead(async () => {
      if (!once) {
        once = true;
        await f.mutate('configureResources', { bindings: { ...f.bindings, r2Prefix: 'models' } });
      }
    });
    await assert.rejects(f.resources.snapshot(f.actor, f.id), { code: 'REVISION_CONFLICT' });
    f.onHead(async () => {});
    f.setActor({ ...f.actor, permissions: [] });
    await assert.rejects(f.resources.snapshot(f.actor, f.id), { code: 'FORBIDDEN' });
  } finally {
    await f.close();
  }
});
test('resource settings are lease/CAS mutations, persisted current schema, and never accept physical paths or incomplete fields', async () => {
  const f = await setup();
  try {
    await assert.rejects(
      f.api.projects.configureResources(f.actor, {
        projectId: f.id,
        expectedRevision: f.project.revision - 1,
        leaseId: f.project.lease.id,
        bindings: f.bindings,
      }),
      { code: 'REVISION_CONFLICT' },
    );
    assert.throws(() => resourceBindings({ ...f.bindings, localRootId: f.modelRoot }), {
      code: 'INVALID_INPUT',
    });
    assert.throws(() => resourceBindings({ executionTarget: 'local' }), { code: 'INVALID_INPUT' });
    assert.throws(() => resourceBindings({ ...f.bindings, r2Prefix: '../models' }), {
      code: 'INVALID_INPUT',
    });
    assert.equal(
      (await f.api.projects.read(f.actor, { projectId: f.id })).resourceBindings.localRootId,
      f.rootId,
    );
    assert.throws(() => f.files.roots({ ...f.actor, projectIds: [] }, f.id), { code: 'FORBIDDEN' });
  } finally {
    await f.close();
  }
});

test('catalog identity changes are rejected and remote target requires freshly verified SSH trust', async () => {
  const f = await setup();
  try {
    await f.mutate('configureResources', {
      bindings: { ...f.bindings, executionTarget: 'remote', remoteInstanceId: 7 },
    });
    await assert.rejects(f.resources.snapshot(f.actor, f.id), { code: 'SSH_TRUST_REQUIRED' });
    f.setRemote({
      instanceId: 7,
      keyId: 'key',
      host: 'public.invalid',
      port: 2222,
      user: 'user',
      comfyUiDirectory: '/workspace/ComfyUI',
      comfyUiPort: 8188,
      fingerprint: 'SHA256:fixture',
    });
    let r = await f.resources.snapshot(f.actor, f.id, true);
    assert.equal(r.remoteTarget.instanceId, 7);
    assert.equal(r.preflight.state, 'BLOCKED');
    assert.equal(r.executionReady, false);
    f.catalog({ schemaVersion: 1, generation: 2, collections: [] });
    await assert.rejects(f.resources.snapshot(f.actor, f.id), { code: 'MODELS_NOT_CONFIRMED' });
  } finally {
    await f.close();
  }
});
test('resource HTTP endpoints enforce session, CSRF, build and strict fields while returning logical resources only', async () => {
  const f = await setup();
  let server;
  try {
    await writeAuth(f.dir, [f.id]);
    const security = new Security(f.dir);
    await security.initialize();
    const config = await loadConfig({ dataDir: f.dir, port: 0 });
    server = await startServer(config, {
      ...security.http(),
      route: (ctx) => f.resources.route(ctx),
    });
    security.setOrigin(server.origin);
    const headers = {
      'content-type': 'application/json',
      'x-batch-api-version': '1',
      'x-batch-build-id': config.buildId,
      'x-request-id': 'test',
      origin: server.origin,
    };
    const login = await fetch(server.origin + '/api/v1/session', {
      method: 'POST',
      headers: { ...headers, authorization: 'Bearer ' + token },
      body: '{}',
    });
    const { csrfToken } = await login.json();
    headers.cookie = login.headers.get('set-cookie').split(';')[0];
    headers['x-csrf-token'] = csrfToken;
    const url = server.origin + '/api/v1/projects/' + f.id;
    const result = await fetch(url + '/availability', { headers });
    assert.equal(result.status, 200);
    assert.ok(!(await result.text()).includes(f.modelRoot));
    assert.equal(
      (await fetch(url + '/availability', { headers: { ...headers, cookie: '' } })).status,
      401,
    );
    assert.equal((await fetch(url + '/availability?root=arbitrary', { headers })).status, 400);
    assert.equal(
      (
        await fetch(url + '/commands/configure-resources', {
          method: 'POST',
          headers: { ...headers, 'x-csrf-token': 'bad' },
          body: JSON.stringify({
            bindings: f.bindings,
            expectedRevision: f.project.revision,
            leaseId: f.project.lease.id,
          }),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(url + '/commands/configure-resources', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            bindings: f.bindings,
            path: f.modelRoot,
            expectedRevision: f.project.revision,
            leaseId: f.project.lease.id,
          }),
        })
      ).status,
      400,
    );
  } finally {
    await server?.close();
    await f.close();
  }
});
