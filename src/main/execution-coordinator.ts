import path from 'node:path';

export type ExecutionRef = { projectRoot: string; runId: string };

function refKey(ref: ExecutionRef) {
  return `${path.resolve(ref.projectRoot)}\0${ref.runId}`;
}

export function normalizeComfyUiEndpoint(endpoint: string) {
  const value = endpoint.trim();
  if (!value) throw new Error('Local ComfyUI API endpoint is required.');
  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString().replace(/\/$/, '');
  } catch {
    return value.replace(/\/+$/, '').toLowerCase();
  }
}

export class ExecutionResourceLockManager {
  private readonly resources = new Map<string, ExecutionRef>();
  private readonly refs = new Map<string, Set<string>>();

  private acquire(resource: string, ref: ExecutionRef) {
    const existing = this.resources.get(resource);
    if (existing && refKey(existing) !== refKey(ref))
      throw new Error(`Execution resource is already in use by Run ${existing.runId}: ${resource}`);
    this.resources.set(resource, ref);
    const key = refKey(ref);
    const owned = this.refs.get(key) ?? new Set<string>();
    owned.add(resource);
    this.refs.set(key, owned);
  }

  acquireLocal(endpoint: string, ref: ExecutionRef) {
    this.acquire(`local:${normalizeComfyUiEndpoint(endpoint)}`, ref);
  }

  acquireRemote(provider: string, instanceId: number, ref: ExecutionRef) {
    if (!provider.trim() || !Number.isInteger(instanceId) || instanceId < 1)
      throw new Error('Invalid Remote execution resource.');
    this.acquire(`remote:${provider.trim().toLowerCase()}:${instanceId}`, ref);
  }

  release(ref: ExecutionRef) {
    const key = refKey(ref);
    for (const resource of this.refs.get(key) ?? []) {
      const owner = this.resources.get(resource);
      if (owner && refKey(owner) === key) this.resources.delete(resource);
    }
    this.refs.delete(key);
  }
}

export class ExecutionCoordinator {
  private readonly active = new Map<string, Promise<void>>();

  constructor(private readonly locks = new ExecutionResourceLockManager()) {}

  hasActiveRuns() {
    return this.active.size > 0;
  }

  hasActive(ref: ExecutionRef) {
    return this.active.has(refKey(ref));
  }

  async waitForSettled(ref: ExecutionRef) {
    const task = this.active.get(refKey(ref));
    if (task) await task.catch(() => {});
  }

  startLocal(ref: ExecutionRef, endpoint: string, work: () => Promise<void>) {
    return this.start(ref, () => this.locks.acquireLocal(endpoint, ref), work);
  }

  startRemote(ref: ExecutionRef, provider: string, instanceId: number, work: () => Promise<void>) {
    return this.start(ref, () => this.locks.acquireRemote(provider, instanceId, ref), work);
  }

  private start(ref: ExecutionRef, acquire: () => void, work: () => Promise<void>) {
    const key = refKey(ref);
    const existing = this.active.get(key);
    if (existing) return existing;
    acquire();
    const task = Promise.resolve()
      .then(work)
      .finally(() => {
        this.locks.release(ref);
        this.active.delete(key);
      });
    this.active.set(key, task);
    return task;
  }
}
