const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-grok-cli-adapter-'));
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

class FakeChild extends EventEmitter {
  constructor(pid) {
    super();
    this.pid = pid;
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.exitCode = null;
    this.killed = false;
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
    prompt: 'Create the Grok prompt plan.\nSecond line.',
    extra: '',
    model: { model: 'grok-4.6', reasoningEffort: 'high' },
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

async function nextTick() {
  await new Promise((resolve) => setImmediate(resolve));
}

(async () => {
  const { GrokCliAdapter, GrokTurnCancelledError } = await import(
    pathToFileURL(path.join(runtime, 'main', 'grok-cli-adapter.js')).href
  );

  {
    const children = [];
    const calls = [];
    const events = [];
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-cli-start-'));
    fs.mkdirSync(path.join(root, 'workspace'), { recursive: true });
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const adapter = new GrokCliAdapter({
      platform: 'linux',
      createTurnId: () => 'grok-turn-1',
      createSessionId: () => sessionId,
      now: () => 1234,
      spawnProcess: (command, args, options) => {
        const child = new FakeChild(100 + children.length);
        children.push(child);
        calls.push({ command, args: [...args], options });
        return child;
      },
      killProcessTree: async (child) => child.kill(),
    });

    const turn = await adapter.startTask(task(root), (event) => events.push(event));
    assert.deepEqual(turn, { provider: 'grok', sessionId, turnId: 'grok-turn-1' });
    assert.equal(calls[0].command, 'grok');
    assert.equal(calls[0].options.cwd, path.join(root, 'workspace'));
    assert.ok(calls[0].args.includes('--no-auto-update'));
    assert.ok(calls[0].args.includes('--prompt-file'));
    assert.ok(calls[0].args.includes('streaming-json'));
    assert.ok(calls[0].args.includes('--cwd'));
    assert.ok(calls[0].args.includes('strict'));
    assert.ok(calls[0].args.includes('--disable-web-search'));
    assert.ok(calls[0].args.includes('--always-approve'));
    assert.ok(calls[0].args.includes('grok-4.6'));
    assert.ok(calls[0].args.includes('high'));
    assert.equal(calls[0].args.at(-2), '--session-id');
    assert.equal(calls[0].args.at(-1), sessionId);
    assert.ok(!calls[0].args.some((value) => value.includes('Create the Grok prompt plan')));

    const promptPath = calls[0].args[calls[0].args.indexOf('--prompt-file') + 1];
    assert.equal(fs.readFileSync(promptPath, 'utf8'), 'Create the Grok prompt plan.\nSecond line.');
    assert.deepEqual(
      events.map((event) => event.type),
      ['session.started', 'turn.started'],
    );

    const child = children[0];
    const partial =
      JSON.stringify({ type: 'text', data: 'Hel' }) +
      '\n' +
      JSON.stringify({ type: 'thought', data: 'private chain of thought' }) +
      '\n';
    child.raw(partial.slice(0, 17));
    child.raw(partial.slice(17));
    child.line({
      type: 'tool_call',
      toolCallId: 'read-1',
      title: 'Read',
      kind: 'read',
      status: 'in_progress',
      toolName: 'read_file',
      rawInput: { path: 'input/1-story.md' },
    });
    child.line({
      type: 'tool_call_update',
      toolCallId: 'read-1',
      status: 'completed',
      rawOutput: { lines: 10 },
    });
    child.line({
      type: 'tool_call',
      toolCallId: 'write-1',
      title: 'Write',
      kind: 'edit',
      status: 'in_progress',
      toolName: 'write_file',
      rawInput: { path: 'output/prompt_plan.json' },
    });
    child.line({
      type: 'tool_call_update',
      toolCallId: 'write-1',
      status: 'completed',
    });
    child.line({ type: 'text', data: 'lo' });
    child.line({
      type: 'end',
      stopReason: 'end_turn',
      sessionId,
      requestId: 'request-1',
    });
    child.close(0);
    await adapter.waitForCompletion('grok-turn-1');

    assert.equal(fs.existsSync(promptPath), false, 'Prompt temp file must be deleted after the turn');
    assert.equal(
      events.some(
        (event) =>
          event.type === 'activity' &&
          typeof event.detail === 'string' &&
          event.detail.includes('private chain of thought'),
      ),
      false,
      'Raw thought content must never be projected into AgentEvent',
    );
    assert.equal(
      events.some(
        (event) => event.type === 'file.changed' && event.path === 'input/1-story.md',
      ),
      false,
      'Read-only tools must not emit file.changed',
    );
    assert.equal(
      events.some(
        (event) => event.type === 'file.changed' && event.path === 'output/prompt_plan.json',
      ),
      true,
      'File mutation tools should emit file.changed',
    );
    assert.deepEqual(
      events.filter((event) => event.type === 'message.delta').map((event) => event.text),
      ['Hel', 'lo'],
    );
    assert.equal(
      events.find((event) => event.type === 'message.completed')?.text,
      'Hello',
    );
    assert.equal(events.at(-1).type, 'turn.completed');
  }

  {
    const children = [];
    const calls = [];
    const sessionId = '22222222-2222-4222-8222-222222222222';
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-cli-resume-'));
    const adapter = new GrokCliAdapter({
      platform: 'linux',
      createTurnId: () => 'resume-turn',
      spawnProcess: (command, args, options) => {
        const child = new FakeChild(200);
        children.push(child);
        calls.push({ command, args: [...args], options });
        return child;
      },
    });
    const turn = await adapter.resumeTask(sessionId, task(root, false), () => {});
    assert.equal(turn.sessionId, sessionId);
    assert.ok(calls[0].args.includes('--resume'));
    assert.equal(calls[0].args.at(-2), '--resume');
    assert.equal(calls[0].args.at(-1), sessionId);
    assert.equal(calls[0].args.includes('--session-id'), false);
    assert.ok(calls[0].args.includes('read-only'));
    children[0].line({ type: 'end', stopReason: 'end_turn', sessionId });
    children[0].close(0);
    await adapter.waitForCompletion('resume-turn');
  }

  {
    const children = [];
    let killed = 0;
    const sessionId = '33333333-3333-4333-8333-333333333333';
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-cli-mismatch-'));
    const adapter = new GrokCliAdapter({
      platform: 'linux',
      createTurnId: () => 'mismatch-turn',
      createSessionId: () => sessionId,
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
    await adapter.startTask(task(root, false), () => {});
    children[0].line({
      type: 'end',
      stopReason: 'end_turn',
      sessionId: '44444444-4444-4444-8444-444444444444',
    });
    await assert.rejects(
      adapter.waitForCompletion('mismatch-turn'),
      /session IDが要求値と一致しません/,
    );
    assert.equal(killed, 1);
  }

  {
    const children = [];
    const sessionId = '55555555-5555-4555-8555-555555555555';
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-cli-malformed-'));
    const adapter = new GrokCliAdapter({
      platform: 'linux',
      createTurnId: () => 'malformed-turn',
      createSessionId: () => sessionId,
      spawnProcess: () => {
        const child = new FakeChild(400);
        children.push(child);
        return child;
      },
      killProcessTree: async (child) => child.close(null, 'SIGTERM'),
    });
    await adapter.startTask(task(root, false), () => {});
    children[0].raw('{bad-json}\n');
    await assert.rejects(adapter.waitForCompletion('malformed-turn'), /不正なstreaming-json/);
  }

  {
    const children = [];
    const sessionId = '66666666-6666-4666-8666-666666666666';
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-cli-exit-'));
    const adapter = new GrokCliAdapter({
      platform: 'linux',
      createTurnId: () => 'exit-turn',
      createSessionId: () => sessionId,
      spawnProcess: () => {
        const child = new FakeChild(500);
        children.push(child);
        return child;
      },
    });
    await adapter.startTask(task(root, false), () => {});
    children[0].stderr.write('Not logged in. Run grok login.');
    children[0].close(1);
    await assert.rejects(
      adapter.waitForCompletion('exit-turn'),
      /code 1.*Not logged in/,
    );
  }

  {
    const children = [];
    const events = [];
    const sessionId = '77777777-7777-4777-8777-777777777777';
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-cli-cancel-'));
    const adapter = new GrokCliAdapter({
      platform: 'linux',
      createTurnId: () => 'cancel-turn',
      createSessionId: () => sessionId,
      spawnProcess: () => {
        const child = new FakeChild(600);
        children.push(child);
        return child;
      },
      killProcessTree: async (child) => child.close(null, 'SIGTERM'),
    });
    await adapter.startTask(task(root, false), (event) => events.push(event));
    await adapter.stop('cancel-turn');
    await assert.rejects(adapter.waitForCompletion('cancel-turn'), GrokTurnCancelledError);
    assert.equal(events.filter((event) => event.type === 'turn.cancelled').length, 1);
  }

  {
    const children = [];
    let killed = 0;
    let sequence = 0;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-cli-shutdown-'));
    const adapter = new GrokCliAdapter({
      platform: 'linux',
      createTurnId: () => 'shutdown-turn-' + ++sequence,
      createSessionId: () =>
        sequence === 0
          ? '88888888-8888-4888-8888-888888888888'
          : '99999999-9999-4999-8999-999999999999',
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
    await adapter.startTask(task(root, false), () => {});
    await adapter.startTask(task(root, false), () => {});
    await adapter.shutdown();
    assert.equal(killed, 2);
    await assert.rejects(adapter.waitForCompletion('shutdown-turn-1'), GrokTurnCancelledError);
    await assert.rejects(adapter.waitForCompletion('shutdown-turn-2'), GrokTurnCancelledError);
  }

  {
    const responses = [
      { stdout: 'grok 0.2.120\n', code: 0 },
      {
        stdout:
          '--prompt-file <PATH> --output-format <FMT> [possible values: plain, json, streaming-json] --resume <ID>\n',
        code: 0,
      },
      {
        stdout:
          'You are logged in with grok.com.\n\nDefault model: grok-4.6\n\nAvailable models:\n  * grok-4.6 (default)\n  - grok-code-fast\n',
        code: 0,
      },
    ];
    const calls = [];
    const adapter = new GrokCliAdapter({
      platform: 'linux',
      spawnProcess: (command, args) => {
        calls.push({ command, args: [...args] });
        const child = new FakeChild(700 + responses.length);
        const response = responses.shift();
        queueMicrotask(() => {
          if (response.stdout) child.stdout.write(response.stdout);
          child.close(response.code);
        });
        return child;
      },
    });
    assert.deepEqual(await adapter.checkAvailability(), {
      provider: 'grok',
      state: 'available',
      version: '0.2.120',
      message: null,
    });
    assert.deepEqual(calls[2].args, ['--no-auto-update', 'models']);
  }

  {
    const responses = [
      {
        stdout:
          'You are not authenticated.\n\nDefault model: grok-4.6\n\nAvailable models:\n  * grok-4.6 (default)\n',
        code: 0,
      },
    ];
    const adapter = new GrokCliAdapter({
      platform: 'linux',
      spawnProcess: () => {
        const child = new FakeChild(750);
        const response = responses.shift();
        queueMicrotask(() => {
          child.stdout.write(response.stdout);
          child.close(response.code);
        });
        return child;
      },
    });
    await assert.rejects(adapter.getModels(), /ログインするか/);
  }

  {
    const responses = [
      {
        stdout:
          'You are using XAI_API_KEY.\n\nDefault model: grok-4.6\n\nAvailable models:\n  * grok-4.6 (default)\n  - grok-code-fast\n',
        code: 0,
      },
    ];
    const adapter = new GrokCliAdapter({
      platform: 'linux',
      spawnProcess: () => {
        const child = new FakeChild(760);
        const response = responses.shift();
        queueMicrotask(() => {
          child.stdout.write(response.stdout);
          child.close(response.code);
        });
        return child;
      },
    });
    assert.deepEqual(await adapter.getModels(), {
      models: [
        { id: 'grok-4.6', displayName: 'grok-4.6' },
        { id: 'grok-code-fast', displayName: 'grok-code-fast' },
      ],
      selection: { model: 'grok-4.6' },
    });
  }

  {
    const calls = [];
    const child = new FakeChild(800);
    const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-cli-windows-'));
    const adapter = new GrokCliAdapter({
      platform: 'win32',
      createTurnId: () => 'windows-turn',
      createSessionId: () => sessionId,
      spawnProcess: (command, args) => {
        calls.push({ command, args: [...args] });
        return child;
      },
    });
    await adapter.startTask(task(root, false), () => {});
    assert.equal(calls[0].command, 'grok');
    assert.ok(calls[0].args.includes('--prompt-file'));
    assert.ok(!calls[0].args.some((value) => value.includes('Create the Grok prompt plan')));
    child.line({ type: 'end', stopReason: 'end_turn', sessionId });
    child.close(0);
    await adapter.waitForCompletion('windows-turn');
  }

  await nextTick();
  console.log(
    'Grok CLI headless, streaming JSON, resume, cancellation, auth/model and prompt-file tests passed.',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
