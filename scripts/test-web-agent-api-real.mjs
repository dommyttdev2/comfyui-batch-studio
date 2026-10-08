import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { projectFixture } from '../tests/server-project-fixtures.mjs';
import { login } from '../tests/server-project-http-fixtures.mjs';
import { seedBrief } from '../tests/server-agent-fixtures.mjs';
import { createServerRuntime } from '../dist-server/server/runtime.js';
import { loadConfig } from '../dist-server/server/config.js';
const required = (n) => {
  if (!process.env[n]) throw Error(n + ' required');
  return process.env[n];
};
const directory = path.resolve(required('WEB_AGENT_RUNTIME_DIR'));
await mkdir(directory, { recursive: true });
const f = await projectFixture();
await f.repo.close();
await writeFile(
  path.join(f.dir, 'agent-runtime.json'),
  JSON.stringify({
    schema: 'web-agent-runtime/1',
    docker: required('WEB_AGENT_DOCKER'),
    image: required('WEB_AGENT_IMAGE'),
    directory,
    context: required('WEB_AGENT_DOCKER_CONTEXT'),
    providers: Object.fromEntries(
      ['codex', 'grok'].map((p) => [
        p,
        {
          credential: required(p === 'codex' ? 'WEB_CODEX_CREDENTIAL' : 'WEB_GROK_CREDENTIAL'),
          version: p === 'codex' ? '0.155.1' : '1.0.46',
        },
      ]),
    ),
  }),
);
const config = await loadConfig({ dataDir: f.dir, port: 0 }),
  runtime = await createServerRuntime(config);
const headers = await login(runtime, config);
let sequence = 0;
async function call(provider, action, input, key) {
  const r = await fetch(
    runtime.origin + '/api/v1/projects/' + f.id + '/agents/story/' + provider + '/' + action,
    input === undefined
      ? { headers }
      : {
          method: 'POST',
          headers: { ...headers, 'idempotency-key': key ?? 'real-' + ++sequence },
          body: JSON.stringify(input),
        },
  );
  const body = await r.json();
  assert.ok(r.ok, 'API ' + action + ' failed: ' + JSON.stringify(body));
  return body;
}
async function settle(job) {
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    const j = runtime.jobs.get(f.actor, job.id);
    if (['succeeded', 'failed', 'cancelled', 'uncertain'].includes(j.state)) return j;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('CLI acceptance deadline');
}
try {
  await seedBrief(runtime, f.actor, f.id);
  for (const provider of ['codex', 'grok']) {
    assert.equal((await call(provider, 'availability')).state, 'available');
    assert.ok((await call(provider, 'models')).models.length);
    const first = await call(
      provider,
      'chat',
      {
        text: 'Remember BATCH_P4_HTTP_84. Reply only BATCH_P4_HTTP_84 without tools.',
        conversationId: null,
      },
      provider + '-chat',
    );
    assert.equal((await settle(first.job)).state, 'succeeded');
    const history = await call(provider, 'history');
    assert.ok(
      history.messages.some((m) => m.role === 'assistant' && m.text.includes('BATCH_P4_HTTP_84')),
    );
    const duplicate = await call(
      provider,
      'chat',
      {
        text: 'Remember BATCH_P4_HTTP_84. Reply only BATCH_P4_HTTP_84 without tools.',
        conversationId: null,
      },
      provider + '-chat',
    );
    assert.equal(duplicate.job.id, first.job.id);
    const resumed = await call(provider, 'chat', {
      text: 'What marker did I ask you to remember? Reply only that marker without tools.',
      conversationId: history.activeConversationId,
    });
    assert.equal((await settle(resumed.job)).state, 'succeeded');
    const after = await call(provider, 'history');
    assert.ok(after.messages.at(-1).text.includes('BATCH_P4_HTTP_84'));
    const task = await call(provider, 'task', {
      stage: 'story-finalize',
      extra:
        'Write a concise valid story in the required output Markdown file. Use the provided adult explorer library brief. Do not read authentication files. Do not modify anything outside /workspace/output.',
    });
    const terminal = await settle(task.job);
    assert.equal(terminal.state, 'succeeded', JSON.stringify(await call(provider, 'history')));
    const record = (await call(provider, 'history')).records.find((r) => r.jobId === task.job.id);
    assert.equal(record.imported, true);
    const p = await runtime.projectApi.projects.read(f.actor, { projectId: f.id });
    assert.ok(p.drafts.story.content.length);
    assert.notEqual(p.artifacts.story?.content, p.drafts.story.content);
    const held = await call(provider, 'chat', {
      text: 'Generate 20000 numbered lines, one per line. Do not use tools.',
      conversationId: null,
    });
    await call(provider, 'jobs/' + held.job.id + '/stop', {});
    assert.equal((await settle(held.job)).state, 'cancelled');
    console.log(
      provider + ': registered Web HTTP models/chat/duplicate/resume/story task/draft/stop PASS',
    );
  }
} finally {
  await runtime.close('stop');
  await f.close();
}
