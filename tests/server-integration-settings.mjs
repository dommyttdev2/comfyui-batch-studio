import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { IntegrationSettings } from '../dist-server/server/integration-settings.js';
const admin = {
  userId: 'admin',
  sessionId: 'session',
  requestId: 'request',
  projectIds: [],
  permissions: ['read', 'admin'],
};
const reader = { ...admin, permissions: ['read'] };
const env = {
  BATCH_STUDIO_VAULT_KEY: 'ab'.repeat(32),
  BATCH_STUDIO_SECRET_CIVITAI_API_KEY: 'civitai-secret',
  BATCH_STUDIO_SECRET_R2_ACCESS_KEY_ID: 'r2-key',
  BATCH_STUDIO_SECRET_R2_SECRET_ACCESS_KEY: 'r2-secret',
  BATCH_STUDIO_SECRET_VAST_API_KEY: 'vast-secret',
};
async function directory(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'web-integrations-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
test('unregistered settings are explicit; legacy files and generic environment keys are ignored', () =>
  directory(async (dir) => {
    await writeFile(path.join(dir, 'civitai-config.json'), JSON.stringify({ apiKey: 'legacy' }));
    const store = new IntegrationSettings(dir, { CIVITAI_API_KEY: 'legacy' });
    await store.initialize();
    assert.equal(store.status(reader).configured, false);
    assert.throws(() => store.resolve('civitai'), { code: 'INTEGRATION_UNAVAILABLE' });
    await assert.rejects(store.register('environment', { civitai: {} }), {
      code: 'INTEGRATION_UNAVAILABLE',
    });
    assert.equal(store.status(reader).configured, false);
    await assert.rejects(readFile(path.join(dir, 'integrations.json')));
  }));
test('environment source uses only fixed explicit names, exposes metadata and rejects browser Secret writes', () =>
  directory(async (dir) => {
    const source = { ...env };
    const store = new IntegrationSettings(dir, source);
    await store.initialize();
    await store.register('environment', { civitai: {}, r2: { account: 'a'.repeat(32) }, vast: {} });
    assert.equal(store.resolve('vast').secrets.apiKey, 'vast-secret');
    const publicText = JSON.stringify(store.status(admin));
    for (const secret of Object.values(env)) assert.ok(!publicText.includes(secret));
    assert.ok(!publicText.includes('BATCH_STUDIO_'));
    const persisted = await readFile(path.join(dir, 'integrations.json'), 'utf8');
    assert.ok(!persisted.includes('secret'));
    delete source.BATCH_STUDIO_SECRET_CIVITAI_API_KEY;
    source.CIVITAI_API_KEY = 'fallback';
    assert.equal(store.status(reader).providers[0].state, 'unavailable');
    assert.throws(() => store.resolve('civitai'), { code: 'INTEGRATION_UNAVAILABLE' });
    await assert.rejects(
      store.update(admin, 'vast', 1, { enabled: true, secrets: { apiKey: 'new' } }),
      { code: 'SECRET_SOURCE_READ_ONLY' },
    );
  }));
test('vault ciphertext persists; key absence, mismatch and tampering never use environment fallback', () =>
  directory(async (dir) => {
    const store = new IntegrationSettings(dir, env);
    await store.initialize();
    await store.register('vault', {
      civitai: { secrets: { apiKey: 'registered-only' } },
      r2: {
        account: 'a'.repeat(32),
        secrets: { accessKeyId: 'registered-r2-id', secretAccessKey: 'registered-r2-secret' },
      },
    });
    const persisted = await readFile(path.join(dir, 'integrations.json'), 'utf8');
    assert.ok(!persisted.includes('registered-'));
    assert.ok(!persisted.includes(env.BATCH_STUDIO_VAULT_KEY));
    const restored = new IntegrationSettings(dir, env);
    await restored.initialize();
    assert.equal(restored.resolve('civitai').secrets.apiKey, 'registered-only');
    for (const source of [
      { ...env, BATCH_STUDIO_VAULT_KEY: undefined },
      { ...env, BATCH_STUDIO_VAULT_KEY: 'cd'.repeat(32) },
    ]) {
      const wrong = new IntegrationSettings(dir, source);
      await wrong.initialize();
      assert.throws(() => wrong.resolve('civitai'), { code: 'INTEGRATION_UNAVAILABLE' });
      assert.equal(wrong.status(admin).providers[0].state, 'unavailable');
    }
    const raw = JSON.parse(persisted);
    raw.providers.civitai.cipher.tag = '00'.repeat(16);
    await writeFile(path.join(dir, 'integrations.json'), JSON.stringify(raw), { mode: 0o600 });
    const corrupt = new IntegrationSettings(dir, env);
    await corrupt.initialize();
    assert.throws(() => corrupt.resolve('civitai'), { code: 'INTEGRATION_UNAVAILABLE' });
  }));
test('administrator CAS serializes concurrent writes and ciphertext binds provider/config generation', () =>
  directory(async (dir) => {
    const store = new IntegrationSettings(dir, env);
    await store.initialize();
    await store.register('vault', {
      r2: { account: 'a'.repeat(32), secrets: { accessKeyId: 'id', secretAccessKey: 'secret' } },
    });
    await assert.rejects(
      store.update(reader, 'r2', 1, { enabled: false, account: 'a'.repeat(32) }),
      { code: 'FORBIDDEN' },
    );
    const results = await Promise.allSettled([
      store.update(admin, 'r2', 1, { enabled: true, account: 'b'.repeat(32) }),
      store.update(admin, 'r2', 1, { enabled: false, account: 'a'.repeat(32) }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(results[1].reason.code, 'REVISION_CONFLICT');
    assert.equal(store.resolve('r2').account, 'b'.repeat(32));
    const raw = JSON.parse(await readFile(path.join(dir, 'integrations.json'), 'utf8'));
    raw.providers.r2.account = 'c'.repeat(32);
    await writeFile(path.join(dir, 'integrations.json'), JSON.stringify(raw));
    const changed = new IntegrationSettings(dir, env);
    await changed.initialize();
    assert.throws(() => changed.resolve('r2'), { code: 'INTEGRATION_UNAVAILABLE' });
  }));
test('unknown schema and invalid source/key configuration reject without overwriting existing settings', () =>
  directory(async (dir) => {
    const file = path.join(dir, 'integrations.json');
    await writeFile(file, JSON.stringify({ schema: 'legacy' }), { mode: 0o600 });
    await assert.rejects(new IntegrationSettings(dir, env).initialize(), {
      code: 'INTEGRATION_UNAVAILABLE',
    });
    assert.equal(JSON.parse(await readFile(file, 'utf8')).schema, 'legacy');
    await rm(file);
    const store = new IntegrationSettings(dir, env);
    await store.initialize();
    await assert.rejects(
      store.register('environment', { r2: { account: 'https://evil.invalid' } }),
    );
    await assert.rejects(
      store.register('vault', {
        civitai: { secrets: { apiKey: 'secret', arbitrary: 'rejected' } },
      }),
    );
    await assert.rejects(
      store.register('environment', {
        r2: { account: 'a'.repeat(32), publicUrl: 'https://user:password@evil.invalid' },
      }),
    );
    assert.equal(store.status(admin).configured, false);
  }));
test('disabling provider is persistent and configuration updates never expose secrets', () =>
  directory(async (dir) => {
    const store = new IntegrationSettings(dir, env);
    await store.initialize();
    await store.register('vault', { civitai: { secrets: { apiKey: 'one' } } });
    const result = await store.update(admin, 'civitai', 1, {
      enabled: false,
      secrets: { apiKey: 'two' },
    });
    assert.equal(result.providers[0].state, 'disabled');
    assert.ok(!JSON.stringify(result).includes('two'));
    const restored = new IntegrationSettings(dir, env);
    await restored.initialize();
    assert.throws(() => restored.resolve('civitai'));
    await restored.update(admin, 'civitai', 2, { enabled: true });
    assert.equal(restored.resolve('civitai').secrets.apiKey, 'two');
    await assert.rejects(restored.register('environment', { vast: {} }), {
      code: 'REGISTRATION_REJECTED',
    });
    assert.throws(() => restored.status({ ...reader, permissions: [] }), { code: 'FORBIDDEN' });
  }));

import { fixture } from './server-fixtures.mjs';
test('HTTP settings require session/admin/CSRF/build and strict fields; Secrets stay out of response', async () => {
  let store;
  const f = await fixture({ route: async (context) => store.route(context) });
  try {
    store = new IntegrationSettings(f.dir, env);
    await store.initialize();
    await store.register('vault', { civitai: { secrets: { apiKey: 'http-private-secret' } } });
    const url = f.runtime.origin + '/api/v1/integrations/settings';
    assert.equal((await fetch(url, { headers: f.baseHeaders })).status, 401);
    const get = await fetch(url, { headers: f.headers });
    assert.equal(get.status, 200);
    assert.ok(!(await get.text()).includes('http-private-secret'));
    const input = {
      provider: 'civitai',
      expectedRevision: 1,
      settings: { enabled: true, secrets: { apiKey: 'rotated-private' } },
    };
    const request = (headers, body = input) =>
      fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal((await request({ ...f.headers, 'x-csrf-token': 'wrong' })).status, 403);
    assert.equal((await request({ ...f.headers, 'x-batch-build-id': 'wrong' })).status, 409);
    assert.equal((await request(f.headers, { ...input, confirmed: true })).status, 400);
    assert.equal(
      (
        await request(f.headers, {
          ...input,
          settings: { ...input.settings, apiUrl: 'https://evil.invalid' },
        })
      ).status,
      400,
    );
    const updated = await request(f.headers);
    assert.equal(updated.status, 200);
    assert.ok(!(await updated.text()).includes('rotated-private'));
    assert.equal((await request(f.headers)).status, 409);
    assert.equal(store.resolve('civitai').secrets.apiKey, 'rotated-private');
    await assert.rejects(store.update(reader, 'civitai', 2, { enabled: false }), {
      code: 'FORBIDDEN',
    });
  } finally {
    await f.close();
  }
});
test('registration requires initialization so an existing disk store cannot be overwritten', () =>
  directory(async (dir) => {
    const store = new IntegrationSettings(dir, env);
    await assert.rejects(
      store.register('vault', { civitai: { secrets: { apiKey: 'uninitialized' } } }),
      { code: 'REGISTRATION_REJECTED' },
    );
    await store.initialize();
    await store.register('vault', { civitai: { secrets: { apiKey: 'existing' } } });
    const before = await readFile(path.join(dir, 'integrations.json'), 'utf8');
    await assert.rejects(
      new IntegrationSettings(dir, env).register('vault', {
        civitai: { secrets: { apiKey: 'overwrite' } },
      }),
    );
    assert.equal(await readFile(path.join(dir, 'integrations.json'), 'utf8'), before);
  }));
