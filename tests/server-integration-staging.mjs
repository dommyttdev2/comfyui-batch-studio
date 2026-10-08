import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, appendFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Staging } from '../dist-server/server/staging.js';
import { fixture } from './server-fixtures.mjs';
const actor = {
  userId: 'operator',
  sessionId: 'session',
  requestId: 'request',
  projectIds: ['A'],
  permissions: ['read', 'execute', 'admin'],
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function setup() {
  let staging;
  const f = await fixture({
    route: (ctx) => staging.route(ctx),
    binaryRoute: (ctx) => staging.binaryRoute(ctx),
  });
  staging = new Staging(f.dir);
  await staging.initialize();
  const root = f.runtime.origin + '/api/v1/resources/staging';
  const post = (path, input) =>
    fetch(root + path, { method: 'POST', headers: f.headers, body: JSON.stringify(input) });
  const upload = (id, offset, bytes, headers = {}) =>
    fetch(root + '/' + id, {
      method: 'PUT',
      headers: {
        ...f.headers,
        'content-type': 'application/octet-stream',
        'x-upload-offset': String(offset),
        'x-upload-sha256': hash(bytes),
        ...headers,
      },
      body: bytes,
    });
  return { ...f, staging, root, post, upload };
}
test('binary streaming preserves auth/CSRF/build and offset/hash; complete is a verified resource, not a physical path', async () => {
  const f = await setup();
  try {
    const record = await (
      await f.post('', {
        projectId: 'A',
        name: 'model.safetensors',
        size: 8,
        sha256: hash('testdata'),
      })
    ).json();
    assert.equal(
      (await f.upload(record.id, 0, Buffer.from('test'), { 'x-csrf-token': 'wrong' })).status,
      403,
    );
    assert.equal(
      (await f.upload(record.id, 0, Buffer.from('test'), { 'x-batch-build-id': 'wrong' })).status,
      409,
    );
    assert.equal((await f.upload(record.id, 0, Buffer.from('test'), { cookie: '' })).status, 401);
    assert.equal((await f.upload(record.id, 0, Buffer.from('test'))).status, 200);
    assert.equal((await f.upload(record.id, 0, Buffer.from('test'))).status, 409);
    assert.equal(
      (await f.upload(record.id, 4, Buffer.from('data'), { 'x-upload-sha256': hash('wrong') }))
        .status,
      409,
    );
    assert.equal((await readFile(path.join(f.dir, 'staging', record.id))).toString(), 'test');
    assert.equal((await f.upload(record.id, 4, Buffer.from('data'))).status, 200);
    const result = await (await f.post('/' + record.id + '/complete', {})).json();
    assert.equal(result.state, 'complete');
    assert.equal(result.sha256, hash('testdata'));
    assert.equal(result.offset, 8);
    assert.ok(!JSON.stringify(result).includes(f.dir));
    assert.equal((await f.upload(record.id, 8, Buffer.from('x'))).status, 409);
  } finally {
    await f.close();
  }
});
test('interrupted chunk rolls back uncommitted bytes; restart discards only orphan tail and resumes at durable offset', async () => {
  const f = await setup();
  try {
    const record = await (await f.post('', { name: 'source', size: 16 })).json();
    await f.upload(record.id, 0, Buffer.from('test'));
    await new Promise((resolve) => {
      const request = http.request(f.root + '/' + record.id, {
        method: 'PUT',
        headers: {
          ...f.headers,
          'content-type': 'application/octet-stream',
          'content-length': '12',
          'x-upload-offset': '4',
          'x-upload-sha256': hash('partial-more'),
        },
      });
      request.on('error', () => resolve());
      request.write('partial');
      setTimeout(() => request.destroy(), 15);
    });
    await f.staging.drain();
    assert.equal((await readFile(path.join(f.dir, 'staging', record.id))).toString(), 'test');
    await appendFile(path.join(f.dir, 'staging', record.id), 'crash-tail');
    const restored = new Staging(f.dir);
    await restored.initialize();
    assert.equal((await readFile(path.join(f.dir, 'staging', record.id))).toString(), 'test');
    const info = await fetch(f.root + '/' + record.id, { headers: f.headers });
    assert.equal((await info.json()).offset, 4);
  } finally {
    await f.close();
  }
});
test('owners, total size, chunk size and final source hash are enforced without accepting arbitrary filesystem paths', async () => {
  const f = await setup();
  try {
    assert.equal((await f.post('', { name: 'x', size: 1, filePath: 'C:/secret' })).status, 400);
    assert.equal((await f.post('', { name: 'x', size: 101 * 1024 ** 3 })).status, 400);
    const record = await f.staging.create(actor, {
      name: 'source',
      size: 4,
      sha256: hash('expected'),
    });
    assert.equal((await f.upload(record.id, 0, Buffer.from('test'))).status, 200);
    await assert.rejects(f.staging.complete(actor, record.id), { code: 'SOURCE_HASH_MISMATCH' });
    await assert.rejects(f.staging.complete({ ...actor, userId: 'other' }, record.id), {
      code: 'NOT_FOUND',
    });
    await f.staging.create(actor, { name: 'large-1', size: 100 * 1024 ** 3 });
    await assert.rejects(f.staging.create(actor, { name: 'large-2', size: 100 * 1024 ** 3 }), {
      code: 'STAGING_QUOTA',
    });
  } finally {
    await f.close();
  }
});
test('empty resources can complete and expiry requires explicit owner cleanup; unknown schema rejects', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'staging-expiry-'));
  let clock = 0;
  try {
    const staging = new Staging(dir, () => clock);
    await staging.initialize();
    const r = await staging.create(actor, { name: 'empty', size: 0 });
    assert.equal((await staging.complete(actor, r.id)).sha256, hash(''));
    clock = r.expiresAt;
    await assert.rejects(staging.complete(actor, r.id), { code: 'RESOURCE_EXPIRED' });
    await appendFile(path.join(dir, 'staging.json'), 'corrupt');
    await assert.rejects(new Staging(dir).initialize(), { code: 'STAGING_UNAVAILABLE' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('completed staging stays pinned across restart and prevents deletion until known job release', async () => {
  const f = await setup();
  try {
    const r = await f.staging.create(actor, { name: 'source', size: 0 });
    await f.staging.complete(actor, r.id);
    await f.staging.pin(actor, r.id, 'job');
    const restored = new Staging(f.dir);
    await restored.initialize();
    assert.equal((await restored.source(actor, r.id, 'job')).size, 0);
    assert.equal((await f.post('/' + r.id + '/delete', {})).status, 409);
    await f.staging.release(r.id, 'job');
    assert.equal((await f.post('/' + r.id + '/delete', {})).status, 200);
  } finally {
    await f.close();
  }
});
import { mkdir, writeFile } from 'node:fs/promises';
import { FileResources } from '../dist-server/server/file-resources.js';
test('server files are explicitly registered resources with Project grants; changes and arbitrary roots reject', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'registered-file-'));
  try {
    const data = path.join(dir, 'data'),
      root = path.join(dir, 'models');
    await mkdir(data);
    await mkdir(root);
    const file = path.join(root, 'model.safetensors');
    await writeFile(file, 'model');
    const resources = new FileResources(data);
    await resources.initialize();
    await resources.register({ id: 'model', root, file, projectIds: ['A'] });
    const publicValue = JSON.stringify(resources.list(actor));
    assert.ok(!publicValue.includes(dir));
    assert.ok(!publicValue.includes('file'));
    assert.equal((await resources.source(actor, 'model', 'A')).file, file);
    await assert.rejects(resources.source({ ...actor, projectIds: [] }, 'model', 'A'), {
      code: 'FORBIDDEN',
    });
    await assert.rejects(
      resources.register({
        id: 'duplicate-root',
        root,
        file: path.join(data, 'files.json'),
        projectIds: ['A'],
      }),
      { code: 'RESOURCE_REJECTED' },
    );
    await appendFile(file, 'changed');
    await assert.rejects(resources.source(actor, 'model', 'A'), { code: 'SOURCE_CHANGED' });
    const restored = new FileResources(data);
    await restored.initialize();
    assert.equal(restored.list(actor).resources[0].id, 'model');
    await writeFile(path.join(data, 'files.json'), '{"schema":"legacy"}');
    await assert.rejects(new FileResources(data).initialize(), {
      code: 'FILE_RESOURCES_UNAVAILABLE',
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
