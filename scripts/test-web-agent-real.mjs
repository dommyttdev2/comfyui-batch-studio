import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { DockerAgentAdapter } from '../dist-server/server/agent-cli-runtime.js';
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(name + ' must be explicitly configured.');
  return value;
};
const directory = path.resolve(required('WEB_AGENT_RUNTIME_DIR'));
await mkdir(directory, { recursive: true });
for (const provider of ['codex', 'grok']) {
  const adapter = new DockerAgentAdapter({
    provider,
    context: required('WEB_AGENT_DOCKER_CONTEXT'),
    docker: required('WEB_AGENT_DOCKER'),
    image: required('WEB_AGENT_IMAGE'),
    directory,
    credential: required(provider === 'codex' ? 'WEB_CODEX_CREDENTIAL' : 'WEB_GROK_CREDENTIAL'),
    version: provider === 'codex' ? '0.155.1' : '1.0.46',
  });
  const work = path.join(directory, provider + '-acceptance');
  await mkdir(work, { recursive: true });
  await mkdir(path.join(work, 'output'), { recursive: true });
  const base = {
    context: { root: provider + '-acceptance', stage: 'story' },
    taskStage: 'story-initial',
    extra: '',
    workspace: { workspaceId: 'acceptance', directory: work, inputDirectory: work },
  };
  const available = await adapter.checkAvailability();
  assert.equal(available.state, 'available');
  const models = await adapter.getModels();
  assert.ok(models.models.length);
  let text = '';
  const sink = (e) => {
    if (e.type === 'message.completed') text += e.text;
  };
  const first = await adapter.startTask(
    { ...base, prompt: 'Remember BATCH_P4_73. Reply with only BATCH_P4_73. Do not use tools.' },
    sink,
  );
  await adapter.waitForCompletion(first.turnId);
  assert.ok(text.includes('BATCH_P4_73'));
  text = '';
  const resumed = await adapter.resumeTask(
    first.sessionId,
    {
      ...base,
      prompt:
        'What marker did I ask you to remember? Reply with only the marker. Do not use tools.',
    },
    sink,
  );
  await adapter.waitForCompletion(resumed.turnId);
  assert.equal(resumed.sessionId, first.sessionId);
  assert.ok(text.includes('BATCH_P4_73'));
  const marker = 'HOST_ONLY_P4_SENTINEL';
  const sentinel = path.join(directory, provider + '-host-only.txt');
  await writeFile(sentinel, marker);
  // The sibling sentinel is intentionally outside both mounts.
  await rm(path.join(work, 'output/result.json'), { force: true });
  const task = await adapter.startTask(
    {
      ...base,
      taskStage: 'story-finalize',
      prompt:
        'Write /workspace/output/result.json containing exactly {"accepted":true}. Then check whether this host path is visible: ' +
        sentinel +
        '. Do not read credentials or any other files. Reply with only FILE_READY and HOST_PATH_INVISIBLE if that host path cannot be accessed.',
    },
    sink,
  );
  await adapter.waitForCompletion(task.turnId);
  assert.deepEqual(JSON.parse(await readFile(path.join(work, 'output/result.json'), 'utf8')), {
    accepted: true,
  });
  assert.ok(text.includes('HOST_PATH_INVISIBLE'));
  assert.ok(!text.includes(marker));
  const stopped = await adapter.startTask(
    { ...base, prompt: 'Generate 20000 numbered lines, one per line, without tools.' },
    sink,
  );
  await adapter.stop(stopped.turnId);
  await adapter.waitForCompletion(stopped.turnId).catch(() => {});
  await adapter.shutdown();
  console.log(provider + ': auth/models/chat/resume/file task/host mount isolation/stop PASS');
}
