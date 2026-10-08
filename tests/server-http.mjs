import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../dist-server/server/config.js';
import { startServer } from '../dist-server/server/server.js';
import { fields, HttpFailure } from '../dist-server/server/http.js';
import { BusinessError } from '../dist-server/domain/contracts.js';

test('HTTP contracts validate before invoking authorized core and normalize failures', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'batch-http-'));
  let calls = 0;
  const config = await loadConfig({ dataDir: dir, port: 0 });
  const commands = new Map([['save', {
    permission: 'edit', mutation: true,
    validate: (input) => fields(input, ['expectedRevision', 'leaseId']),
    execute: async (actor, input) => {
      calls++;
      if (input.expectedRevision !== 3) throw new BusinessError('REVISION_CONFLICT', 'private/path/secret');
      return { projectId: input.projectId, userId: actor.userId };
    },
  }], ['explode', {
    permission: 'read', validate: () => {}, execute: async () => { throw new Error('private-token'); },
  }]]);
  const runtime = await startServer(config, {
    commands,
    authenticate: async () => ({ userId: 'operator', sessionId: 'session', projectIds: ['A'], permissions: ['read', 'edit'] }),
  });
  const headers = { 'x-batch-api-version': '1', 'x-batch-build-id': config.buildId, 'x-request-id': 'request-1', 'content-type': 'application/json' };
  const post = (project, body, extra = {}, action = 'save') => fetch(runtime.origin + `/api/v1/projects/${project}/commands/${action}`, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('A', { expectedRevision: 3, leaseId: 'lease' })).status, 200);
    assert.equal(calls, 1);
    assert.equal((await post('B', { expectedRevision: 3, leaseId: 'lease' })).status, 403);
    assert.equal((await post('A', { leaseId: 'lease' })).status, 400);
    assert.equal((await post('A', { expectedRevision: '3', leaseId: 'lease' })).status, 400);
    assert.equal((await post('A', { expectedRevision: 3, leaseId: 'lease', root: '/forbidden' })).status, 400);
    assert.equal((await post('A', { expectedRevision: 3, leaseId: 'lease' }, { 'x-batch-build-id': 'old' })).status, 409);
    assert.equal((await post('A', [], {}, 'save')).status, 400);
    assert.equal(calls, 1);
    const conflict = await post('A', { expectedRevision: 0, leaseId: 'lease' });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.text()).includes('private'), false);
    const explode = await post('A', {}, {}, 'explode');
    assert.equal(explode.status, 500);
    assert.equal((await explode.text()).includes('private-token'), false);
    assert.equal((await post('A', { large: 'x'.repeat(70_000) })).status, 413);
    assert.equal((await post('A', {}, { 'content-type': 'text/plain' })).status, 415);
    assert.equal((await post('A', {}, {}, 'unknown')).status, 501);
    const bad = await fetch(runtime.origin + '/api/v1/projects/A/commands/save', { method: 'POST', headers, body: '{' });
    assert.equal(bad.status, 400);
    assert.throws(() => fields({ role: 'admin' }, []), HttpFailure);
  } finally {
    await runtime.close();
    await rm(dir, { recursive: true, force: true });
  }
});
