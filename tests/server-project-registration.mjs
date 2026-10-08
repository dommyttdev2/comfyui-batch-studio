import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import { ProjectRegistration, segment } from '../dist-server/server/project-registration.js';
import { atomicJson } from '../dist-server/server/storage.js';
import { writeAuth } from './server-fixtures.mjs';
const actor = {
  userId: 'operator',
  sessionId: 'session',
  requestId: 'request',
  projectIds: [],
  permissions: ['read', 'edit', 'admin'],
};
test('Project provisioning grants new identity durably, deduplicates and scopes canonical roots', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'web-project-register-'));
  const root = path.join(dir, 'root');
  await mkdir(root);
  await writeAuth(dir);
  await atomicJson(path.join(dir, 'project-roots.json'), {
    schema: 'web-project-roots/1',
    roots: [{ id: 'root', name: 'Projects', root }],
  });
  const registry = new ProjectRegistration(dir);
  try {
    await registry.initialize();
    const input = { rootId: 'root', directoryName: 'Alpha', displayName: 'Alpha' };
    const results = await Promise.all(
      Array.from({ length: 10 }, () => registry.provision(actor, 'create-A', input, 'create')),
    );
    assert.equal(new Set(results.map((r) => r.id)).size, 1);
    const id = results[0].id;
    assert.equal((await registry.list(actor)).length, 0);
    const scoped = { ...actor, projectIds: [id] };
    assert.equal((await registry.list(scoped)).length, 1);
    const auth = JSON.parse(await readFile(path.join(dir, 'auth.json'), 'utf8'));
    assert.ok(auth.principals[0].projectIds.includes(id));
    assert.equal(await registry.registry.resolve(scoped, id), path.join(root, 'Alpha'));
    await assert.rejects(
      registry.provision(actor, 'create-A', { ...input, displayName: 'changed' }, 'create'),
      /OPERATION_KEY_CONFLICT/,
    );
    await assert.rejects(
      registry.provision({ ...actor, permissions: ['read'] }, 'no', input, 'create'),
      /FORBIDDEN/,
    );
    await assert.rejects(
      registry.provision(actor, 'duplicate', input, 'create'),
      /DIRECTORY_EXISTS/,
    );
    const restarted = new ProjectRegistration(dir);
    await restarted.initialize();
    assert.equal((await restarted.provision(actor, 'create-A', input, 'create')).id, id);
    for (const value of ['..', '../x', 'CON', 'nul', 'a/', 'a.', 'a\\b'])
      assert.throws(() => segment(value));
    const stored = JSON.parse(await readFile(path.join(dir, 'provisioning.json'), 'utf8'));
    stored.intents[0].state = 'reserved';
    await atomicJson(path.join(dir, 'provisioning.json'), stored);
    await restarted.initialize();
    assert.equal((await restarted.provision(actor, 'create-A', input, 'create')).id, id);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
