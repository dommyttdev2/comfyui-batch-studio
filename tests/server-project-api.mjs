import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectFixture } from './server-project-fixtures.mjs';
import { createServerRuntime } from '../dist-server/server/runtime.js';
import { loadConfig } from '../dist-server/server/config.js';
import { token } from './server-fixtures.mjs';
export async function login(runtime, config) {
  const base = {
    'x-batch-api-version': '1',
    'x-batch-build-id': config.buildId,
    'x-request-id': 'api-request',
    'content-type': 'application/json',
    origin: runtime.origin,
  };
  const res = await fetch(runtime.origin + '/api/v1/session', {
    method: 'POST',
    headers: { ...base, authorization: 'Bearer ' + token },
    body: '{}',
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  return {
    ...base,
    cookie: res.headers.get('set-cookie').split(';')[0],
    'x-csrf-token': body.csrfToken,
  };
}
test('real authenticated Project API edits, confirms, consumes scoped reset and rejects stale work', async () => {
  const f = await projectFixture();
  await f.repo.close();
  const config = await loadConfig({ dataDir: f.dir, port: 0 });
  const runtime = await createServerRuntime(config);
  try {
    const headers = await login(runtime, config);
    let counter = 0;
    const command = async (action, input, key = 'api-' + ++counter) => {
      const res = await fetch(runtime.origin + '/api/v1/projects/' + f.id + '/commands/' + action, {
        method: 'POST',
        headers: { ...headers, 'idempotency-key': key },
        body: JSON.stringify(input),
      });
      return { status: res.status, body: await res.json() };
    };
    let res = await command('acquire-lease', {});
    assert.equal(res.status, 200);
    let p = res.body.project;
    const leaseId = p.lease.leaseId;
    res = await command('save-draft', {
      expectedRevision: p.revision,
      leaseId,
      key: 'story',
      content: '# Story',
    });
    assert.equal(res.status, 200);
    p = res.body.project;
    res = await command('confirm-artifact', {
      expectedRevision: p.revision,
      leaseId,
      key: 'story',
    });
    assert.equal(res.status, 200);
    p = res.body.project;
    assert.equal(p.artifacts.story.status, 'confirmed');
    let prepared = await command('prepare-reset', {
      expectedRevision: p.revision,
      leaseId,
      target: 'story',
      stage: false,
    });
    assert.equal(prepared.status, 200);
    const old = prepared.body.confirmation.id;
    res = await command('renew-lease', { expectedRevision: p.revision, leaseId });
    p = res.body.project;
    res = await command('reset-artifact', {
      expectedRevision: p.revision,
      leaseId,
      key: 'story',
      confirmationId: old,
    });
    assert.equal(res.status, 409);
    prepared = await command('prepare-reset', {
      expectedRevision: p.revision,
      leaseId,
      target: 'story',
      stage: false,
    });
    const input = {
      expectedRevision: p.revision,
      leaseId,
      key: 'story',
      confirmationId: prepared.body.confirmation.id,
    };
    res = await command('reset-artifact', input, 'reset');
    assert.equal(res.status, 200);
    assert.equal(res.body.project.artifacts.story, undefined);
    assert.equal((await command('reset-artifact', input, 'reset')).status, 200);
    assert.equal((await command('reset-artifact', input, 'other-reset')).status, 409);
    assert.equal(
      (await command('save-draft', { ...input, root: '/etc', content: 'bad' })).status,
      400,
    );
    const read = await fetch(runtime.origin + '/api/v1/projects/' + f.id, { headers });
    assert.equal(read.status, 200);
    const text = await read.text();
    assert.equal(text.includes(f.root), false);
    const no = await fetch(runtime.origin + '/api/v1/projects/unknown', { headers });
    assert.equal(no.status, 403);
    const publicRead = await fetch(runtime.origin + '/api/v1/projects/' + f.id, {
      headers: { 'x-batch-api-version': '1', 'x-batch-build-id': config.buildId },
    });
    assert.equal(publicRead.status, 401);
  } finally {
    await runtime.close();
    await f.close();
  }
});
