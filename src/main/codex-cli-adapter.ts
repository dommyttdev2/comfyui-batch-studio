import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process';
import readline from 'node:readline';
import type {
  AgentAvailability,
  AgentCapabilities,
  AgentEvent,
  AgentTaskRequest,
  AgentTurn,
} from '../shared/types.js';
import type { AgentCliAdapter, AgentEventSink } from './agent-cli-adapter.js';
import { CodexCliEventParser, CodexCliProtocolError } from './codex-cli-events.js';

export class CodexCliResumeMismatchError extends Error {
  constructor(
    public readonly requestedSessionId: string,
    public readonly returnedSessionId: string,
  ) {
    super(
      `Codex CLIのresume結果が要求したsessionと一致しません。requested=${requestedSessionId}, returned=${returnedSessionId}`,
    );
    this.name = 'CodexCliResumeMismatchError';
  }
}

export class AgentTurnCancelledError extends Error {
  constructor() {
    super('Codex CLI turn was cancelled.');
    this.name = 'AgentTurnCancelledError';
  }
}

type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcessWithoutNullStreams;

type KillProcessTree = (child: ChildProcessWithoutNullStreams) => Promise<void>;

type RunningTurn = {
  child: ChildProcessWithoutNullStreams;
  completion: Promise<void>;
  resolveCompletion: () => void;
  rejectCompletion: (error: Error) => void;
  sessionId: string | null;
  requestedSessionId: string | null;
  terminal: boolean;
  cancelled: boolean;
  failed: boolean;
  emittedCancelled: boolean;
  onEvent: AgentEventSink;
};

export interface CodexCliAdapterOptions {
  spawnProcess?: SpawnProcess;
  killProcessTree?: KillProcessTree;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  createTurnId?: () => string;
  startupTimeoutMs?: number;
  probeTimeoutMs?: number;
}

const MODEL_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:/+\-]{0,127}$/;
const EFFORT_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const SESSION_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const STDERR_LIMIT = 64 * 1024;

function safeModel(value: string | null | undefined) {
  if (!value) return null;
  if (!MODEL_TOKEN.test(value)) throw new Error('Codex model ID contains unsupported characters.');
  return value;
}

function safeEffort(value: string | null | undefined) {
  if (!value) return null;
  if (!EFFORT_TOKEN.test(value))
    throw new Error('Codex reasoning effort contains unsupported characters.');
  return value;
}

function safeSession(value: string) {
  if (!SESSION_TOKEN.test(value)) throw new Error('Codex session ID is invalid.');
  return value;
}

function invocation(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  args: string[],
): { command: string; args: string[] } {
  if (platform !== 'win32') return { command: 'codex', args };
  // npm installs a codex.cmd shim on Windows. Prompt text never enters this
  // command line; it is sent through stdin, and dynamic tokens are validated.
  return {
    command: env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', 'codex', ...args],
  };
}

async function defaultKillProcessTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.once('error', () => {
        try {
          child.kill();
        } catch {}
        resolve();
      });
      killer.once('close', () => resolve());
    });
    return;
  }

  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {}
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {}
  }
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export class CodexCliAdapter implements AgentCliAdapter {
  readonly provider = 'codex' as const;
  readonly capabilities: AgentCapabilities = {
    structuredEvents: true,
    sessionResume: true,
    fileWorkspace: true,
    modelSelection: true,
    reasoningEffort: true,
  };

  private readonly spawnProcess: SpawnProcess;
  private readonly killProcessTree: KillProcessTree;
  private readonly platform: NodeJS.Platform;
  private readonly env: NodeJS.ProcessEnv;
  private readonly now: () => number;
  private readonly createTurnId: () => string;
  private readonly startupTimeoutMs: number;
  private readonly probeTimeoutMs: number;
  private readonly turns = new Map<string, RunningTurn>();

  constructor(options: CodexCliAdapterOptions = {}) {
    this.spawnProcess =
      options.spawnProcess ??
      ((command, args, spawnOptions) =>
        spawn(command, args, spawnOptions) as ChildProcessWithoutNullStreams);
    this.killProcessTree = options.killProcessTree ?? defaultKillProcessTree;
    this.platform = options.platform ?? process.platform;
    this.env = options.env ?? process.env;
    this.now = options.now ?? Date.now;
    this.createTurnId = options.createTurnId ?? randomUUID;
    this.startupTimeoutMs = options.startupTimeoutMs ?? 30_000;
    this.probeTimeoutMs = options.probeTimeoutMs ?? 10_000;
  }

  async checkAvailability(): Promise<AgentAvailability> {
    const versionProbe = await this.capture(['--version']);
    if (!versionProbe.ok) {
      const missing = /not recognized|not found|enoent|cannot find/i.test(versionProbe.detail);
      return {
        provider: 'codex',
        state: missing ? 'missing' : 'error',
        version: null,
        message: versionProbe.detail || 'Codex CLIを起動できません。',
      };
    }
    const version =
      versionProbe.output.match(/(?:codex(?:-cli)?\s+)?([^\s]+)$/i)?.[1] ??
      versionProbe.output.trim() ??
      null;

    const help = await this.capture(['exec', '--help']);
    if (!help.ok || !/--json|--experimental-json/.test(help.output) || !/resume/i.test(help.output))
      return {
        provider: 'codex',
        state: 'unsupported',
        version,
        message: 'このCodex CLIは exec --json / resume をサポートしていません。',
      };

    const auth = await this.capture(['login', 'status']);
    if (!auth.ok || !/Logged in using ChatGPT/i.test(auth.output))
      return {
        provider: 'codex',
        state: 'unauthenticated',
        version,
        message:
          'ChatGPTアカウントでCodex CLIにログインしてください。APIキー等の認証では送信しません。',
      };

    return { provider: 'codex', state: 'available', version, message: null };
  }

  startTask(task: AgentTaskRequest, onEvent: AgentEventSink): Promise<AgentTurn> {
    return this.launch(task, null, onEvent);
  }

  resumeTask(
    sessionId: string,
    task: AgentTaskRequest,
    onEvent: AgentEventSink,
  ): Promise<AgentTurn> {
    return this.launch(task, safeSession(sessionId), onEvent);
  }

  async waitForCompletion(turnId: string): Promise<void> {
    const running = this.turns.get(turnId);
    if (!running) throw new Error('Codex CLI turnが見つかりません。');
    try {
      await running.completion;
    } finally {
      this.turns.delete(turnId);
    }
  }

  async stop(turnId: string): Promise<void> {
    const running = this.turns.get(turnId);
    if (!running || running.terminal) return;
    running.cancelled = true;
    await this.killProcessTree(running.child);
  }

  async shutdown(): Promise<void> {
    const liveChildren = [...this.turns.values()].filter((turn) => turn.child.exitCode === null);
    await Promise.allSettled(liveChildren.map((turn) => this.killProcessTree(turn.child)));
  }

  private buildArgs(task: AgentTaskRequest, requestedSessionId: string | null): string[] {
    const model = safeModel(task.model?.model);
    const effort = safeEffort(task.model?.reasoningEffort);
    const args = [
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--sandbox',
      task.workspace ? 'workspace-write' : 'read-only',
      '--config',
      'approval_policy="never"',
      '--config',
      'sandbox_workspace_write.network_access=false',
    ];
    if (model) args.push('--model', model);
    if (effort) args.push('--config', `model_reasoning_effort="${effort}"`);
    if (requestedSessionId) args.push('resume', requestedSessionId);
    return args;
  }

  private async launch(
    task: AgentTaskRequest,
    requestedSessionId: string | null,
    onEvent: AgentEventSink,
  ): Promise<AgentTurn> {
    const turnId = this.createTurnId();
    const parser = new CodexCliEventParser();
    const args = this.buildArgs(task, requestedSessionId);
    const command = invocation(this.platform, this.env, args);
    const cwd = task.workspace?.directory ?? task.context.root;
    const child = this.spawnProcess(command.command, command.args, {
      cwd,
      env: this.env,
      windowsHide: true,
      detached: this.platform !== 'win32',
      stdio: 'pipe',
    });
    const stderr: Buffer[] = [];
    let stderrBytes = 0;
    let resolveStart!: (turn: AgentTurn) => void;
    let rejectStart!: (error: Error) => void;
    let startSettled = false;
    let resolveCompletion!: () => void;
    let rejectCompletion!: (error: Error) => void;
    const completion = new Promise<void>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    // The adapter may complete before the runtime starts awaiting it.
    void completion.catch(() => {});
    const running: RunningTurn = {
      child,
      completion,
      resolveCompletion,
      rejectCompletion,
      sessionId: null,
      requestedSessionId,
      terminal: false,
      cancelled: false,
      failed: false,
      emittedCancelled: false,
      onEvent,
    };
    this.turns.set(turnId, running);

    const start = new Promise<AgentTurn>((resolve, reject) => {
      resolveStart = resolve;
      rejectStart = reject;
    });
    const startupTimer = setTimeout(() => {
      if (startSettled) return;
      const error = new Error('Codex CLIからsession IDを取得できずタイムアウトしました。');
      startSettled = true;
      rejectStart(error);
      running.failed = true;
      running.rejectCompletion(error);
      this.turns.delete(turnId);
      void this.killProcessTree(child);
    }, this.startupTimeoutMs);

    const fail = (error: Error, emitTurnFailed = true) => {
      const failedBeforeStart = !startSettled;
      if (failedBeforeStart) {
        startSettled = true;
        clearTimeout(startupTimer);
        rejectStart(error);
      }
      if (!running.failed && !running.cancelled) {
        running.failed = true;
        if (emitTurnFailed) onEvent({ type: 'turn.failed', at: this.now(), error: error.message });
        running.rejectCompletion(error);
      }
      if (failedBeforeStart) this.turns.delete(turnId);
    };

    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (!line.trim() || running.failed || running.cancelled) return;
      let normalized;
      try {
        normalized = parser.parseLine(line, turnId, this.now());
      } catch (error) {
        fail(error instanceof Error ? error : new CodexCliProtocolError(String(error)));
        void this.killProcessTree(child);
        return;
      }

      if (normalized.threadId) {
        if (
          requestedSessionId &&
          normalized.threadId.toLowerCase() !== requestedSessionId.toLowerCase()
        ) {
          const mismatch = new CodexCliResumeMismatchError(requestedSessionId, normalized.threadId);
          fail(mismatch);
          void this.killProcessTree(child);
          return;
        }
        running.sessionId = normalized.threadId;
        if (!startSettled) {
          startSettled = true;
          clearTimeout(startupTimer);
          resolveStart({ provider: 'codex', sessionId: normalized.threadId, turnId });
        }
      }

      for (const event of normalized.events) onEvent(event);
      if (normalized.terminal === 'failed') {
        fail(new Error(normalized.error || 'Codex CLI turn failed.'), false);
        return;
      }
      if (normalized.terminal === 'completed') running.terminal = true;
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      if (stderrBytes >= STDERR_LIMIT) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      const remaining = STDERR_LIMIT - stderrBytes;
      stderr.push(buffer.subarray(0, remaining));
      stderrBytes += Math.min(buffer.length, remaining);
    });

    child.once('error', (error) => fail(error instanceof Error ? error : new Error(String(error))));
    child.once('close', (code, signal) => {
      clearTimeout(startupTimer);
      rl.close();
      if (running.cancelled) {
        const cancelledBeforeStart = !startSettled;
        if (cancelledBeforeStart) {
          startSettled = true;
          rejectStart(new AgentTurnCancelledError());
        }
        if (!running.emittedCancelled) {
          running.emittedCancelled = true;
          onEvent({ type: 'turn.cancelled', at: this.now(), turnId });
        }
        running.rejectCompletion(new AgentTurnCancelledError());
        if (cancelledBeforeStart) this.turns.delete(turnId);
        return;
      }
      if (running.failed) return;
      const detail = Buffer.concat(stderr).toString('utf8').trim();
      if (code !== 0 || signal) {
        fail(
          new Error(
            `Codex CLIが異常終了しました（${signal ? `signal ${signal}` : `code ${code ?? 1}`}）${detail ? `: ${detail}` : ''}`,
          ),
        );
        return;
      }
      if (!running.sessionId) {
        fail(new Error('Codex CLIがsession IDを返さず終了しました。'));
        return;
      }
      if (!running.terminal) {
        fail(new Error('Codex CLIがturn.completedを返さず終了しました。'));
        return;
      }
      running.resolveCompletion();
    });

    try {
      child.stdin.end(task.prompt);
    } catch (error) {
      fail(new Error(`Codex CLIへ依頼文を送信できません: ${errorText(error)}`));
      void this.killProcessTree(child);
    }
    return start;
  }

  private capture(args: string[]): Promise<{ ok: boolean; output: string; detail: string }> {
    return new Promise((resolve) => {
      const command = invocation(this.platform, this.env, args);
      let child: ChildProcessWithoutNullStreams;
      try {
        child = this.spawnProcess(command.command, command.args, {
          env: this.env,
          windowsHide: true,
          stdio: 'pipe',
        });
      } catch (error) {
        resolve({ ok: false, output: '', detail: errorText(error) });
        return;
      }
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer | string) =>
        stdout.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))),
      );
      child.stderr.on('data', (chunk: Buffer | string) =>
        stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))),
      );
      let settled = false;
      const finish = (result: { ok: boolean; output: string; detail: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => {
        void this.killProcessTree(child);
        finish({ ok: false, output: '', detail: 'Codex CLI probe timed out.' });
      }, this.probeTimeoutMs);
      child.once('error', (error) => finish({ ok: false, output: '', detail: errorText(error) }));
      child.once('close', (code, signal) => {
        const out = Buffer.concat(stdout).toString('utf8').trim();
        const err = Buffer.concat(stderr).toString('utf8').trim();
        finish({
          ok: code === 0 && !signal,
          output: [out, err].filter(Boolean).join('\n'),
          detail: err || out,
        });
      });
      child.stdin.end();
    });
  }
}
