import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebCivitaiClient } from '../dist-server/server/civitai-client.js';
import { CivitaiService } from '../dist-server/server/civitai-service.js';
import { IntegrationSettings } from '../dist-server/server/integration-settings.js';
import { JobRegistry } from '../dist-server/server/jobs.js';
const actor = {
  userId: 'operator',
  sessionId: 'session',
  requestId: 'request',
  projectIds: ['A', 'B'],
  permissions: ['read', 'execute', 'admin'],
};
const environment = { BATCH_STUDIO_SECRET_CIVITAI_API_KEY: 'fixture-private-civitai-credential' };
const response = (value) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const signal = () => new AbortController().signal;
const model = {
  id: 5,
  name: 'checkpoint',
  type: 'Checkpoint',
  modelVersions: [
    {
      id: 7,
      name: 'version',
      baseModel: 'Illustrious',
      trainedWords: ['word'],
      files: [
        {
          id: 11,
          name: 'model.safetensors',
          type: 'Model',
          primary: true,
          sizeKB: 1,
          downloadUrl: 'https://civitai.com/api/download/models/7',
          metadata: { format: 'SafeTensor' },
          hashes: { SHA256: 'a'.repeat(64) },
        },
      ],
      images: [],
    },
  ],
};
function api(url) {
  if (url.pathname.endsWith('collection.getAllUser'))
    return response({
      result: { data: { json: [{ id: 3, name: 'collection', type: 'Model', read: 'Private' }] } },
    });
  if (url.pathname.endsWith('collection.getAllCollectionItems'))
    return response({
      result: {
        data: {
          json: {
            collectionItems: [
              {
                type: 'model',
                data: {
                  id: 5,
                  name: 'checkpoint',
                  type: 'Checkpoint',
                  version: { id: 7, name: 'version', baseModel: 'Illustrious' },
                },
              },
            ],
            nextCursor: null,
          },
        },
      },
    });
  if (url.pathname === '/api/v1/models/5') return response(model);
  throw new Error('Unexpected API request ' + url.pathname);
}
async function directory(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'web-civitai-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
async function setup(dir, fetcher) {
  const settings = new IntegrationSettings(dir, environment);
  await settings.initialize();
  await settings.register('environment', { civitai: {} });
  const definitions = new Map();
  const jobs = new JobRegistry(dir, definitions);
  const service = new CivitaiService(dir, settings, jobs, async (who) => who, fetcher);
  definitions.set('civitai-sync', service.definition);
  await jobs.initialize();
  await service.initialize();
  return { settings, definitions, jobs, service };
}
test('fixed collection/API endpoints use credentials only in header and explicit cursor pagination', async () => {
  const seen = [];
  let page = 0;
  const client = new WebCivitaiClient(
    environment.BATCH_STUDIO_SECRET_CIVITAI_API_KEY,
    signal(),
    async (url, input) => {
      seen.push(url.href);
      assert.equal(input.redirect, 'error');
      assert.equal(
        input.headers.Authorization,
        'Bearer ' + environment.BATCH_STUDIO_SECRET_CIVITAI_API_KEY,
      );
      assert.ok(!url.href.includes('credential'));
      if (url.pathname.endsWith('collection.getAllCollectionItems')) {
        page++;
        return response({
          result: {
            data: { json: { collectionItems: [], nextCursor: page === 1 ? 'next' : null } },
          },
        });
      }
      return api(url);
    },
  );
  assert.equal((await client.getCollections())[0].id, 3);
  assert.equal((await client.getCollectionItems(3)).pages, 2);
  assert.equal(new URL(seen[1]).origin, 'https://civitai.red');
  await assert.rejects(client.getModel(-1), { code: 'INVALID_INPUT' });
});
test('429 honors Retry-After with bounded retries; rejected credentials and redirects never switch providers', async () => {
  let calls = 0;
  const client = new WebCivitaiClient('private-credential', signal(), async () => {
    calls++;
    return calls === 1
      ? new Response('', { status: 429, headers: { 'retry-after': '0' } })
      : response(model);
  });
  assert.equal((await client.getModel(5)).id, 5);
  assert.equal(client.metrics.retries, 1);
  const limited = new WebCivitaiClient(
    'private-credential',
    signal(),
    async () => new Response('', { status: 429, headers: { 'retry-after': '120' } }),
  );
  await assert.rejects(limited.getModel(5), { code: 'CIVITAI_RATE_LIMIT' });
  let rejectedCalls = 0;
  const rejected = new WebCivitaiClient('private-credential', signal(), async () => {
    rejectedCalls++;
    return new Response('secret external error', { status: 401 });
  });
  await assert.rejects(rejected.getModel(5), { code: 'CIVITAI_REJECTED' });
  assert.equal(rejectedCalls, 1);
});
test('body size, body deadline, repeated cursor and response Secret echoes reject', async () => {
  const huge = new WebCivitaiClient('private-credential', signal(), async () =>
    response({ padding: 'x'.repeat(4 * 1024 * 1024) }),
  );
  await assert.rejects(huge.getModel(5), { code: 'CIVITAI_RESPONSE_LIMIT' });
  const timer = setTimeout(() => {}, 100);
  try {
    const slow = new WebCivitaiClient(
      'private-credential',
      signal(),
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{'));
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
      10,
    );
    await assert.rejects(slow.getModel(5), { name: 'TimeoutError' });
  } finally {
    clearTimeout(timer);
  }
  const cursor = new WebCivitaiClient('private-credential', signal(), async () =>
    response({ result: { data: { json: { collectionItems: [], nextCursor: 'same' } } } }),
  );
  await assert.rejects(cursor.getCollectionItems(3), { code: 'CIVITAI_CURSOR' });
  const echo = new WebCivitaiClient('private-credential', signal(), async () =>
    response({ ...model, secret: 'private-credential' }),
  );
  await assert.rejects(echo.getModel(5), { code: 'CIVITAI_PROTOCOL' });
});
test('P1 sync publishes current catalog and persists fresh cache; second sync reuses details and increments generation', () =>
  directory(async (dir) => {
    let details = 0;
    const { service, settings, jobs } = await setup(dir, async (url) => {
      if (url.pathname === '/api/v1/models/5') details++;
      return api(url);
    });
    for (const [key, generation] of [
      ['first', 1],
      ['second', 2],
    ]) {
      const job = await jobs.submit(
        actor,
        'A',
        'civitai-sync',
        key,
        { providerRevision: 1, sourceFingerprint: settings.resolve('civitai').fingerprint },
        { stage: 'catalog', provider: 'civitai', turnId: key },
      );
      await jobs.drain();
      assert.equal(jobs.get(actor, job.id).state, 'succeeded');
      const catalog = await service.read('A');
      assert.equal(catalog.generation, generation);
      assert.equal(catalog.collections[0].items[0].modelId, 5);
    }
    assert.equal(details, 1);
    const raw = await readFile(path.join(dir, 'civitai.json'), 'utf8');
    assert.ok(!raw.includes('fixture-private'));
    const restored = new CivitaiService(
      dir,
      await setupSettings(dir),
      jobs,
      async (who) => who,
      api,
    );
    await restored.initialize();
    assert.equal((await restored.read('A')).generation, 2);
  }));
async function setupSettings(dir) {
  const store = new IntegrationSettings(dir, environment);
  await store.initialize();
  return store;
}
test('settings generation changes prevent stale publish/cache use; expired cache never hides a request failure', () =>
  directory(async (dir) => {
    const { service, settings, jobs } = await setup(dir, api);
    const job = await jobs.submit(
      actor,
      'A',
      'civitai-sync',
      'initial',
      { providerRevision: 1, sourceFingerprint: settings.resolve('civitai').fingerprint },
      { stage: 'catalog', provider: 'civitai', turnId: 'initial' },
    );
    await jobs.drain();
    assert.equal(jobs.get(actor, job.id).state, 'succeeded');
    await settings.update(actor, 'civitai', 1, { enabled: true });
    assert.equal(await service.read('A'), null);
    const stale = await jobs.submit(
      actor,
      'A',
      'civitai-sync',
      'stale',
      { providerRevision: 1, sourceFingerprint: settings.resolve('civitai').fingerprint },
      { stage: 'catalog', provider: 'civitai', turnId: 'stale' },
    );
    await jobs.drain();
    assert.equal(jobs.get(actor, stale.id).state, 'failed');
    const file = path.join(dir, 'civitai.json');
    const raw = JSON.parse(await readFile(file, 'utf8'));
    raw.providerRevision = 2;
    raw.sourceFingerprint = settings.resolve('civitai').fingerprint;
    for (const row of raw.cache) row.expiresAt = 0;
    await writeFile(file, JSON.stringify(raw));
    const rejecting = new CivitaiService(
      dir,
      settings,
      jobs,
      async (who) => who,
      async () => new Response('', { status: 401 }),
    );
    await rejecting.initialize();
    const before = await readFile(file, 'utf8');
    const result = await rejecting.definition.run({
      actor,
      job: { projectId: 'A' },
      input: { providerRevision: 2, sourceFingerprint: settings.resolve('civitai').fingerprint },
      signal: signal(),
      progress: async () => {},
    });
    assert.equal(result.state, 'failed');
    assert.equal(await readFile(file, 'utf8'), before);
  }));
test('globalExclusive job reservation prevents duplicate sync across Projects; unknown cache schema rejects', () =>
  directory(async (dir) => {
    let resolve;
    const wait = new Promise((r) => {
      resolve = r;
    });
    const { jobs, service, settings } = await setup(dir, async (url) => {
      await wait;
      return api(url);
    });
    await jobs.submit(
      actor,
      'A',
      'civitai-sync',
      'first',
      { providerRevision: 1, sourceFingerprint: settings.resolve('civitai').fingerprint },
      { stage: 'catalog', provider: 'civitai', turnId: 'first' },
    );
    await assert.rejects(
      jobs.submit(
        actor,
        'B',
        'civitai-sync',
        'second',
        { providerRevision: 1, sourceFingerprint: settings.resolve('civitai').fingerprint },
        { stage: 'catalog', provider: 'civitai', turnId: 'second' },
      ),
      { code: 'RUNTIME_BUSY' },
    );
    resolve();
    await jobs.drain();
    await service.drain();
    await writeFile(path.join(dir, 'civitai.json'), '{"schema":"legacy"}');
    await assert.rejects(
      new CivitaiService(dir, await setupSettings(dir), jobs, async (who) => who, api).initialize(),
      { code: 'CIVITAI_STORE_UNAVAILABLE' },
    );
    assert.equal(await readFile(path.join(dir, 'civitai.json'), 'utf8'), '{"schema":"legacy"}');
  }));

test('environment credential changes invalidate cache and catalogs; catalog generation remains monotonic', () =>
  directory(async (dir) => {
    const source = { ...environment };
    const settings = new IntegrationSettings(dir, source);
    await settings.initialize();
    await settings.register('environment', { civitai: {} });
    const definitions = new Map();
    const jobs = new JobRegistry(dir, definitions);
    const service = new CivitaiService(dir, settings, jobs, async (who) => who, api);
    definitions.set('civitai-sync', service.definition);
    await jobs.initialize();
    await service.initialize();
    const sync = async (key) => {
      await jobs.submit(
        actor,
        'A',
        'civitai-sync',
        key,
        { providerRevision: 1, sourceFingerprint: settings.resolve('civitai').fingerprint },
        { stage: 'catalog', provider: 'civitai', turnId: key },
      );
      await jobs.drain();
    };
    await sync('first');
    assert.equal((await service.read('A')).generation, 1);
    source.BATCH_STUDIO_SECRET_CIVITAI_API_KEY = 'different-private-credential';
    assert.equal(await service.read('A'), null);
    await sync('second');
    assert.equal((await service.read('A')).generation, 2);
  }));
import { fixture } from './server-fixtures.mjs';
test('authenticated catalog/search/detail/sync API is strict and replays the same job receipt without duplicate requests', async () => {
  let service;
  const f = await fixture({ route: (ctx) => service.route(ctx) });
  try {
    let reads = 0;
    const setupResult = await setup(f.dir, async (url) => {
      reads++;
      return api(url);
    });
    service = setupResult.service;
    const url = f.runtime.origin + '/api/v1/integrations/civitai/';
    const post = (body) =>
      fetch(url + 'sync', {
        method: 'POST',
        headers: { ...f.headers, 'idempotency-key': 'sync' },
        body: JSON.stringify(body),
      });
    const job = await (await post({ projectId: 'A' })).json();
    await setupResult.jobs.drain();
    assert.equal(setupResult.jobs.get(actor, job.job.id).state, 'succeeded');
    const count = reads;
    const again = await (await post({ projectId: 'A' })).json();
    assert.equal(again.job.id, job.job.id);
    await setupResult.jobs.drain();
    assert.equal(reads, count);
    assert.equal((await post({ projectId: 'A', apiUrl: 'https://evil.invalid' })).status, 400);
    const search = await fetch(url + 'search?query=checkpoint', { headers: f.headers });
    assert.equal(search.status, 200);
    assert.equal((await search.json()).items[0].modelId, 5);
    assert.equal((await fetch(url + 'search?query=x&query=y', { headers: f.headers })).status, 400);
    const detail = await fetch(url + 'models/5', { headers: f.headers });
    assert.equal(detail.status, 200);
    assert.ok(!(await detail.text()).includes('fixture-private'));
    assert.equal((await fetch(url + 'catalog', { headers: f.baseHeaders })).status, 401);
  } finally {
    await f.close();
  }
});
