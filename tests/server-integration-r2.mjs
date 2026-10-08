import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { IntegrationSettings } from '../dist-server/server/integration-settings.js';
import { R2Service } from '../dist-server/server/r2-service.js';
import { ExternalOperations } from '../dist-server/server/external-operations.js';
import { fixture } from './server-fixtures.mjs';
const actor = {
  userId: 'operator',
  sessionId: 'session',
  requestId: 'request',
  projectIds: [],
  permissions: ['read', 'admin'],
};
const environment = {
  BATCH_STUDIO_SECRET_R2_ACCESS_KEY_ID: 'fixture-r2-id',
  BATCH_STUDIO_SECRET_R2_SECRET_ACCESS_KEY: 'fixture-r2-secret',
};
async function setup(dir) {
  const source = { ...environment };
  const settings = new IntegrationSettings(dir, source);
  await settings.initialize();
  await settings.register('environment', { r2: { account: 'a'.repeat(32) } });
  const objects = new Map([
    ['models/a.safetensors', { size: 4, etag: 'etag', bytes: Buffer.from('test') }],
  ]);
  const calls = [];
  let loseCopy = false;
  const port = {
    send: async (name, input) => {
      calls.push(name);
      if (name === 'ListBuckets')
        return { Buckets: [{ Name: 'bucket', CreationDate: new Date(0) }] };
      if (name === 'ListObjectsV2')
        return {
          Contents: [...objects]
            .filter(([key]) => key.startsWith(input.Prefix))
            .map(([Key, row]) => ({
              Key,
              Size: row.size,
              ETag: row.etag,
              LastModified: new Date(0),
            })),
          IsTruncated: false,
        };
      if (name === 'HeadObject') {
        const row = objects.get(input.Key);
        if (!row) throw { $metadata: { httpStatusCode: 404 } };
        return { ContentLength: row.size, ETag: row.etag };
      }
      if (name === 'CopyObject') {
        const sourceKey = decodeURIComponent(input.CopySource.split('/').slice(1).join('/'));
        const row = objects.get(sourceKey);
        assert.equal(input.CopySourceIfMatch, row.etag);
        objects.set(input.Key, row);
        if (loseCopy) throw new Error('lost copy response');
        return { CopyObjectResult: { ETag: row.etag } };
      }
      if (name === 'DeleteObject') {
        const row = objects.get(input.Key);
        if (row && input.IfMatch !== row.etag) throw new Error('precondition failed');
        objects.delete(input.Key);
        return {};
      }
      if (name === 'GetObject') {
        const row = objects.get(input.Key);
        return { Body: Readable.from([row.bytes]), ContentLength: row.size };
      }
      throw new Error('Unexpected command ' + name);
    },
    signed: async (name) => 'https://r2.invalid/fixture-' + name,
  };
  const definitions = new Map();
  const service = new R2Service(dir, settings, definitions, port);
  await service.initialize();
  const operations = new ExternalOperations(dir, definitions);
  await operations.initialize();
  return {
    service,
    operations,
    definitions,
    objects,
    source,
    calls,
    loseCopy: () => {
      loseCopy = true;
    },
  };
}
async function directory(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'web-r2-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
test('R2 current index uses P1 search inputs, strict schema and credential generation; legacy files are ignored', () =>
  directory(async (dir) => {
    await writeFile(path.join(dir, 'r2-object-index.json'), '{"objects":[{"key":"legacy"}]}');
    const f = await setup(dir);
    assert.throws(() => f.service.indexedObjects('bucket'), { code: 'R2_INDEX_UNAVAILABLE' });
    await f.service.syncIndex(actor);
    assert.equal(f.service.indexedObjects('bucket')[0].key, 'models/a.safetensors');
    const raw = await readFile(path.join(dir, 'r2.json'), 'utf8');
    assert.ok(!raw.includes('fixture-r2-secret'));
    f.source.BATCH_STUDIO_SECRET_R2_SECRET_ACCESS_KEY = 'rotated-secret';
    assert.throws(() => f.service.indexedObjects('bucket'), { code: 'R2_INDEX_UNAVAILABLE' });
  }));
test('R2 delete target requires confirmation, rechecks etag and never deletes changed object', () =>
  directory(async (dir) => {
    const f = await setup(dir);
    const target = await f.service.createTarget(actor, {
      operation: 'delete-objects',
      bucket: 'bucket',
      keys: ['models/a.safetensors'],
    });
    assert.ok(!f.calls.includes('DeleteObject'));
    const p = await f.operations.prepare(actor, target.operation, target.targetId);
    f.objects.get('models/a.safetensors').etag = 'changed';
    await assert.rejects(
      f.operations.confirm(actor, target.operation, target.targetId, p.confirmationId),
      { code: 'TARGET_CHANGED' },
    );
    assert.ok(!f.calls.includes('DeleteObject'));
    const fresh = await f.operations.prepare(actor, target.operation, target.targetId);
    const r = await f.operations.confirm(
      actor,
      target.operation,
      target.targetId,
      fresh.confirmationId,
    );
    await f.operations.drain();
    assert.equal(f.operations.read(actor, r.id).state, 'succeeded');
    assert.equal(f.objects.size, 0);
  }));
test('R2 lost copy response keeps source, persists uncertainty and does not replay effects during reconciliation', () =>
  directory(async (dir) => {
    const f = await setup(dir);
    f.loseCopy();
    const target = await f.service.createTarget(actor, {
      operation: 'move-object',
      bucket: 'bucket',
      keys: ['models/a.safetensors'],
      destination: 'models/b.safetensors',
    });
    const p = await f.operations.prepare(actor, target.operation, target.targetId);
    const r = await f.operations.confirm(
      actor,
      target.operation,
      target.targetId,
      p.confirmationId,
    );
    await f.operations.drain();
    assert.equal(f.operations.read(actor, r.id).state, 'uncertain');
    assert.ok(f.objects.has('models/a.safetensors'));
    assert.ok(f.objects.has('models/b.safetensors'));
    const count = f.calls.filter((n) => n === 'CopyObject').length;
    assert.equal((await f.operations.reconcile(actor, r.id)).state, 'uncertain');
    assert.equal(f.calls.filter((n) => n === 'CopyObject').length, count);
    assert.ok(!f.calls.includes('DeleteObject'));
  }));
test('credential rotation cannot bypass bucket scope exclusion of uncertain prior operation', () =>
  directory(async (dir) => {
    const f = await setup(dir);
    f.loseCopy();
    const first = await f.service.createTarget(actor, {
      operation: 'move-object',
      bucket: 'bucket',
      keys: ['models/a.safetensors'],
      destination: 'models/b.safetensors',
    });
    const p = await f.operations.prepare(actor, first.operation, first.targetId);
    await f.operations.confirm(actor, first.operation, first.targetId, p.confirmationId);
    await f.operations.drain();
    f.source.BATCH_STUDIO_SECRET_R2_SECRET_ACCESS_KEY = 'rotated-secret';
    const next = await f.service.createTarget(actor, {
      operation: 'delete-objects',
      bucket: 'bucket',
      keys: ['models/a.safetensors'],
    });
    const fresh = await f.operations.prepare(actor, next.operation, next.targetId);
    await assert.rejects(
      f.operations.confirm(actor, next.operation, next.targetId, fresh.confirmationId),
      { code: 'EXTERNAL_SCOPE_BUSY' },
    );
  }));
test('R2 API strictly validates fields/auth and streams downloads; templates persist through restart', async () => {
  let service;
  const http = await fixture({ route: (ctx) => service.route(ctx) });
  try {
    const f = await setup(http.dir);
    service = f.service;
    const url = http.runtime.origin + '/api/v1/integrations/r2/';
    const get = (endpoint) => fetch(url + endpoint, { headers: http.headers });
    const post = (endpoint, input) =>
      fetch(url + endpoint, { method: 'POST', headers: http.headers, body: JSON.stringify(input) });
    assert.equal((await get('list?bucket=bucket&apiUrl=https://evil.invalid')).status, 400);
    assert.equal((await get('list?bucket=bucket&bucket=another')).status, 400);
    assert.equal((await fetch(url + 'buckets', { headers: http.baseHeaders })).status, 401);
    await post('index', {});
    assert.equal(
      (await (await get('search?bucket=bucket&query=a.safe')).json()).objects[0].key,
      'models/a.safetensors',
    );
    const metrics = await (await get('metrics')).json();
    const saved = await post('save-template', {
      expectedRevision: metrics.revision,
      template: {
        name: 'models',
        bucket: 'bucket',
        objects: [{ key: 'models/a.safetensors', name: 'a.safetensors', size: 4 }],
      },
    });
    assert.equal(saved.status, 200);
    const download = await get('download?bucket=bucket&key=models%2Fa.safetensors');
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-type'), 'application/octet-stream');
    assert.equal(await download.text(), 'test');
    const restoredSettings = new IntegrationSettings(http.dir, environment);
    await restoredSettings.initialize();
    const restored = new R2Service(http.dir, restoredSettings, new Map(), {
      send: async () => {},
      signed: async () => '',
    });
    await restored.initialize();
    service = restored;
    assert.equal((await (await get('templates?bucket=bucket')).json()).templates[0].name, 'models');
  } finally {
    await http.close();
  }
});
test('unknown R2 store and invalid object paths reject without overwrite or external mutation', () =>
  directory(async (dir) => {
    const f = await setup(dir);
    await assert.rejects(
      f.service.createTarget(actor, {
        operation: 'move-object',
        bucket: 'bucket',
        keys: ['models/a.safetensors'],
        destination: '../escape',
      }),
    );
    await assert.rejects(
      f.service.createTarget(
        { ...actor, permissions: ['read'] },
        { operation: 'delete-objects', bucket: 'bucket', keys: ['models/a.safetensors'] },
      ),
      { code: 'FORBIDDEN' },
    );
    assert.ok(!f.calls.includes('DeleteObject'));
    const file = path.join(dir, 'r2.json');
    await writeFile(file, '{"schema":"legacy"}', { mode: 0o600 });
    const settings = new IntegrationSettings(dir, environment);
    await settings.initialize();
    await assert.rejects(
      new R2Service(dir, settings, new Map(), {
        send: async () => {},
        signed: async () => '',
      }).initialize(),
      { code: 'R2_STORE_UNAVAILABLE' },
    );
    assert.equal(await readFile(file, 'utf8'), '{"schema":"legacy"}');
  }));

test('R2 confirmation operation must match the immutable server target action', () =>
  directory(async (dir) => {
    const f = await setup(dir);
    const target = await f.service.createTarget(actor, {
      operation: 'move-object',
      bucket: 'bucket',
      keys: ['models/a.safetensors'],
      destination: 'models/b.safetensors',
    });
    await assert.rejects(f.operations.prepare(actor, 'delete-bucket', target.targetId), {
      code: 'INVALID_OPERATION',
    });
    assert.ok(!f.calls.includes('CopyObject'));
    assert.ok(!f.calls.includes('DeleteObject'));
  }));
