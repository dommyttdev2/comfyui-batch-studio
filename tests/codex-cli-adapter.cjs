const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const { readMainProcessSource } = require('./main-process-source.cjs');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-codex-cli-adapter-'));
const source = (file) => fs.readFileSync(path.join(repo, file), 'utf8');
execFileSync(
  process.execPath,
  [
    path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc'),
    '-p',
    path.join(repo, 'tsconfig.electron.json'),
    '--outDir',
    runtime,
  ],
  { cwd: repo, stdio: 'inherit' },
);

const main = readMainProcessSource(repo);
assert.match(main, /BATCH_STUDIO_CODEX_TRANSPORT/);
assert.match(main, /adapter\.resumeTask\(existingThreadId/);
assert.match(main, /prepareAgentWorkspace\(app\.getPath\('userData'\), 'codex'/);
assert.match(main, /readAgentWorkspaceOutput\(pending\.workspace\)/);
assert.match(main, /rememberAgentWorkspace\(context\.root, workspace, threadId, turn\.turnId\)/);
assert.match(main, /codexCliActiveTurnIds/);
assert.match(source('src/main/codex-artifact-turn.ts'), /Batch Studio向け成果物出力契約/);

class FakeChild extends EventEmitter {
  constructor(pid) {
    super();
    this.pid = pid;
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.exitCode = null;
    this.killed = false;
    this.stdinText = '';
    this.stdin.on('data', (chunk) => {
      this.stdinText += chunk.toString('utf8');
    });
  }

  line(value) {
    this.stdout.write(JSON.stringify(value) + '\n');
  }

  raw(value) {
    this.stdout.write(value);
  }

  close(code = 0, signal = null) {
    this.exitCode = code;
    this.stdout.end();
    this.stderr.end();
    queueMicrotask(() => this.emit('close', code, signal));
  }

  kill() {
    this.killed = true;
    this.close(null, 'SIGTERM');
    return true;
  }
}

function task(root, workspace = true) {
  return {
    context: { root, stage: 'prompt-plan' },
    taskStage: 'prompt-plan',
    prompt: 'Create the prompt plan.',
    extra: '',
    model: { model: 'gpt-5.6-codex', reasoningEffort: 'high' },
    ...(workspace
      ? {
          workspace: {
            workspaceId: '11111111-1111-1111-1111-111111111111',
            directory: path.join(root, 'workspace'),
            inputDirectory: path.join(root, 'workspace', 'input'),
            outputDirectory: path.join(root, 'workspace', 'output'),
            outputPath: path.join(root, 'workspace', 'output', 'prompt_plan.json'),
            fileName: 'prompt_plan.json',
          },
        }
      : {}),
  };
}

(async () => {
  const { CodexCliAdapter, CodexCliResumeMismatchError, AgentTurnCancelledError } = await import(
    pathToFileURL(path.join(runtime, 'main', 'codex-cli-adapter.js')).href
  );

  {
    const children = [];
    const calls = [];
    let nextPid = 100;
    const adapter = new CodexCliAdapter({
      platform: 'linux',
      createTurnId: () => 'local-turn-1',
      now: () => 1234,
      spawnProcess: (command, args, options) => {
        const child = new FakeChild(nextPid++);
        children.push(child);
        calls.push({ command, args: [...args], options });
        return child;
      },
      killProcessTree: async (child) => child.kill(),
    });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-cli-start-'));
    fs.mkdirSync(path.join(root, 'workspace'), { recursive: true });
    const events = [];
    const started = adapter.startTask(task(root), (event) => events.push(event));
    const child = children[0];
    assert.equal(calls[0].command, 'codex');
    assert.equal(calls[0].options.cwd, path.join(root, 'workspace'));
    assert.deepEqual(calls[0].args.slice(0, 7), [
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--sandbox',
      'workspace-write',
      '--config',
      'approval_policy="never"',
    ]);
    assert.ok(calls[0].args.includes('sandbox_workspace_write.network_access=false'));
    assert.ok(calls[0].args.includes('web_search="disabled"'));
    assert.ok(calls[0].args.includes('gpt-5.6-codex'));
    assert.ok(calls[0].args.includes('model_reasoning_effort="high"'));
    assert.ok(!calls[0].args.some((value) => value.includes('Create the prompt plan')));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(child.stdinText, 'Create the prompt plan.');

    const thread = JSON.stringify({ type: 'thread.started', thread_id: 'session-1' }) + '\n';
    child.raw(thread.slice(0, 20));
    child.raw(
      thread.slice(20) +
        JSON.stringify({ type: 'turn.started' }) +
        '\n' +
        JSON.stringify({
          type: 'item.updated',
          item: { id: 'msg-1', type: 'agent_message', text: 'Hel' },
        }) +
        '\n',
    );
    const turn = await started;
    assert.deepEqual(turn, {
      provider: 'codex',
      sessionId: 'session-1',
      turnId: 'local-turn-1',
    });

    child.line({
      type: 'item.completed',
      item: { id: 'msg-1', type: 'agent_message', text: 'Hello' },
    });
    child.line({
      type: 'item.completed',
      item: {
        id: 'file-1',
        type: 'file_change',
        changes: [{ path: 'output/prompt_plan.json', kind: 'add' }],
        status: 'completed',
      },
    });
    child.line({ type: 'turn.completed', usage: {} });
    child.close(0);
    await adapter.waitForCompletion('local-turn-1');
    assert.deepEqual(
      events.map((event) => event.type),
      [
        'session.started',
        'turn.started',
        'message.delta',
        'message.delta',
        'message.completed',
        'file.changed',
        'turn.completed',
      ],
    );
    assert.equal(events[2].text, 'Hel');
    assert.equal(events[3].text, 'lo');
    assert.equal(events[5].path, 'output/prompt_plan.json');
  }

  {
    const children = [];
    const calls = [];
    const adapter = new CodexCliAdapter({
      platform: 'linux',
      createTurnId: () => 'resume-turn',
      spawnProcess: (command, args, options) => {
        const child = new FakeChild(200);
        children.push(child);
        calls.push({ command, args: [...args], options });
        return child;
      },
      killProcessTree: async (child) => child.kill(),
    });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-cli-resume-'));
    const start = adapter.resumeTask('session-1', task(root, false), () => {});
    assert.ok(calls[0].args.includes('resume'));
    assert.equal(calls[0].args.at(-1), 'session-1');
    children[0].line({ type: 'thread.started', thread_id: 'session-1' });
    assert.equal((await start).sessionId, 'session-1');
    children[0].line({ type: 'turn.started' });
    children[0].line({ type: 'turn.completed', usage: {} });
    children[0].close(0);
    await adapter.waitForCompletion('resume-turn');
  }

  {
    const children = [];
    let killed = 0;
    const adapter = new CodexCliAdapter({
      platform: 'linux',
      createTurnId: () => 'mismatch-turn',
      spawnProcess: () => {
        const child = new FakeChild(300);
        children.push(child);
        return child;
      },
      killProcessTree: async (child) => {
        killed++;
        child.close(null, 'SIGTERM');
      },
    });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-cli-mismatch-'));
    const events = [];
    const start = adapter.resumeTask('session-old', task(root, false), (event) =>
      events.push(event),
    );
    children[0].line({ type: 'thread.started', thread_id: 'session-new' });
    await assert.rejects(start, CodexCliResumeMismatchError);
    assert.equal(killed, 1);
    assert.equal(
      events.some((event) => event.type === 'session.started'),
      false,
    );
  }

  {
    const children = [];
    const events = [];
    const adapter = new CodexCliAdapter({
      platform: 'linux',
      createTurnId: () => 'failed-turn',
      spawnProcess: () => {
        const child = new FakeChild(350);
        children.push(child);
        return child;
      },
      killProcessTree: async (child) => child.close(null, 'SIGTERM'),
    });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-cli-failed-'));
    const start = adapter.startTask(task(root, false), (event) => events.push(event));
    children[0].line({ type: 'thread.started', thread_id: 'session-failed' });
    await start;
    children[0].line({ type: 'turn.started' });
    children[0].line({ type: 'turn.failed', error: { message: 'model failed' } });
    children[0].close(1);
    await assert.rejects(adapter.waitForCompletion('failed-turn'), /model failed/);
    assert.equal(
      events.filter((event) => event.type === 'turn.failed').length,
      1,
      'Raw turn.failed must be projected exactly once',
    );
  }

  {
    const children = [];
    const adapter = new CodexCliAdapter({
      platform: 'linux',
      createTurnId: () => 'malformed-turn',
      spawnProcess: () => {
        const child = new FakeChild(400);
        children.push(child);
        return child;
      },
      killProcessTree: async (child) => child.close(null, 'SIGTERM'),
    });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-cli-malformed-'));
    const start = adapter.startTask(task(root, false), () => {});
    children[0].line({ type: 'thread.started', thread_id: 'session-malformed' });
    await start;
    children[0].raw('{not-json}\n');
    await assert.rejects(adapter.waitForCompletion('malformed-turn'), /不正なJSONL/);
  }

  {
    const children = [];
    const adapter = new CodexCliAdapter({
      platform: 'linux',
      createTurnId: () => 'prestart-failure-turn',
      spawnProcess: () => {
        const child = new FakeChild(450);
        children.push(child);
        return child;
      },
    });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-cli-prestart-failure-'));
    const start = adapter.startTask(task(root, false), () => {});
    children[0].stderr.write('startup failed');
    children[0].close(1);
    await assert.rejects(start, /startup failed/);
    await assert.rejects(
      adapter.waitForCompletion('prestart-failure-turn'),
      /turnが見つかりません/,
      'A turn that never exposed a session ID must not remain in the adapter map',
    );
  }

  {
    const children = [];
    const adapter = new CodexCliAdapter({
      platform: 'linux',
      createTurnId: () => 'exit-turn',
      spawnProcess: () => {
        const child = new FakeChild(500);
        children.push(child);
        return child;
      },
    });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-cli-exit-'));
    const start = adapter.startTask(task(root, false), () => {});
    children[0].stderr.write('authentication required');
    children[0].close(1);
    await assert.rejects(start, /code 1.*authentication required/);
  }

  {
    const children = [];
    const events = [];
    const adapter = new CodexCliAdapter({
      platform: 'linux',
      createTurnId: () => 'cancel-turn',
      spawnProcess: () => {
        const child = new FakeChild(600);
        children.push(child);
        return child;
      },
      killProcessTree: async (child) => child.close(null, 'SIGTERM'),
    });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-cli-cancel-'));
    const start = adapter.startTask(task(root, false), (event) => events.push(event));
    children[0].line({ type: 'thread.started', thread_id: 'session-cancel' });
    await start;
    children[0].line({ type: 'turn.started' });
    await adapter.stop('cancel-turn');
    await assert.rejects(adapter.waitForCompletion('cancel-turn'), AgentTurnCancelledError);
    assert.equal(events.filter((event) => event.type === 'turn.cancelled').length, 1);
  }

  {
    const queued = [
      { stdout: 'codex-cli 1.2.3\n', code: 0 },
      { stdout: 'Usage: codex exec --json ... resume\n', code: 0 },
      { stdout: 'Logged in using ChatGPT\n', code: 0 },
    ];
    const adapter = new CodexCliAdapter({
      platform: 'linux',
      spawnProcess: () => {
        const child = new FakeChild(700 + queued.length);
        const response = queued.shift();
        queueMicrotask(() => {
          if (response.stdout) child.stdout.write(response.stdout);
          child.close(response.code);
        });
        return child;
      },
    });
    assert.deepEqual(await adapter.checkAvailability(), {
      provider: 'codex',
      state: 'available',
      version: '1.2.3',
      message: null,
    });
  }

  {
    const children = [];
    let killed = 0;
    let turnSequence = 0;
    const adapter = new CodexCliAdapter({
      platform: 'linux',
      createTurnId: () => 'shutdown-turn-' + ++turnSequence,
      spawnProcess: () => {
        const child = new FakeChild(650 + children.length);
        children.push(child);
        return child;
      },
      killProcessTree: async (child) => {
        killed++;
        child.close(null, 'SIGTERM');
      },
    });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-cli-shutdown-'));
    const first = adapter.startTask(task(root, false), () => {});
    children[0].line({ type: 'thread.started', thread_id: 'shutdown-session-1' });
    await first;
    const second = adapter.startTask(task(root, false), () => {});
    children[1].line({ type: 'thread.started', thread_id: 'shutdown-session-2' });
    await second;
    await adapter.shutdown();
    assert.equal(killed, 2, 'shutdown must terminate every active CLI child');
    await assert.rejects(adapter.waitForCompletion('shutdown-turn-1'), AgentTurnCancelledError);
    await assert.rejects(adapter.waitForCompletion('shutdown-turn-2'), AgentTurnCancelledError);
  }

  {
    const queued = [
      { stdout: 'codex-cli 1.2.3\\n', code: 0 },
      { stdout: 'Usage: codex exec --json ... resume\\n', code: 0 },
      { stdout: 'Logged in using an API key - sk-***1234\\n', code: 0 },
    ];
    const adapter = new CodexCliAdapter({
      platform: 'linux',
      spawnProcess: () => {
        const child = new FakeChild(750 + queued.length);
        const response = queued.shift();
        queueMicrotask(() => {
          if (response.stdout) child.stdout.write(response.stdout);
          child.close(response.code);
        });
        return child;
      },
    });
    const availability = await adapter.checkAvailability();
    assert.equal(availability.state, 'unauthenticated');
    assert.match(availability.message, /ChatGPTアカウント/);
    assert.doesNotMatch(availability.message, /sk-/);
  }


  console.log(
    'Codex CLI JSONL, resume guard, cancellation, probes and argument safety tests passed.',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
