import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { projectFixture } from './server-project-fixtures.mjs';
import { fixtureAgents, seedBrief } from './server-agent-fixtures.mjs';
import { login } from './server-project-http-fixtures.mjs';
import { createServerRuntime } from '../dist-server/server/runtime.js';
import { loadConfig } from '../dist-server/server/config.js';
async function fixture(options = {}) {
  const f = await projectFixture();
  await f.repo.close();
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-http-')),
    agents = fixtureAgents(directory, options),
    config = await loadConfig({ dataDir: f.dir, port: 0 }),
    runtime = await createServerRuntime(config, { agents });
  const headers = await login(runtime, config);
  let count = 0;
  const base = '/api/v1/projects/' + f.id + '/agents/story/codex';
  const call = async (action, input, key) => {
    const r = await fetch(
      runtime.origin + (action.startsWith('/') ? action : base + '/' + action),
      input === undefined
        ? { headers }
        : {
            method: 'POST',
            headers: { ...headers, 'idempotency-key': key ?? 'agent-' + ++count },
            body: JSON.stringify(input),
          },
    );
    return { status: r.status, body: await r.json() };
  };
  return {
    ...f,
    config,
    runtime,
    agents,
    headers,
    base,
    call,
    close: async () => {
      await runtime.close('stop');
      await f.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
test('authenticated agent API connects models/chat/resume/task/draft and hides private IDs', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.call('availability')).body.state, 'available');
    assert.equal((await f.call('models')).body.models[0].id, 'fixture-model');
    const selected = await f.call('conversations/new', {});
    assert.equal(selected.status, 200);
    let res = await f.call(
      'chat',
      { text: 'hello', conversationId: selected.body.conversationId },
      'first',
    );
    assert.equal(res.status, 202);
    await f.runtime.jobs.drain();
    const count = f.agents.state.starts;
    assert.equal(
      (
        await f.call(
          'chat',
          { text: 'hello', conversationId: selected.body.conversationId },
          'first',
        )
      ).body.job.id,
      res.body.job.id,
    );
    assert.equal(f.agents.state.starts, count);
    res = await f.call('history');
    assert.equal(res.body.messages[1].text, 'Fixture codex answer');
    for (const id of f.agents.state.privateSessions)
      assert.ok(!JSON.stringify(res.body).includes(id));
    res = await f.call(
      'chat',
      { text: 'again', conversationId: selected.body.conversationId },
      'resume',
    );
    await f.runtime.jobs.drain();
    assert.equal(f.agents.state.resumes, 1);
    await seedBrief(f.runtime, f.actor, f.id);
    res = await f.call('task', { stage: 'story-finalize', extra: 'One paragraph' });
    assert.equal(res.status, 202);
    await f.runtime.jobs.drain();
    assert.equal(f.runtime.jobs.get(f.actor, res.body.job.id).state, 'succeeded');
    const p = await f.runtime.projectApi.projects.read(f.actor, { projectId: f.id });
    assert.equal(p.drafts.story.content, '# Fixture story');
    assert.equal(p.artifacts.story, undefined);
    const record = (await f.call('history')).body.records.find((r) => r.jobId === res.body.job.id);
    assert.equal(record.imported, true);
    const repeat = await f.call('jobs/' + res.body.job.id + '/import', {});
    assert.equal(repeat.status, 200);
    assert.equal(repeat.body.project.revision, p.revision);
    assert.equal(
      (await f.call('chat', { text: 'bad', conversationId: null, role: 'system' })).status,
      400,
    );
    assert.equal((await f.call('task', { stage: 'models' })).status, 400);
    assert.equal(
      (
        await f.call('/api/v1/projects/' + f.id + '/jobs/agent', {
          input: { kind: 'chat', text: 'bad', sessionId: null },
          stage: 'story',
          provider: 'codex',
          turnId: 'forged',
        })
      ).status,
      400,
    );
    const forged = await f.call(
      'chat',
      { text: 'bad session', conversationId: f.agents.state.privateSessions[0] },
      'forged',
    );
    assert.equal(forged.status, 404);
  } finally {
    await f.close();
  }
});
test('explicit stop and session gate do not depend on HTTP lifetime', async () => {
  const f = await fixture({ hold: true });
  try {
    const res = await f.call('chat', { text: 'held', conversationId: null });
    assert.equal(res.status, 202);
    assert.equal((await f.call('conversations/new', {})).status, 409);
    const stopped = await f.call('jobs/' + res.body.job.id + '/stop', {});
    assert.equal(stopped.status, 202);
    await f.runtime.jobs.drain();
    assert.equal(f.runtime.jobs.get(f.actor, res.body.job.id).state, 'cancelled');
    assert.equal((await f.call('conversations/new', {})).status, 200);
  } finally {
    await f.close();
  }
});
import { readFile, writeFile } from 'node:fs/promises';
test('revoking execute/edit while CLI is running prevents artifact import', async () => {
  const f = await fixture({ delay: 300 });
  try {
    await seedBrief(f.runtime, f.actor, f.id);
    const result = await f.call('task', { stage: 'story-finalize', extra: '' });
    assert.equal(result.status, 202);
    for (let i = 0; i < 100 && f.agents.state.starts === 0; i++)
      await new Promise((r) => setTimeout(r, 5));
    assert.equal(f.agents.state.starts, 1);
    const authFile = path.join(f.dir, 'auth.json');
    const auth = JSON.parse(await readFile(authFile, 'utf8'));
    auth.principals[0].permissions = ['read'];
    await writeFile(authFile, JSON.stringify(auth));
    await f.runtime.jobs.drain();
    assert.equal(f.runtime.jobs.get(f.actor, result.body.job.id).state, 'failed');
    const project = await f.runtime.projectApi.projects.read(f.actor, { projectId: f.id });
    assert.equal(project.drafts.story, undefined);
    const history = await f.call('history');
    assert.equal(history.status, 401);
    const records = f.runtime.agents.store.publicRecords(f.actor, {
      projectId: f.id,
      stage: 'story',
      provider: 'codex',
    });
    assert.equal(records[0].imported, false);
    assert.equal(records[0].importError, 'FORBIDDEN');
  } finally {
    await f.close();
  }
});
test('model preferences persist per provider and declared reasoning capabilities reach the CLI', async () => {
  const f = await fixture();
  let restarted;
  try {
    const lease = (await f.call('/api/v1/projects/' + f.id + '/commands/acquire-lease', {})).body
      .project;
    const input = {
      expectedRevision: lease.revision,
      leaseId: lease.lease.leaseId,
      model: 'fixture-model',
      reasoningEffort: 'high',
    };
    const saved = await f.call('preferences', input, 'model-selection');
    assert.equal(saved.status, 200);
    assert.equal((await f.call('preferences')).body.model.reasoningEffort, 'high');
    assert.equal(
      (await f.call('/api/v1/projects/' + f.id + '/agents/story/grok/preferences')).body.model,
      undefined,
    );
    const invalid = await f.call('preferences', {
      ...input,
      expectedRevision: saved.body.project.revision,
      reasoningEffort: 'invented',
    });
    assert.equal(invalid.status, 400);
    await f.call('chat', { text: 'model selection', conversationId: null });
    await f.runtime.jobs.drain();
    assert.deepEqual(f.agents.state.tasks[0].model, {
      model: 'fixture-model',
      reasoningEffort: 'high',
    });
    await f.runtime.close();
    restarted = await createServerRuntime(f.config, { agents: f.agents });
    const headers = await login(restarted, f.config);
    const response = await fetch(restarted.origin + f.base + '/preferences', { headers });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).model.reasoningEffort, 'high');
  } finally {
    await restarted?.close('stop');
    await f.close();
  }
});
