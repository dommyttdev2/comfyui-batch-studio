import assert from 'node:assert/strict';
import test from 'node:test';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { projectFixture } from './server-project-fixtures.mjs';
import { fixtureAgents } from './server-agent-fixtures.mjs';
import { login } from './server-project-http-fixtures.mjs';
import { createServerRuntime } from '../dist-server/server/runtime.js';
import { loadConfig } from '../dist-server/server/config.js';
import { FileLease } from '../dist-server/server/ownership.js';
test('killed server retains uncertain agent ownership, never reexecutes, and requires explicit discard', async () => {
  const f = await projectFixture();
  await f.repo.close();
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-crash-'));
  let child, runtime;
  try {
    child = fork(
      new URL('./server-agent-crash-fixtures.mjs', import.meta.url),
      [f.dir, directory],
      { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] },
    );
    const [ready] = await once(child, 'message');
    const headers = await login(ready, { buildId: ready.buildId });
    const base = '/api/v1/projects/' + f.id + '/agents/story/codex';
    const response = await fetch(ready.origin + base + '/chat', {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': 'crash-start' },
      body: JSON.stringify({ text: 'held', conversationId: null }),
    });
    assert.equal(response.status, 202);
    const { job } = await response.json();
    for (let i = 0; i < 100; i++) {
      const data = await readFile(path.join(f.dir, 'agents.json'), 'utf8').catch(() => null);
      if (data && JSON.parse(data).records.length) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    child = undefined;
    await assert.rejects(FileLease.acquire(path.join(f.dir, 'server.lock'), 'server', 'new'));
    await FileLease.reconcileDeadServer(path.join(f.dir, 'server.lock'));
    const projectRoot = path.join(f.root, 'Alpha');
    await FileLease.releaseVerified(
      path.join(projectRoot, '.batch-studio-owner-v1'),
      'project:' + f.id,
      async (owner) => {
        try {
          process.kill(owner.pid, 0);
          return false;
        } catch (e) {
          return e.code === 'ESRCH';
        }
      },
    );
    const agents = fixtureAgents(directory),
      config = await loadConfig({ dataDir: f.dir, port: 0 });
    runtime = await createServerRuntime(config, { agents });
    assert.equal(runtime.jobs.get(f.actor, job.id).state, 'uncertain');
    assert.equal(agents.state.starts, 0);
    const h = await login(runtime, config);
    const call = async (action, body = {}) => {
      const r = await fetch(runtime.origin + base + '/' + action, {
        method: 'POST',
        headers: { ...h, 'idempotency-key': 'recover-' + action.replaceAll('/', '-') },
        body: JSON.stringify(body),
      });
      return { status: r.status, body: await r.json() };
    };
    assert.equal((await call('jobs/' + job.id + '/reconcile')).body.job.state, 'uncertain');
    assert.equal((await call('chat', { text: 'another', conversationId: null })).status, 409);
    assert.equal(
      (await call('jobs/' + job.id + '/abandon', { acknowledge: 'discard-unknown-result' })).body
        .job.state,
      'cancelled',
    );
    assert.equal(agents.state.starts, 0);
  } finally {
    child?.kill('SIGKILL');
    await runtime?.close('stop');
    await f.close();
    await rm(directory, { recursive: true, force: true });
  }
});
