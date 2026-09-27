import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import type {
  AgentAvailability,
  AgentCapabilities,
  AgentModelOption,
  AgentModelSettings,
  AgentTaskRequest,
  AgentTurn,
} from '../shared/types.js';
import type { AgentCliAdapter, AgentEventSink } from './agent-cli-adapter.js';
import { GrokCliEventParser, GrokCliProtocolError } from './grok-cli-events.js';

export class GrokTurnCancelledError extends Error {
  constructor() {
    super('Grok CLI turn was cancelled.');
    this.name = 'GrokTurnCancelledError';
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
  tempDirectory: string;
  terminal: boolean;
  cancelled: boolean;
  failed: boolean;
  emittedCancelled: boolean;
};

export interface GrokCliAdapterOptions {
  spawnProcess?: SpawnProcess;
  killProcessTree?: KillProcessTree;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  createTurnId?: () => string;
  createSessionId?: () => string;
  tempRoot?: string;
  probeTimeoutMs?: number;
}

const MODEL_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:/+\-]{0,127}$/;
const EFFORT_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const UUID_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STDERR_LIMIT = 64 * 1024;

function safeModel(value: string | null | undefined) {
  if (!value) return null;
  if (!MODEL_TOKEN.test(value)) throw new Error('Grok model ID contains unsupported characters.');
  return value;
}

function safeEffort(value: string | null | undefined) {
  if (!value) return null;
  if (!EFFORT_TOKEN.test(value)) throw new Error('Grok reasoning effort contains unsupported characters.');
  return value;
}

function safeSession(value: string) {
  if (!UUID_TOKEN.test(value)) throw new Error('Grok session ID is not a valid UUID.');
  return value.toLowerCase();
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

function parseModels(output: string): AgentModelSettings {
  const defaultModel = output.match(/^Default model:\s*(\S+)/m)?.[1] ?? null;
  const models: AgentModelOption[] = [];
  for (const match of output.matchAll(/^\s*[-*]\s+(\S+)(?:\s+\(default\))?\s*$/gm)) {
    const id = match[1];
    if (!models.some((model) => model.id === id)) models.push({ id, displayName: id });
  }
  if (defaultModel && !models.some((model) => model.id === defaultModel))
    models.unshift({ id: defaultModel, displayName: defaultModel });
  return { models, selection: { model: defaultModel } };
}

export class GrokCliAdapter implements AgentCliAdapter {
  readonly provider = 'grok' as const;
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
  private readonly createSessionId: () => string;
  private readonly tempRoot: string;
  private readonly probeTimeoutMs: number;
  private readonly turns = new Map<string, RunningTurn>();

  constructor(options: GrokCliAdapterOptions = {}) {
    this.spawnProcess =
      options.spawnProcess ??
      ((command, args, spawnOptions) =>
        spawn(command, args, spawnOptions) as ChildProcessWithoutNullStreams);
    this.killProcessTree = options.killProcessTree ?? defaultKillProcessTree;
    this.platform = options.platform ?? process.platform;
    this.env = options.env ?? process.env;
    this.now = options.now ?? Date.now;
    this.createTurnId = options.createTurnId ?? randomUUID;
    this.createSessionId = options.createSessionId ?? randomUUID;
    this.tempRoot = options.tempRoot ?? os.tmpdir();
    this.probeTimeoutMs = options.probeTimeoutMs ?? 10_000;
  }

  async checkAvailability(): Promise<AgentAvailability> {
    const versionProbe = await this.capture(['version']);
    if (!versionProbe.ok) {
      const missing = /not recognized|not found|enoent|cannot find/i.test(versionProbe.detail);
      return {
        provider: 'grok',
        state: missing ? 'missing' : 'error',
        version: null,
        message: versionProbe.detail || 'Grok CLIを起動できません。',
      };
    }
    const version = versionProbe.output.trim().split(/\s+/).at(-1) ?? null;

    const help = await this.capture(['--help']);
    if (
      !help.ok ||
      !/--prompt-file/.test(help.output) ||
      !/streaming-json/.test(help.output) ||
      !/--resume/.test(help.output)
    )
      return {
        provider: 'grok',
        state: 'unsupported',
        version,
        message: 'このGrok CLIは必要なheadless / streaming-json機能をサポートしていません。',
      };

    const models = await this.capture(['--no-auto-update', 'models']);
    if (/You are not authenticated\./i.test(models.output))
      return {
        provider: 'grok',
        state: 'unauthenticated',
        version,
        message: 'Grok CLIでログインするか、XAI_API_KEYを設定してください。',
      };
    if (!models.ok)
      return {
        provider: 'grok',
        state: 'error',
        version,
        message: 'Grok CLIの認証・モデル状態を確認できません。',
      };
    return { provider: 'grok', state: 'available', version, message: null };
  }

  async getModels(): Promise<AgentModelSettings> {
    const result = await this.capture(['--no-auto-update', 'models']);
    if (!result.ok) throw new Error('Grok CLIからモデル一覧を取得できません。');
    if (/You are not authenticated\./i.test(result.output))
      throw new Error('Grok CLIでログインするか、XAI_API_KEYを設定してください。');
    return parseModels(result.output);
  }

  startTask(task: AgentTaskRequest, onEvent: AgentEventSink): Promise<AgentTurn> {
    return this.launch(task, null, safeSession(this.createSessionId()), onEvent);
  }

  resumeTask(
    sessionId: string,
    task: AgentTaskRequest,
    onEvent: AgentEventSink,
  ): Promise<AgentTurn> {
    const safe = safeSession(sessionId);
    return this.launch(task, safe, safe, onEvent);
  }

  async waitForCompletion(turnId: string): Promise<void> {
    const running = this.turns.get(turnId);
    if (!running) throw new Error('Grok CLI turnが見つかりません。');
    try {
      await running.completion;
    } finally {
      this.turns.delete(turnId);
      await rm(running.tempDirectory, { recursive: true, force: true }).catch(() => {});
    }
  }

  async stop(turnId: string): Promise<void> {
    const running = this.turns.get(turnId);
    if (!running || running.terminal) return;
    running.cancelled = true;
    await this.killProcessTree(running.child);
  }

  async shutdown(): Promise<void> {
    const activeTurnIds = [...this.turns.entries()]
      .filter(([, turn]) => !turn.terminal && turn.child.exitCode === null)
      .map(([turnId]) => turnId);
    await Promise.allSettled(activeTurnIds.map((turnId) => this.stop(turnId)));
  }

  private async launch(
    task: AgentTaskRequest,
    resumeSessionId: string | null,
    expectedSessionId: string,
    onEvent: AgentEventSink,
  ): Promise<AgentTurn> {
    const turnId = this.createTurnId();
    const parser = new GrokCliEventParser();
    const model = safeModel(task.model?.model);
    const effort = safeEffort(task.model?.reasoningEffort);
    const tempDirectory = await mkdtemp(path.join(this.tempRoot, 'batch-studio-grok-'));
    const promptFile = path.join(tempDirectory, 'prompt.txt');
    await writeFile(promptFile, task.prompt, { encoding: 'utf8', mode: 0o600 });

    const args = [
      '--no-auto-update',
      '--prompt-file',
      promptFile,
      '--output-format',
      'streaming-json',
      '--cwd',
      task.workspace?.directory ?? task.context.root,
      '--sandbox',
      task.workspace ? 'strict' : 'read-only',
      '--disable-web-search',
      '--always-approve',
    ];
    if (model) args.push('--model', model);
    if (effort) args.push('--effort', effort);
    if (resumeSessionId) args.push('--resume', resumeSessionId);
    else args.push('--session-id', expectedSessionId);

    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.spawnProcess('grok', args, {
        cwd: task.workspace?.directory ?? task.context.root,
        env: this.env,
        windowsHide: true,
        detached: this.platform !== 'win32',
        stdio: 'pipe',
      });
    } catch (error) {
      await rm(tempDirectory, { recursive: true, force: true }).catch(() => {});
      throw error;
    }

    const stderr: Buffer[] = [];
    let stderrBytes = 0;
    let resolveCompletion!: () => void;
    let rejectCompletion!: (error: Error) => void;
    const completion = new Promise<void>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    void completion.catch(() => {});

    const running: RunningTurn = {
      child,
      completion,
      resolveCompletion,
      rejectCompletion,
      tempDirectory,
      terminal: false,
      cancelled: false,
      failed: false,
      emittedCancelled: false,
    };
    this.turns.set(turnId, running);

    onEvent({ type: 'session.started', at: this.now(), sessionId: expectedSessionId });
    onEvent({ type: 'turn.started', at: this.now(), turnId });

    const fail = (error: Error, emit = true) => {
      if (running.failed || running.cancelled) return;
      running.failed = true;
      if (emit) onEvent({ type: 'turn.failed', at: this.now(), error: error.message });
      running.rejectCompletion(error);
    };

    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (!line.trim() || running.failed || running.cancelled) return;
      let normalized;
      try {
        normalized = parser.parseLine(line, turnId, expectedSessionId, this.now());
      } catch (error) {
        fail(error instanceof Error ? error : new GrokCliProtocolError(String(error)));
        void this.killProcessTree(child);
        return;
      }
      for (const event of normalized.events) onEvent(event);
      if (normalized.terminal === 'completed') running.terminal = true;
      if (normalized.terminal === 'cancelled') {
        running.cancelled = true;
        running.terminal = true;
      }
      if (normalized.terminal === 'failed') {
        running.terminal = true;
        fail(new Error(normalized.error || 'Grok CLI turn failed.'), false);
        void this.killProcessTree(child);
      }
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
      rl.close();
      if (running.cancelled && !running.terminal) {
        running.terminal = true;
        if (!running.emittedCancelled) {
          running.emittedCancelled = true;
          onEvent({ type: 'turn.cancelled', at: this.now(), turnId });
        }
        running.rejectCompletion(new GrokTurnCancelledError());
        return;
      }
      if (running.cancelled && running.terminal) {
        running.resolveCompletion();
        return;
      }
      if (running.failed) return;
      const detail = Buffer.concat(stderr).toString('utf8').trim();
      if (code !== 0 || signal) {
        fail(
          new Error(
            `Grok CLIが異常終了しました（${signal ? `signal ${signal}` : `code ${code ?? 1}`}）${detail ? `: ${detail}` : ''}`,
          ),
        );
        return;
      }
      if (!running.terminal) {
        fail(new Error('Grok CLIがendイベントを返さず終了しました。'));
        return;
      }
      running.resolveCompletion();
    });
    child.stdin.end();

    return { provider: 'grok', sessionId: expectedSessionId, turnId };
  }

  private capture(args: string[]): Promise<{ ok: boolean; output: string; detail: string }> {
    return new Promise((resolve) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = this.spawnProcess('grok', args, {
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
        finish({ ok: false, output: '', detail: 'Grok CLI probe timed out.' });
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
