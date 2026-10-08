import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { AgentCliAdapter, AgentEventSink } from '../application/agent-cli-port.js';
import type {
  AgentAvailability,
  AgentModelSettings,
  AgentProvider,
  AgentTaskRequest,
  AgentTurn,
} from '../domain/agent-runtime-types.js';
import { CodexCliEventParser } from './codex-cli-events.js';
import { GrokCliEventParser } from './grok-cli-events.js';
import { atomicJson } from './storage.js';

export interface AgentRunnerConfig {
  docker: string;
  image: string;
  directory: string;
  credential: string;
  provider: AgentProvider;
  version: string;
  jobId?: string;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const token = /^[a-zA-Z0-9][a-zA-Z0-9._:/+-]{0,127}$/;
export function containerArguments(
  config: AgentRunnerConfig,
  name: string,
  home: string,
  workspace: string,
): string[] {
  if (!/^sha256:[a-f0-9]{64}$/.test(config.image) || !path.isAbsolute(config.docker))
    throw new Error('Pinned image and absolute Docker executable required.');
  for (const value of [home, workspace])
    if (!path.isAbsolute(value) || /[,\r\n]/.test(value)) throw new Error('Invalid mount.');
  if (!/^batch-agent-[a-f0-9-]+$/.test(name)) throw new Error('Invalid container name.');
  return [
    'run',
    '-d',
    '--name',
    name,
    '--label',
    'batch-studio.agent=1',
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--user=1000:1000',
    '--pids-limit=128',
    '--memory=1g',
    '--cpus=2',
    '--tmpfs=/tmp:rw,nosuid,nodev,size=128m',
    '--mount',
    `type=bind,src=${home},dst=/home/node/.${config.provider}`,
    '--mount',
    `type=bind,src=${workspace},dst=/workspace`,
    '--workdir=/workspace',
    config.image,
  ];
}
export class DockerAgentAdapter implements AgentCliAdapter {
  readonly provider: AgentProvider;
  readonly capabilities = {
    structuredEvents: true,
    sessionResume: true,
    fileWorkspace: true,
    modelSelection: true,
    reasoningEffort: true,
  };
  private closed = false;
  private preparing = new Set<Promise<unknown>>();
  private readonly turns = new Map<string, { name: string; done: Promise<void> }>();
  constructor(private readonly config: AgentRunnerConfig) {
    this.provider = config.provider;
  }
  private async capture(
    args: string[],
    input = '',
    limit = 2 * 1024 * 1024,
    timeout = 30_000,
    includeStderr = false,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.config.docker, args, {
        windowsHide: true,
        shell: false,
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          TEMP: process.env.TEMP,
          HOME: process.env.HOME,
          USERPROFILE: process.env.USERPROFILE,
          DOCKER_HOST: process.env.DOCKER_HOST,
          DOCKER_CONTEXT: process.env.DOCKER_CONTEXT,
        },
      });
      let output = '';
      let failed = false;
      const timer = setTimeout(() => {
        failed = true;
        child.kill();
        reject(new Error('Container control timeout.'));
      }, timeout);
      child.on('error', () => {
        clearTimeout(timer);
        reject(new Error('Container control unavailable.'));
      });
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        if (Buffer.byteLength(output) > limit) {
          failed = true;
          child.kill();
          reject(new Error('CLI output limit.'));
        }
      });
      // stderr deliberately never enters public exceptions or logs.
      child.stderr.on('data', (chunk: Buffer) => {
        if (includeStderr) output += chunk.toString();
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (!failed) code === 0 ? resolve(output) : reject(new Error('Container command failed.'));
      });
      child.stdin.end(input);
    });
  }
  private async prepare(scope: string, workspace?: string) {
    if (this.closed) throw new Error('CLI adapter closed.');
    const work = this.prepareActual(scope, workspace);
    this.preparing.add(work);
    try {
      return await work;
    } finally {
      this.preparing.delete(work);
    }
  }
  private async prepareActual(
    scope: string,
    workspace?: string,
  ): Promise<{ name: string; workspace: string; home: string }> {
    const root = await realpath(this.config.directory);
    const home = path.join(root, createHash('sha256').update(scope).digest('hex'), this.provider);
    await mkdir(home, { recursive: true, mode: 0o700 });
    if ((await realpath(home)) !== home) throw new Error('Runtime home alias rejected.');
    // Only this explicitly configured credential file crosses the boundary.
    try {
      await atomicJson(
        path.join(home, 'auth.json'),
        JSON.parse(await readFile(this.config.credential, 'utf8')),
      );
    } catch {
      throw new Error('CLI credential unavailable.');
    }
    const work = workspace ? await realpath(workspace) : path.join(home, 'probe');
    if (!workspace) await mkdir(work, { recursive: true });
    const resolvedWork = await realpath(work);
    const relative = path.relative(root, resolvedWork);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
      throw new Error('Workspace outside isolated runtime directory.');
    if (this.config.jobId && !uuid.test(this.config.jobId))
      throw new Error('Invalid runtime job identity.');
    const name = 'batch-agent-' + (this.config.jobId ?? randomUUID());
    await this.capture(containerArguments(this.config, name, home, resolvedWork));
    if (this.closed) {
      await this.remove(name);
      throw new Error('CLI adapter closed.');
    }
    return { name, workspace: resolvedWork, home };
  }
  private async remove(name: string): Promise<void> {
    try {
      await this.capture(['rm', '-f', name]);
    } catch {
      if (
        (
          await this.capture([
            'ps',
            '-a',
            '--filter',
            'name=^/' + name + '$',
            '--format',
            '{{.ID}}',
          ])
        ).trim()
      )
        throw new Error('Container termination unverified.');
    }
  }
  private async probe(args: string[]): Promise<string> {
    const container = await this.prepare('probe');
    try {
      return await this.capture(
        ['exec', container.name, this.provider, ...args],
        '',
        2 * 1024 * 1024,
        30_000,
        args[0] === 'login',
      );
    } finally {
      await this.remove(container.name);
    }
  }
  async checkAvailability(): Promise<AgentAvailability> {
    try {
      const version = (await this.probe(['--version'])).trim();
      if (!version.includes(this.config.version))
        return {
          provider: this.provider,
          state: 'unsupported',
          version,
          message: 'Configured CLI version differs.',
        };
      if (
        this.provider === 'codex' &&
        !/Logged in using ChatGPT/i.test(await this.probe(['login', 'status']))
      )
        return {
          provider: this.provider,
          state: 'unauthenticated',
          version,
          message: 'CLI login required.',
        };
      await this.getModels();
      return { provider: this.provider, state: 'available', version, message: null };
    } catch {
      return {
        provider: this.provider,
        state: 'error',
        version: null,
        message: 'Configured isolated CLI unavailable.',
      };
    }
  }
  async getModels(): Promise<AgentModelSettings> {
    const output = await this.probe(
      this.provider === 'codex' ? ['debug', 'models'] : ['--no-auto-update', 'models'],
    );
    if (this.provider === 'grok') {
      const selected = output.match(/^Default model:\s*(\S+)/m)?.[1];
      const ids = [...output.matchAll(/^\s*[-*]\s+(\S+)(?:\s+\(default\))?\s*$/gm)]
        .map((m) => m[1])
        .filter((id) => token.test(id));
      if (!selected || !token.test(selected) || !ids.length)
        throw new Error('Invalid CLI model catalog.');
      return {
        models: [...new Set([selected, ...ids])].map((id) => ({ id, displayName: id })),
        selection: { model: selected },
      };
    }
    const value = JSON.parse(output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1));
    const models = (value.models as Record<string, unknown>[])
      .filter((m) => typeof m.slug === 'string' && token.test(m.slug) && m.visibility === 'list')
      .map((m) => ({
        id: String(m.slug),
        displayName: String(m.display_name || m.slug),
        supportedReasoningEfforts: Array.isArray(m.supported_reasoning_levels)
          ? m.supported_reasoning_levels
              .map((v: { effort: string }) => v.effort)
              .filter((e) => token.test(e))
          : [],
      }));
    if (!models.length) throw new Error('Empty CLI model catalog.');
    return { models, selection: { model: models[0].id } };
  }
  startTask(task: AgentTaskRequest, sink: AgentEventSink): Promise<AgentTurn> {
    return this.launch(task, null, sink);
  }
  resumeTask(session: string, task: AgentTaskRequest, sink: AgentEventSink): Promise<AgentTurn> {
    if (!uuid.test(session)) throw new Error('Invalid CLI session.');
    return this.launch(task, session, sink);
  }
  private async launch(
    task: AgentTaskRequest,
    resume: string | null,
    sink: AgentEventSink,
  ): Promise<AgentTurn> {
    if (!task.workspace || !path.isAbsolute(task.workspace.directory))
      throw new Error('Isolated workspace required.');
    const model = task.model?.model;
    const effort = task.model?.reasoningEffort;
    if ((model && !token.test(model)) || (effort && !token.test(effort)))
      throw new Error('Invalid model selection.');
    const secrets: string[] = [];
    const visit = (v: unknown): void => {
      if (typeof v === 'string' && v.length >= 16) secrets.push(v);
      else if (v && typeof v === 'object') Object.values(v).forEach(visit);
    };
    visit(JSON.parse(await readFile(this.config.credential, 'utf8')));
    let tail = '';
    const held = Math.max(0, ...secrets.map((v) => v.length));
    const emit: AgentEventSink = (event) => {
      if (event.type === 'message.delta' || event.type === 'message.completed') {
        let text = event.type === 'message.delta' ? tail + event.text : event.text;
        for (const secret of secrets) text = text.split(secret).join('[REDACTED]');
        if (event.type === 'message.delta') {
          const end = Math.max(0, text.length - held);
          tail = text.slice(end);
          text = text.slice(0, end);
        } else tail = '';
        if (text) sink({ ...event, text });
      } else if (
        event.type === 'session.started' ||
        event.type === 'turn.started' ||
        event.type === 'turn.completed' ||
        event.type === 'turn.cancelled'
      )
        sink(event);
      else if (event.type === 'turn.failed') sink({ ...event, error: 'Isolated CLI turn failed.' });
    };
    const turnId = randomUUID();
    let sessionId = resume ?? (this.provider === 'grok' ? randomUUID() : '');
    const container = await this.prepare(task.context.root, task.workspace.directory);
    await writeFile(path.join(container.workspace, 'prompt.txt'), task.prompt + '\n' + task.extra, {
      mode: 0o600,
    });
    if (this.closed) {
      await this.remove(container.name);
      throw new Error('CLI adapter closed.');
    }
    const args =
      this.provider === 'codex'
        ? [
            'exec',
            '--json',
            '--skip-git-repo-check',
            '--sandbox',
            'danger-full-access',
            '-c',
            'approval_policy="never"',
            '-c',
            'web_search="disabled"',
            ...(model ? ['--model', model] : []),
            ...(effort ? ['-c', `model_reasoning_effort="${effort}"`] : []),
            ...(resume ? ['resume', resume] : []),
            '-',
          ]
        : [
            '--no-auto-update',
            '--no-subagents',
            '--disable-web-search',
            '--prompt-file',
            '/workspace/prompt.txt',
            '--output-format',
            'streaming-json',
            '--cwd',
            '/workspace',
            '--sandbox',
            'off',
            '--disallowed-tools',
            'run_terminal_cmd',
            '--always-approve',
            ...(model ? ['--model', model] : []),
            ...(effort ? ['--reasoning-effort', effort] : []),
            ...(resume ? ['--resume', resume] : ['--session-id', sessionId]),
          ];
    let announced!: () => void;
    let rejectStart!: (error: Error) => void;
    const started = new Promise<void>((resolve, reject) => {
      announced = resolve;
      rejectStart = reject;
    });
    const codex = new CodexCliEventParser();
    const grok = new GrokCliEventParser();
    let terminal = false;
    let bytes = 0;
    const done = (async () => {
      const child = spawn(
        this.config.docker,
        ['exec', '-i', container.name, this.provider, ...args],
        {
          windowsHide: true,
          shell: false,
          env: {
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            TEMP: process.env.TEMP,
            HOME: process.env.HOME,
            USERPROFILE: process.env.USERPROFILE,
          },
        },
      );
      child.stderr.resume();
      const exited = new Promise<number | null>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', resolve);
      });
      // stdin is never interpreted by a host shell.
      child.stdin.end(this.provider === 'codex' ? task.prompt + '\n' + task.extra : '');
      const deadline = setTimeout(() => {
        void this.remove(container.name).catch(() => {});
      }, 10 * 60_000);
      let buffer = '';
      const decoder = new StringDecoder('utf8');
      void exited.catch(() => {});
      try {
        for await (const chunk of child.stdout) {
          bytes += chunk.length;
          if (bytes > 2 * 1024 * 1024) throw new Error('CLI event limit.');
          buffer += decoder.write(chunk);
          let newline: number;
          while ((newline = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (!line) continue;
            const result =
              this.provider === 'codex'
                ? codex.parseLine(line, turnId)
                : grok.parseLine(line, turnId, sessionId);
            const observed =
              'threadId' in result
                ? result.threadId
                : 'sessionId' in result
                  ? result.sessionId
                  : undefined;
            if (observed) {
              if (sessionId && sessionId !== observed) throw new Error('CLI resume mismatch.');
              sessionId = observed;
              announced();
            }
            for (const event of result.events) emit(event);
            if (result.terminal) {
              terminal = result.terminal === 'completed';
              if (!terminal) throw new Error('CLI turn failed.');
            }
          }
        }
        buffer += decoder.end();
        const code = await exited;
        if (buffer.trim() || code !== 0 || !terminal || !sessionId)
          throw new Error('Incomplete CLI turn.');
      } finally {
        clearTimeout(deadline);
        await this.remove(container.name);
      }
    })();
    this.turns.set(turnId, { name: container.name, done });
    void done.catch(() => {
      rejectStart(new Error('Isolated CLI launch failed.'));
    });
    if (this.provider === 'grok') {
      sink({ type: 'session.started', at: Date.now(), sessionId });
      announced();
    }
    const timer = setTimeout(() => rejectStart(new Error('CLI session timeout.')), 30_000);
    try {
      await started;
    } catch (error) {
      await this.remove(container.name);
      throw error;
    } finally {
      clearTimeout(timer);
    }
    sink({ type: 'turn.started', at: Date.now(), turnId });
    return { provider: this.provider, sessionId, turnId };
  }
  async waitForCompletion(turnId: string): Promise<void> {
    const turn = this.turns.get(turnId);
    if (!turn) throw new Error('Unknown CLI turn.');
    try {
      await turn.done;
    } finally {
      this.turns.delete(turnId);
    }
  }
  async stop(turnId: string): Promise<void> {
    const turn = this.turns.get(turnId);
    if (!turn) throw new Error('Unknown CLI turn.');
    await this.remove(turn.name);
    await turn.done.catch(() => {});
  }
  async shutdown(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([...this.preparing]);
    await Promise.all([...this.turns.keys()].map((id) => this.stop(id)));
  }
}
