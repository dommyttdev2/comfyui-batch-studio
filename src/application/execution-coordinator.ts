export type ExecutionRef = { projectRoot: string; runId: string };

function refKey(ref: ExecutionRef) {
  return `${ref.projectRoot}\0${ref.runId}`;
}

export class ExecutionResourceLockManager {
  constructor(
    private readonly normalizeEndpoint: (endpoint: string) => string = (endpoint) => {
      if (!endpoint.trim()) throw new Error('Local ComfyUI API endpoint is required.');
      return endpoint;
    },
  ) {}
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
    this.acquire(`local:${this.normalizeEndpoint(endpoint)}`, ref);
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
  private readonly retained = new Set<string>();

  constructor(private readonly locks = new ExecutionResourceLockManager()) {}

  hasActiveRuns() {
    return this.active.size > 0;
  }

  hasActive(ref: ExecutionRef) {
    return this.active.has(refKey(ref));
  }

  // Retain an uncertain Run's resource across a failed recovery: the old
  // ComfyUI process may still own an unobserved accepted Prompt.
  retain(ref: ExecutionRef) {
    const key = refKey(ref);
    if (!this.active.has(key) && !this.retained.has(key))
      throw new Error('A resource must be acquired before its reservation can be retained.');
    this.retained.add(key);
  }

  reserveLocal(ref: ExecutionRef, endpoint: string) {
    this.reserve(ref, () => this.locks.acquireLocal(endpoint, ref));
  }

  reserveRemote(ref: ExecutionRef, provider: string, instanceId: number) {
    this.reserve(ref, () => this.locks.acquireRemote(provider, instanceId, ref));
  }

  private reserve(ref: ExecutionRef, acquire: () => void) {
    const key = refKey(ref);
    if (this.active.has(key) || this.retained.has(key)) return;
    acquire();
    this.retained.add(key);
  }

  releaseReservation(ref: ExecutionRef) {
    const key = refKey(ref);
    if (!this.retained.delete(key)) return;
    if (!this.active.has(key)) this.locks.release(ref);
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
    // A persisted uncertain owner may have been reserved before reattachment.
    if (!this.retained.has(key)) acquire();
    else this.retained.delete(key);
    const task = Promise.resolve()
      .then(work)
      .finally(() => {
        if (!this.retained.has(key)) this.locks.release(ref);
        this.active.delete(key);
      });
    this.active.set(key, task);
    return task;
  }
}
