import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentRuntime } from '../dist-server/server/agent-runtime.js';
import { JobRegistry } from '../dist-server/server/jobs.js';
import { projectFixture } from './server-project-fixtures.mjs';
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
async function poll(fn) {
  for (let n = 0; n < 400; n++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('Timed out');
}
test('chat/task share a durable reservation before availability and duplicate requests do not launch', async () => {
  const f = await projectFixture(),
    directory = await mkdtemp(path.join(os.tmpdir(), 'agent-runtime-'));
  const availability = deferred(),
    finished = deferred();
  let probed = 0,
    starts = 0;
  const defs = new Map(),
    jobs = new JobRegistry(f.dir, defs);
  const adapter = {
    provider: 'codex',
    capabilities: {},
    getModels: async () => ({ models: [{ id: 'model' }], selection: { model: 'model' } }),
    checkAvailability: async () => {
      probed++;
      await availability.promise;
      return { state: 'available' };
    },
    startTask: async (_task, onEvent) => {
      starts++;
      onEvent({ type: 'session.started', at: 1, sessionId: 'cli-session' });
      onEvent({ type: 'turn.started', at: 1, turnId: 'cli-turn' });
      onEvent({ type: 'message.completed', at: 1, text: 'scoped answer' });
      return { provider: 'codex', sessionId: 'cli-session', turnId: 'cli-turn' };
    },
    waitForCompletion: async () => finished.promise,
    shutdown: async () => finished.resolve(),
    stop: async () => finished.resolve(),
  };
  const runtime = new AgentRuntime(f.dir, f.repo, { read: async () => null }, jobs, {
    directory,
    adapter: () => adapter,
    stopped: async () => true,
  });
  defs.set('agent', runtime.definition);
  await jobs.initialize();
  await runtime.initialize();
  const command = {
    projectId: f.id,
    stage: 'story',
    provider: 'codex',
    kind: 'chat',
    text: 'hello',
    sessionId: null,
  };
  try {
    const first = runtime.bind(f.actor).chat.start(f.actor, command);
    await poll(() => probed === 1);
    const disk = JSON.parse(await readFile(path.join(f.dir, 'jobs.json'), 'utf8'));
    assert.equal(disk.jobs[0].state, 'reserved');
    assert.equal(starts, 0);
    const repeat = await runtime.bind(f.actor).chat.start(f.actor, command);
    assert.equal(repeat.id, disk.jobs[0].id);
    const other = { ...f.actor, requestId: 'different' };
    await assert.rejects(
      runtime
        .bind(other)
        .tasks.start(other, { projectId: f.id, stage: 'story-finalize', provider: 'codex' }),
      /reserved/,
    );
    await assert.rejects(
      runtime.bind(f.actor).chat.start(f.actor, { ...command, text: 'changed' }),
      /changed/,
    );
    availability.resolve();
    const started = await first;
    await poll(() => starts === 1);
    await assert.rejects(jobs.cancel({ ...f.actor, userId: 'other' }, started.id));
    assert.equal(jobs.get(f.actor, started.id).state, 'running');
    finished.resolve();
    await jobs.drain();
    assert.equal(jobs.get(f.actor, started.id).state, 'succeeded');
    assert.equal(starts, 1);
    assert.equal(
      runtime.store.history(f.actor, { projectId: f.id, stage: 'story', provider: 'codex' })
        .messages[1].text,
      'scoped answer',
    );
    const c = runtime.store.history(f.actor, {
      projectId: f.id,
      stage: 'story',
      provider: 'codex',
    }).conversationId;
    const scoped = { ...f.actor, requestId: 'foreign' };
    await assert.rejects(
      runtime.bind(scoped).chat.start(scoped, { ...command, stage: 'models', sessionId: c }),
    );
    assert.equal(jobs.list(f.actor).find((j) => j.stage === 'models').state, 'failed');
  } finally {
    availability.resolve();
    finished.resolve();
    await jobs.drain();
    await f.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test('unlaunched reservation survives restart as uncertain without executing', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'agent-reservation-'));
  const actor = {
    userId: 'user',
    sessionId: 'session',
    requestId: 'request',
    projectIds: ['project'],
    permissions: ['read', 'execute', 'admin'],
  };
  let runs = 0;
  const defs = new Map([
    [
      'agent',
      {
        validate: () => {},
        run: async () => {
          runs++;
          return { state: 'succeeded' };
        },
      },
    ],
  ]);
  try {
    const jobs = new JobRegistry(dir, defs);
    await jobs.initialize();
    const pending = await jobs.reserve(
      actor,
      'project',
      'agent',
      'key',
      { kind: 'chat' },
      { stage: 'story', provider: 'codex', turnId: 'turn' },
    );
    assert.equal(runs, 0);
    const resumed = new JobRegistry(dir, defs);
    await resumed.initialize();
    assert.equal(resumed.get(actor, pending.job.id).state, 'uncertain');
    await assert.rejects(
      resumed.reserve(
        actor,
        'project',
        'agent',
        'different',
        { kind: 'task' },
        { stage: 'story', provider: 'codex', turnId: 'turn' },
      ),
    );
    assert.equal(runs, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
import { fixtureAgents } from './server-agent-fixtures.mjs';
test('forced agent shutdown keeps uncertainty and fences late CLI events', async () => {
  const f = await projectFixture(),
    directory = await mkdtemp(path.join(os.tmpdir(), 'agent-force-'));
  const fixture = fixtureAgents(directory, { hold: true });
  let sink;
  const options = {
    ...fixture,
    adapter: (scope, id) => {
      const adapter = fixture.adapter(scope, id),
        start = adapter.startTask;
      adapter.startTask = (task, receive) => {
        sink = receive;
        return start(task, receive);
      };
      return adapter;
    },
  };
  const defs = new Map(),
    jobs = new JobRegistry(f.dir, defs),
    runtime = new AgentRuntime(f.dir, f.repo, { read: async () => null }, jobs, options);
  defs.set('agent', runtime.definition);
  try {
    await jobs.initialize();
    await runtime.initialize();
    const job = await runtime
      .bind(f.actor)
      .chat.start(f.actor, {
        projectId: f.id,
        stage: 'story',
        provider: 'codex',
        kind: 'chat',
        text: 'held',
        sessionId: null,
      });
    await poll(() => fixture.state.starts === 1);
    await jobs.forceUncertain();
    assert.equal(jobs.get(f.actor, job.id).state, 'uncertain');
    assert.equal(fixture.state.active.size, 0);
    assert.throws(
      () => sink({ type: 'message.completed', at: Date.now(), text: 'late replacement' }),
      /fenced/,
    );
    assert.ok(
      !JSON.stringify(
        runtime.store.history(f.actor, { projectId: f.id, stage: 'story', provider: 'codex' }),
      ).includes('late replacement'),
    );
  } finally {
    await jobs.drain();
    await f.close();
    await rm(directory, { recursive: true, force: true });
  }
});
