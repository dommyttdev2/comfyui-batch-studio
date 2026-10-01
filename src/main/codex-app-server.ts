import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};
export interface CodexNotification {
  method: string;
  params: Record<string, unknown>;
}

export class CodexAppServer extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private startPromise: Promise<void> | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private buffer = '';

  async start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startProcess();
    try {
      await this.startPromise;
    } catch (error) {
      this.startPromise = null;
      throw error;
    }
  }

  private async startProcess(): Promise<void> {
    // On Windows npm installs codex.cmd, which requires cmd.exe rather than direct spawn.
    const isWindows = process.platform === 'win32';
    const program = isWindows ? process.env.ComSpec || 'cmd.exe' : 'codex';
    const args = isWindows ? ['/d', '/s', '/c', 'codex app-server'] : ['app-server'];
    const child = spawn(program, args, { stdio: 'pipe', windowsHide: true, env: process.env });
    this.child = child;
    this.buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.receive(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      // Do not log stderr: diagnostics may contain project paths or user content.
      this.emit('diagnostic', chunk.slice(0, 2000));
    });
    child.on('error', (error) => this.disconnect(error));
    child.on('exit', (code) =>
      this.disconnect(new Error('Codex App Server exited (code ' + String(code) + ').')),
    );
    try {
      await this.requestRaw('initialize', {
        clientInfo: {
          name: 'comfyui_batch_studio',
          title: 'ComfyUI Batch Studio',
          version: '1.0.0',
        },
        capabilities: { experimentalApi: true },
      });
      this.write({ method: 'initialized', params: {} });
    } catch (error) {
      child.kill();
      throw error;
    }
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > 16 * 1024 * 1024) {
      this.disconnect(new Error('Codex App Server message exceeds size limit.'));
      return;
    }
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) {
        try {
          const message = JSON.parse(line) as {
            id?: number | string;
            method?: string;
            result?: unknown;
            error?: { message?: string };
            params?: Record<string, unknown>;
          };
          if (message.id !== undefined && !message.method) {
            const pending = this.pending.get(Number(message.id));
            if (pending) {
              clearTimeout(pending.timeout);
              this.pending.delete(Number(message.id));
              if (message.error) pending.reject(new Error(message.error.message || 'Codex error'));
              else pending.resolve(message.result);
            }
          } else if (message.method && message.id !== undefined) {
            // The planning assistant is read-only; never authorize tools or filesystem changes.
            this.write({
              id: message.id,
              error: { code: -32000, message: 'Batch Studio does not authorize this operation.' },
            });
          } else if (message.method) {
            this.emit('notification', {
              method: message.method,
              params: message.params ?? {},
            } satisfies CodexNotification);
          }
        } catch {
          this.emit('diagnostic', 'Malformed Codex App Server response');
        }
      }
      newline = this.buffer.indexOf('\n');
    }
  }

  private write(message: object): void {
    if (!this.child?.stdin.writable) throw new Error('Codex App Server is not running.');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }

  private requestRaw(method: string, params: object = {}): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Codex App Server request timed out: ' + method));
      }, 60_000);
      this.pending.set(id, { resolve, reject, timeout });
      try {
        this.write({ method, id, params });
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async request<T>(method: string, params: object = {}): Promise<T> {
    await this.start();
    return (await this.requestRaw(method, params)) as T;
  }

  private disconnect(reason: Error): void {
    if (!this.child) return;
    this.child.kill();
    this.child = null;
    this.startPromise = null;
    this.buffer = '';
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(reason);
    }
    this.pending.clear();
    this.emit('disconnected', reason.message);
  }

  stop(): void {
    if (this.child) this.disconnect(new Error('Codex App Server stopped.'));
  }
}
