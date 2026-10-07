const copy = (value) => structuredClone(value);
class MemoryProjects {
  constructor(project, BusinessError) {
    this.state = copy(project);
    this.BusinessError = BusinessError;
    this.events = [];
    this.tail = Promise.resolve();
    this.failCommit = false;
  }
  async transaction(id, work) {
    const before = this.tail;
    let release;
    this.tail = new Promise((resolve) => {
      release = resolve;
    });
    await before;
    try {
      if (id !== this.state.id)
        throw new this.BusinessError('NOT_FOUND', 'Project not registered.');
      let committed = false;
      return await work({
        load: async () => copy(this.state),
        commit: async (expected, next, event) => {
          if (committed || expected !== this.state.revision || next.revision !== expected + 1)
            throw new this.BusinessError('REVISION_CONFLICT', 'CAS failed.');
          if (this.failCommit) throw new Error('Persistence unavailable');
          this.state = copy(next);
          this.events.push(copy(event));
          committed = true;
        },
      });
    } finally {
      release();
    }
  }
}
class MemoryAgent {
  constructor(BusinessError) {
    this.BusinessError = BusinessError;
    this.active = new Map();
    this.requests = new Map();
    this.launches = [];
    this.availableGate = null;
    this.isAvailable = true;
    this.counter = 0;
  }
  key(scope) {
    return JSON.stringify(scope);
  }
  async reserve(scope, request, input) {
    const key = this.key(scope),
      prior = this.requests.get(key + request),
      serialized = JSON.stringify(input);
    if (prior) {
      if (prior.input !== serialized)
        throw new this.BusinessError('INVALID_INPUT', 'Request key reused for different command.');
      return { job: copy(prior.job), acquired: false };
    }
    if (this.active.has(key))
      throw new this.BusinessError('RUNTIME_BUSY', 'Agent scope already reserved.');
    const record = { job: { id: 'job-' + ++this.counter, status: 'reserved' }, input: serialized };
    this.active.set(key, record);
    this.requests.set(key + request, record);
    return { job: copy(record.job), acquired: true };
  }
  async available() {
    if (this.availableGate) await this.availableGate;
    return this.isAvailable;
  }
  async launch(scope, id, input) {
    this.launches.push({ scope: copy(scope), id, input: copy(input) });
    const record = this.active.get(this.key(scope));
    record.job.status = 'running';
    return copy(record.job);
  }
  async fail(scope, id) {
    const record = this.active.get(this.key(scope));
    if (record?.job.id !== id) throw new this.BusinessError('FORBIDDEN', 'Job mismatch.');
    record.job.status = 'failed';
    this.active.delete(this.key(scope));
  }
  async markUnknown(scope, id) {
    const record = this.active.get(this.key(scope));
    if (record?.job.id !== id) throw new this.BusinessError('FORBIDDEN', 'Job mismatch.');
    record.job.status = 'unknown';
  }
  async stop(scope, id) {
    const record = this.active.get(this.key(scope));
    if (record?.job.id !== id) throw new this.BusinessError('FORBIDDEN', 'Job mismatch.');
    record.job.status = 'cancelled';
    this.active.delete(this.key(scope));
    return copy(record.job);
  }
  async history() {
    return [];
  }
}
class MemoryExecution {
  constructor(run) {
    this.run = copy(run);
    this.calls = [];
    this.tail = Promise.resolve();
    this.stalls = false;
    this.finalizationFails = false;
  }
  async withRunLock(project, id, work) {
    const before = this.tail;
    let release;
    this.tail = new Promise((resolve) => {
      release = resolve;
    });
    await before;
    try {
      return await work();
    } finally {
      release();
    }
  }
  async load(project, id) {
    if (id !== this.run.id) throw new Error('Run not found');
    return copy(this.run);
  }
  async creation(project) {
    const snapshot = {
      projectId: project,
      target: 'local',
      remote: null,
      runIdentity: 'source',
      workflow: { workflowIdentity: 'workflow', modelsSha256: 'models' },
      plan: { sha256: 'plan', branches: [{ branchId: 'b', leafIds: ['l'] }] },
    };
    return {
      exclusive: (work) => this.withRunLock(project, 'new', work),
      current: async () => null,
      capture: async () => copy(snapshot),
      preflightInputs: async () =>
        (await require('../core-preflight-fixture.cjs').preflightFixture(project)).ports,
      persistSnapshot: async (id, value) => value,
      removeSnapshot: async () => {},
      setCurrent: async () => {},
      write: async (run) => {
        this.rawRun = copy(run);
        this.run = {
          id: run.runId,
          target: run.executionTarget,
          lifecycle: run.lifecycle,
          phase: run.phase,
          recovery: 'known',
          finalization: 'not-required',
        };
      },
      now: () => '2026-10-06T00:00:00Z',
      nextId: () => 'new-run',
    };
  }
  async launch() {
    this.calls.push('launch');
  }

  async recovery() {
    return {
      load: async () => copy(this.rawRun),
      save: async (run) => {
        this.rawRun = copy(run);
      },
      hasActiveWorker: async () => false,
      reserveOwnership: async () => this.calls.push('reserve'),
      recoverLocal: async () => this.calls.push('recover-submitted'),
      recoverRemote: async () => this.calls.push('recover-remote'),
      verifyLocalOutputs: async () => this.calls.push('verify-output'),
      finalizeRemote: async () => this.calls.push('finalize'),
      hash: (value) => JSON.stringify(value),
      now: () => '2026-10-06T00:00:00Z',
    };
  }

  async pausePreparation() {
    this.calls.push('pause');
    this.run.lifecycle = 'PAUSED';
  }
  async stopScheduling() {
    this.calls.push('schedule-stop');
  }
  async interrupt() {
    this.calls.push('interrupt');
  }
  async recoverLocal() {
    this.calls.push('recover-local');
    this.run.recovery = 'known';
    this.run.lifecycle = 'PAUSED';
  }
  async waitForSettled() {
    this.calls.push('wait');
    if (!this.stalls && this.run.lifecycle === 'RUNNING') this.run.lifecycle = 'PAUSED';
  }
  async finalizeRemote() {
    this.calls.push('finalize');
    if (!this.finalizationFails) this.run.finalization = 'stopped';
  }
}
class MemoryConfirmations {
  constructor(BusinessError) {
    this.BusinessError = BusinessError;
    this.values = new Map();
    this.current = { fingerprint: 'price-1', revision: 1 };
    this.effects = 0;
  }
  async inspect() {
    return copy(this.current);
  }
  async save(value) {
    this.values.set(value.id, copy(value));
  }
  async execute(id, check) {
    const value = this.values.get(id);
    if (!value)
      throw new this.BusinessError('CONFIRMATION_REQUIRED', 'Confirmation absent or consumed.');
    check(copy(value), copy(this.current));
    this.values.delete(id);
    this.effects++;
    return { id: 'operation-' + this.effects, status: 'reserved' };
  }
}
module.exports = { MemoryProjects, MemoryAgent, MemoryExecution, MemoryConfirmations };
