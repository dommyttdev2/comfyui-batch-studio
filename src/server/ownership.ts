import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  realpath,
  rename,
  rmdir,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import path from 'node:path';
import { ExecutionResourceLockManager } from '../application/execution-coordinator.js';
import { type ActorContext, authorize, BusinessError } from '../domain/contracts.js';
import { identifier } from './http.js';
import { atomicJson, SerialQueue } from './storage.js';

export interface Owner {
  schema: 'web-owner/1';
  serverId: string;
  pid: number;
  host: string;
  subject: string;
}
export function normalizeEndpoint(input: string): string {
  const url = new URL(input);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new BusinessError('INVALID_INPUT', 'Invalid endpoint.');
  url.hostname = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase())
    ? '127.0.0.1'
    : url.hostname.toLowerCase();
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString();
}
export class FileLease {
  private constructor(
    readonly directory: string,
    readonly owner: Owner,
  ) {}
  static async acquire(directory: string, subject: string, serverId: string): Promise<FileLease> {
    await mkdir(path.dirname(directory), { recursive: true, mode: 0o700 });
    try {
      await stat(directory + '.recover');
      throw new BusinessError('RUNTIME_BUSY', 'Recovery in progress.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      throw new BusinessError(
        'RUNTIME_BUSY',
        'Ownership is held; explicit reconciliation is required.',
      );
    }
    const owner: Owner = {
      schema: 'web-owner/1',
      serverId,
      pid: process.pid,
      host: hostname(),
      subject,
    };
    await writeFile(path.join(directory, 'owner.json'), JSON.stringify(owner), {
      flag: 'wx',
      mode: 0o600,
    });
    return new FileLease(directory, owner);
  }
  async release(): Promise<void> {
    const owner = JSON.parse(await readFile(path.join(this.directory, 'owner.json'), 'utf8'));
    if (
      owner.schema !== 'web-owner/1' ||
      owner.serverId !== this.owner.serverId ||
      owner.subject !== this.owner.subject
    )
      throw new BusinessError('RUNTIME_UNCERTAIN', 'Ownership changed.');
    await unlink(path.join(this.directory, 'owner.json'));
    await rmdir(this.directory);
  }
  static async releaseVerified(
    directory: string,
    subject: string,
    verify: (owner: Owner) => Promise<boolean>,
  ): Promise<void> {
    const owner = JSON.parse(await readFile(path.join(directory, 'owner.json'), 'utf8')) as Owner;
    if (
      owner.schema !== 'web-owner/1' ||
      owner.subject !== subject ||
      owner.host !== hostname() ||
      typeof owner.serverId !== 'string' ||
      !Number.isSafeInteger(owner.pid) ||
      owner.pid < 1 ||
      !(await verify(owner))
    )
      throw new BusinessError('RUNTIME_UNCERTAIN', 'Resource outcome is not verified.');
    // Only a trusted runtime reconciliation adapter can provide this proof.
    await new FileLease(directory, owner).release();
  }
  // Explicit administrative reconciliation of the server lock only. Resource locks remain.
  static async reconcileDeadServer(directory: string): Promise<void> {
    const mutex = directory + '.recover';
    try {
      await mkdir(mutex, { mode: 0o700 });
    } catch {
      throw new BusinessError('RUNTIME_BUSY', 'Recovery already in progress.');
    }
    let preserve = false;
    try {
      const owner = JSON.parse(await readFile(path.join(directory, 'owner.json'), 'utf8')) as Owner;
      if (
        owner.schema !== 'web-owner/1' ||
        owner.subject !== 'server' ||
        owner.host !== hostname() ||
        !Number.isSafeInteger(owner.pid) ||
        owner.pid < 1
      )
        throw new BusinessError('RUNTIME_UNCERTAIN', 'Unknown owner.');
      try {
        process.kill(owner.pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH')
          throw new BusinessError('RUNTIME_UNCERTAIN', 'Owner cannot be verified.');
        const claim = directory + '.reconcile-' + randomUUID();
        await rename(directory, claim);
        const check = JSON.parse(await readFile(path.join(claim, 'owner.json'), 'utf8')) as Owner;
        if (JSON.stringify(check) !== JSON.stringify(owner)) {
          preserve = true;
          throw new BusinessError('RUNTIME_UNCERTAIN', 'Owner changed during reconciliation.');
        }
        await unlink(path.join(claim, 'owner.json'));
        await rmdir(claim);
        return;
      }
      throw new BusinessError('RUNTIME_BUSY', 'Owner is still alive.');
    } finally {
      if (!preserve) await rmdir(mutex);
    }
  }
}
export class Ownership {
  readonly serverId = randomUUID();
  readonly coreLocks = new ExecutionResourceLockManager(normalizeEndpoint);
  // Every server under this OS account uses the same namespace, regardless of dataDir.
  readonly sharedDir = path.join(homedir(), '.batch-studio', 'ownership-v1');
  async acquire(key: string, subject: string): Promise<FileLease> {
    return FileLease.acquire(
      path.join(this.sharedDir, createHash('sha256').update(key).digest('hex')),
      subject,
      this.serverId,
    );
  }
  async project(root: string, subject: string): Promise<FileLease> {
    return FileLease.acquire(
      path.join(await realpath(root), '.batch-studio-owner-v1'),
      subject,
      this.serverId,
    );
  }
  async execution(
    projectRoot: string,
    jobId: string,
    target: { endpoint: string } | { provider: string; instanceId: number },
  ): Promise<{ release(): Promise<void> }> {
    const ref = { projectRoot, runId: jobId };
    const local = 'endpoint' in target;
    const key = local
      ? 'local:' + normalizeEndpoint(target.endpoint)
      : `remote:${target.provider.toLowerCase()}:${target.instanceId}`;
    const lease = await this.acquire(key, jobId);
    try {
      if (local) this.coreLocks.acquireLocal(target.endpoint, ref);
      else this.coreLocks.acquireRemote(target.provider, target.instanceId, ref);
    } catch (error) {
      await lease.release();
      throw error;
    }
    return {
      release: async () => {
        await lease.release();
        this.coreLocks.release(ref);
      },
    };
  }
}
export class ProjectRegistry {
  private readonly queue = new SerialQueue();
  private readonly file: string;
  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'projects.json');
  }
  private async records(): Promise<{ id: string; root: string; key: string }[]> {
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8'));
      if (
        value.schema !== 'web-project-registry/1' ||
        !Array.isArray(value.projects) ||
        !value.projects.every(
          (p: { id: string; root: string; key: string }) =>
            p && typeof p.id === 'string' && path.isAbsolute(p.root) && typeof p.key === 'string',
        )
      )
        throw new BusinessError('INVALID_INPUT', 'Current registry schema required.');
      return value.projects;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
  async register(actor: ActorContext, id: string, root: string): Promise<string> {
    authorize(actor, identifier(id), 'admin');
    if (!path.isAbsolute(root))
      throw new BusinessError('INVALID_INPUT', 'Absolute project root required.');
    const canonical = await realpath(root);
    if (!(await stat(canonical)).isDirectory())
      throw new BusinessError('INVALID_INPUT', 'Project directory required.');
    const key = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
    return this.queue.run(async () => {
      const records = await this.records();
      const alias = records.find((p) => p.key === key);
      if (alias) return alias.id;
      if (records.some((p) => p.id === id))
        throw new BusinessError('REVISION_CONFLICT', 'Project ID already registered.');
      await atomicJson(this.file, {
        schema: 'web-project-registry/1',
        projects: [...records, { id, root: canonical, key }],
      });
      return id;
    });
  }
  async resolve(actor: ActorContext, id: string): Promise<string> {
    authorize(actor, id, 'read');
    const record = (await this.records()).find((p) => p.id === id);
    if (!record) throw new BusinessError('NOT_FOUND', 'Project not registered.');
    const actual = await realpath(record.root);
    const key = process.platform === 'win32' ? actual.toLowerCase() : actual;
    if (key !== record.key) throw new BusinessError('RUNTIME_UNCERTAIN', 'Project alias changed.');
    return actual;
  }
}
