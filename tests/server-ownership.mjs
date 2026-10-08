import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';
import { FileLease, Ownership, ProjectRegistry, normalizeEndpoint } from '../dist-server/server/ownership.js';

test('ownership survives client lifetime and rejects another dataDir/server', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'batch-lock-'));
  const first = new Ownership(); const second = new Ownership();
  const serverDir = path.join(dir, 'server.lock');
  const lease = await FileLease.acquire(serverDir, 'server', first.serverId);
  const child = spawn(process.execPath, ['-e', 'process.exit(0)']);
  const pid = child.pid;
  await once(child, 'exit');
  try {
    await assert.rejects(FileLease.acquire(serverDir, 'server', second.serverId), /Ownership/);
    await assert.rejects(FileLease.reconcileDeadServer(serverDir), /alive/);
    const project = await first.project(dir, 'job-A');
    await assert.rejects(second.project(dir, 'job-B'));
    await project.release();
    const resource = await first.execution(dir, 'job-A', { endpoint: 'http://LOCALHOST:8188/' });
    await assert.rejects(second.execution(dir, 'job-B', { endpoint: 'http://localhost:8188' }));
    await resource.release();
    const next = await second.execution(dir, 'job-B', { endpoint: 'http://localhost:8188' });
    await next.release();
    const remote = await first.execution(dir, 'job-R', { provider: 'vastai', instanceId: 891234 });
    await assert.rejects(second.execution(dir, 'job-S', { provider: 'VASTAI', instanceId: 891234 }));
    await remote.release();
    assert.equal(normalizeEndpoint('http://LOCALHOST:80/'), 'http://127.0.0.1/');
    await assert.rejects(FileLease.reconcileDeadServer(serverDir));
    await lease.release();
    await mkdir(serverDir);
    await writeFile(path.join(serverDir, 'owner.json'), JSON.stringify({ schema: 'web-owner/1', serverId: 'dead', pid, host: os.hostname(), subject: 'server' }));
    await FileLease.reconcileDeadServer(serverDir);
    const restarted = await FileLease.acquire(serverDir, 'server', second.serverId);
    await restarted.release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('project registry canonicalizes aliases and refuses changed targets and old schemas', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'batch-project-'));
  const root = path.join(dir, 'project'); const alias = path.join(dir, 'alias');
  await mkdir(root);
  await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const actor = { userId: 'operator', sessionId: 'session', requestId: 'request', projectIds: ['A', 'B'], permissions: ['admin', 'read'] };
  const registry = new ProjectRegistry(dir);
  try {
    assert.equal(await registry.register(actor, 'A', root), 'A');
    assert.equal(await registry.register(actor, 'B', alias), 'A');
    assert.equal((JSON.parse(await readFile(path.join(dir, 'projects.json')))).projects.length, 1);
    assert.equal(await registry.resolve(actor, 'A'), await import('node:fs/promises').then((m) => m.realpath(root)));
    await assert.rejects(registry.resolve({ ...actor, projectIds: [] }, 'A'));
    await writeFile(path.join(dir, 'projects.json'), '{"schema":"legacy","projects":[]}');
    await assert.rejects(registry.resolve(actor, 'A'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
