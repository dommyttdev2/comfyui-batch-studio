import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ExternalOperations } from '../dist-server/server/external-operations.js';
import { fixture } from './server-fixtures.mjs';
const actor = {
  userId: 'operator',
  sessionId: 'session',
  requestId: 'request',
  projectIds: ['project'],
  permissions: ['read', 'edit', 'admin'],
};
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const current = {
  revision: 1,
  fingerprint: hash('facts'),
  summary: { target: 'offer', price: 0.1 },
};
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { resolve, promise };
};
async function directory(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'web-operations-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
function setup(dir, overrides = {}, guard, reauthorize, now) {
  const definition = {
    scope: () => 'vast:offer',
    inspect: async () => current,
    execute: async () => ({ state: 'succeeded', result: { instanceId: 'instance' } }),
    ...overrides,
  };
  const definitions = new Map([['rent-instance', definition]]);
  return { definitions, store: new ExternalOperations(dir, definitions, guard, reauthorize, now) };
}
test('reservation is durable before external effect; duplicate confirmation and scope overlap cannot execute', () =>
  directory(async (dir) => {
    const wait = deferred();
    const inspected = deferred();
    let effects = 0;
    const { store } = setup(dir, {
      execute: async (_actor, _target, id) => {
        effects++;
        const persisted = JSON.parse(
          await readFile(path.join(dir, 'external-operations.json'), 'utf8'),
        );
        assert.equal(persisted.receipts.find((r) => r.id === id).state, 'running');
        assert.equal(persisted.confirmations[0].consumed, true);
        inspected.resolve();
        await wait.promise;
        return { state: 'succeeded', result: { instanceId: 'instance' } };
      },
    });
    await store.initialize();
    const prepared = await store.prepare(actor, 'rent-instance', 'offer');
    const r = await store.confirm(actor, 'rent-instance', 'offer', prepared.confirmationId);
    await assert.rejects(store.confirm(actor, 'rent-instance', 'offer', prepared.confirmationId), {
      code: 'CONFIRMATION_CONSUMED',
    });
    await inspected.promise;
    const other = await store.prepare(actor, 'rent-instance', 'offer');
    await assert.rejects(store.confirm(actor, 'rent-instance', 'offer', other.confirmationId), {
      code: 'EXTERNAL_SCOPE_BUSY',
    });
    wait.resolve();
    await store.drain();
    assert.equal(effects, 1);
    assert.equal(store.read(actor, r.id).state, 'succeeded');
    assert.throws(() => store.read({ ...actor, userId: 'other' }, r.id), { code: 'NOT_FOUND' });
  }));
test('owner/session/expiry/settings generation/fingerprint and Project lease are bound; no effects before valid confirm', () =>
  directory(async (dir) => {
    let clock = 100;
    let observed = current;
    let effects = 0;
    let lease = true;
    const { store } = setup(
      dir,
      {
        inspect: async () => observed,
        execute: async () => {
          effects++;
          return { state: 'succeeded' };
        },
      },
      async (_actor, binding) => {
        assert.equal(binding.expectedRevision, 7);
        if (!lease) throw Object.assign(new Error(), { code: 'LEASE_REQUIRED' });
      },
      undefined,
      () => clock,
    );
    await store.initialize();
    const bound = { projectId: 'project', expectedRevision: 7, leaseId: 'lease' };
    const p = await store.prepare(actor, 'rent-instance', 'offer', bound);
    for (const who of [
      { ...actor, userId: 'other' },
      { ...actor, sessionId: 'other' },
    ])
      await assert.rejects(store.confirm(who, 'rent-instance', 'offer', p.confirmationId), {
        code: 'FORBIDDEN',
      });
    await assert.rejects(
      store.prepare({ ...actor, permissions: ['read'] }, 'rent-instance', 'offer'),
      { code: 'FORBIDDEN' },
    );
    await assert.rejects(
      store.prepare({ ...actor, projectIds: [] }, 'rent-instance', 'offer', bound),
      { code: 'FORBIDDEN' },
    );
    observed = { ...current, revision: 2 };
    await assert.rejects(store.confirm(actor, 'rent-instance', 'offer', p.confirmationId), {
      code: 'TARGET_CHANGED',
    });
    observed = { ...current, fingerprint: hash('changed') };
    await assert.rejects(store.confirm(actor, 'rent-instance', 'offer', p.confirmationId), {
      code: 'TARGET_CHANGED',
    });
    observed = current;
    lease = false;
    await assert.rejects(store.confirm(actor, 'rent-instance', 'offer', p.confirmationId), {
      code: 'LEASE_REQUIRED',
    });
    lease = true;
    clock = p.expiresAt;
    await assert.rejects(store.confirm(actor, 'rent-instance', 'offer', p.confirmationId), {
      code: 'CONFIRMATION_EXPIRED',
    });
    assert.equal(effects, 0);
  }));
test('accepted external request with lost response remains uncertain across restart and only read-only reconciliation releases scope', () =>
  directory(async (dir) => {
    let effects = 0;
    let queries = 0;
    const overrides = {
      execute: async () => {
        effects++;
        throw new Error('response lost after rent accepted');
      },
      reconcile: async () => {
        queries++;
        return { state: 'succeeded', result: { instanceId: 'accepted-instance' } };
      },
    };
    const { store } = setup(dir, overrides);
    await store.initialize();
    const p = await store.prepare(actor, 'rent-instance', 'offer');
    const r = await store.confirm(actor, 'rent-instance', 'offer', p.confirmationId);
    await store.drain();
    assert.equal(store.read(actor, r.id).state, 'uncertain');
    const { store: restored } = setup(dir, overrides);
    await restored.initialize();
    const again = await restored.prepare(actor, 'rent-instance', 'offer');
    await assert.rejects(restored.confirm(actor, 'rent-instance', 'offer', again.confirmationId), {
      code: 'EXTERNAL_SCOPE_BUSY',
    });
    assert.equal((await restored.reconcile(actor, r.id)).state, 'succeeded');
    assert.equal(effects, 1);
    assert.equal(queries, 1);
  }));
test('restart never resumes reserved/running operations and force fences late successful completion', () =>
  directory(async (dir) => {
    const wait = deferred();
    let effects = 0;
    const { store } = setup(dir, {
      execute: async () => {
        effects++;
        await wait.promise;
        return { state: 'succeeded' };
      },
    });
    await store.initialize();
    const p = await store.prepare(actor, 'rent-instance', 'offer');
    const r = await store.confirm(actor, 'rent-instance', 'offer', p.confirmationId);
    while (!effects) await new Promise((resolve) => setTimeout(resolve, 1));
    const { store: restored } = setup(dir, {
      execute: async () => {
        throw new Error('Must not run on restart');
      },
    });
    await restored.initialize();
    assert.equal(restored.read(actor, r.id).state, 'uncertain');
    await store.forceUncertain();
    wait.resolve();
    await store.drain();
    assert.equal(store.read(actor, r.id).state, 'uncertain');
    assert.equal(effects, 1);
    await assert.rejects(store.prepare(actor, 'rent-instance', 'offer'), {
      code: 'EXTERNAL_STORE_UNAVAILABLE',
    });
  }));
test('persistence failure prevents effects and all subsequent reservations; corrupt schemas/bindings reject without overwrite', () =>
  directory(async (dir) => {
    let effects = 0;
    const { store } = setup(dir, {
      execute: async () => {
        effects++;
        return { state: 'succeeded' };
      },
    });
    await store.initialize();
    const p = await store.prepare(actor, 'rent-instance', 'offer');
    const file = path.join(dir, 'external-operations.json');
    const valid = JSON.parse(await readFile(file, 'utf8'));
    await rm(file);
    await mkdir(file);
    await assert.rejects(store.confirm(actor, 'rent-instance', 'offer', p.confirmationId), {
      code: 'EXTERNAL_STORE_UNAVAILABLE',
    });
    assert.equal(effects, 0);
    await assert.rejects(store.prepare(actor, 'rent-instance', 'offer'), {
      code: 'EXTERNAL_STORE_UNAVAILABLE',
    });
    await rm(file, { recursive: true });
    for (const invalid of [
      { schema: 'legacy' },
      {
        ...valid,
        confirmations: [
          {
            ...valid.confirmations[0],
            confirmation: { ...valid.confirmations[0].confirmation, fingerprint: hash('tampered') },
          },
        ],
      },
    ]) {
      const bytes = JSON.stringify(invalid);
      await writeFile(file, bytes, { mode: 0o600 });
      await assert.rejects(setup(dir).store.initialize(), { code: 'EXTERNAL_STORE_UNAVAILABLE' });
      assert.equal(await readFile(file, 'utf8'), bytes);
    }
  }));
test('HTTP confirmation rejects boolean bypass and uses authenticated receipt ownership', async () => {
  let store;
  const f = await fixture({ route: (context) => store.route(context) });
  try {
    ({ store } = setup(f.dir));
    await store.initialize();
    const url = f.runtime.origin + '/api/v1/integrations/operations/';
    const post = (route, input) =>
      fetch(url + route, { method: 'POST', headers: f.headers, body: JSON.stringify(input) });
    assert.equal(
      (await post('confirm', { operation: 'rent-instance', targetId: 'offer', confirmed: true }))
        .status,
      400,
    );
    const p = await (
      await post('prepare', { operation: 'rent-instance', targetId: 'offer' })
    ).json();
    const confirmation = await post('confirm', {
      operation: 'rent-instance',
      targetId: 'offer',
      confirmationId: p.confirmationId,
    });
    assert.equal(confirmation.status, 202);
    const receipt = await confirmation.json();
    await store.drain();
    const response = await fetch(url + 'receipts/' + receipt.id, { headers: f.headers });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).state, 'succeeded');
  } finally {
    await f.close();
  }
});

test('forced shutdown also fences slow reconciliation and tracks its lifetime', () =>
  directory(async (dir) => {
    const wait = deferred();
    const queried = deferred();
    const { store } = setup(dir, {
      execute: async () => {
        throw new Error('unknown');
      },
      reconcile: async () => {
        queried.resolve();
        await wait.promise;
        return { state: 'succeeded' };
      },
    });
    await store.initialize();
    const p = await store.prepare(actor, 'rent-instance', 'offer');
    const r = await store.confirm(actor, 'rent-instance', 'offer', p.confirmationId);
    await store.drain();
    const pending = store.reconcile(actor, r.id);
    await queried.promise;
    let drained = false;
    const draining = store.drain().then(() => {
      drained = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(drained, false);
    await store.forceUncertain();
    wait.resolve();
    await pending;
    await draining;
    assert.equal(store.read(actor, r.id).state, 'uncertain');
  }));
import { createServerRuntime } from '../dist-server/server/runtime.js';
import { loadConfig } from '../dist-server/server/config.js';
import { writeAuth } from './server-fixtures.mjs';
test('server retains filesystem ownership on external drain timeout and rejects late external success', () =>
  directory(async (dir) => {
    await writeAuth(dir);
    const config = await loadConfig({ dataDir: dir, port: 0 });
    const runtime = await createServerRuntime(config, { shutdownMs: 30 });
    const wait = deferred();
    const started = deferred();
    runtime.externalDefinitions.set('rent-instance', {
      scope: () => 'vast:offer',
      inspect: async () => current,
      execute: async () => {
        started.resolve();
        await wait.promise;
        return { state: 'succeeded' };
      },
    });
    const prepared = await runtime.externalOperations.prepare(actor, 'rent-instance', 'offer');
    const receipt = await runtime.externalOperations.confirm(
      actor,
      'rent-instance',
      'offer',
      prepared.confirmationId,
    );
    await started.promise;
    await assert.rejects(runtime.close(), /External operations remain uncertain/);
    assert.equal(runtime.state(), 'uncertain');
    await assert.rejects(createServerRuntime(config), /Ownership/);
    wait.resolve();
    await runtime.externalOperations.drain();
    assert.equal(runtime.externalOperations.read(actor, receipt.id).state, 'uncertain');
    await runtime.repository.close();
    // Isolated test fixture cleanup; the production recovery CLI verifies a dead server first.
  }));
