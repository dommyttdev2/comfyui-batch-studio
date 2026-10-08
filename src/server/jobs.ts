import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { type ActorContext, authorize, BusinessError } from '../domain/contracts.js';
import {
  fields,
  HttpFailure,
  identifier,
  json,
  object,
  type JsonObject,
  type RequestContext,
} from './http.js';
import { atomicJson, SerialQueue } from './storage.js';

export type JobState =
  | 'reserved'
  | 'running'
  | 'cancelling'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'uncertain';
export interface PublicJob {
  id: string;
  projectId: string;
  kind: string;
  state: JobState;
  stage: string;
  provider: string;
  sessionId: string;
  turnId: string;
  progress: number;
  revision: number;
}
interface StoredJob extends PublicJob {
  userId: string;
  requestId: string;
  key: string;
  inputHash: string;
  input: JsonObject;
}
export interface JobDefinition {
  validate(input: JsonObject): void;
  reserve?(
    job: PublicJob,
    actor: ActorContext,
    input: JsonObject,
  ): Promise<{ release(): Promise<void> }>;
  run(context: {
    job: PublicJob;
    actor: ActorContext;
    input: JsonObject;
    signal: AbortSignal;
    progress(value: number): Promise<void>;
  }): Promise<{ state: 'succeeded' | 'failed' | 'cancelled' | 'uncertain' }>;
  interrupt?(job: PublicJob, input: JsonObject): Promise<void>;
  reconcile?(
    job: PublicJob,
    input: JsonObject,
  ): Promise<{ state: 'succeeded' | 'failed' | 'cancelled' | 'uncertain' }>;
}
export function publicJob(job: StoredJob | PublicJob): PublicJob {
  const { id, projectId, kind, state, stage, provider, sessionId, turnId, progress, revision } =
    job;
  return { id, projectId, kind, state, stage, provider, sessionId, turnId, progress, revision };
}
const terminal = (state: JobState) => ['succeeded', 'failed', 'cancelled'].includes(state);
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonical((value as JsonObject)[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export class JobRegistry {
  private readonly file: string;
  private jobs: StoredJob[] = [];
  private readonly queue = new SerialQueue();
  private readonly active = new Map<string, { promise: Promise<void>; abort: AbortController }>();
  private readonly reconciling = new Map<string, Promise<PublicJob>>();
  private readonly leases = new Map<string, { release(): Promise<void> }>();
  private accepting = true;
  private readonly forced = new Set<string>();
  private fault: unknown;
  constructor(
    dataDir: string,
    private readonly definitions: ReadonlyMap<string, JobDefinition>,
    private readonly changed: (job: PublicJob) => Promise<void> = async () => {},
  ) {
    this.file = path.join(dataDir, 'jobs.json');
  }
  async initialize(): Promise<void> {
    try {
      const value = object(JSON.parse(await readFile(this.file, 'utf8')));
      if (value.schema !== 'web-jobs/1' || !Array.isArray(value.jobs))
        throw new HttpFailure(400, 'INVALID_JOB_STORE');
      this.jobs = value.jobs.map((raw) => {
        const job = object(raw);
        fields(job, [
          'id',
          'projectId',
          'kind',
          'state',
          'stage',
          'provider',
          'sessionId',
          'turnId',
          'progress',
          'revision',
          'userId',
          'requestId',
          'key',
          'inputHash',
          'input',
        ]);
        for (const key of [
          'id',
          'projectId',
          'kind',
          'stage',
          'provider',
          'sessionId',
          'turnId',
          'userId',
          'requestId',
          'key',
        ])
          identifier(job[key]);
        object(job.input);
        if (
          typeof job.inputHash !== 'string' ||
          !/^[a-f0-9]{64}$/.test(job.inputHash) ||
          ![
            'reserved',
            'running',
            'cancelling',
            'succeeded',
            'failed',
            'cancelled',
            'uncertain',
          ].includes(job.state as string) ||
          !Number.isSafeInteger(job.revision) ||
          (job.revision as number) < 0 ||
          typeof job.progress !== 'number' ||
          job.progress < 0 ||
          job.progress > 1
        )
          throw new HttpFailure(400, 'INVALID_JOB_STORE');
        return job as unknown as StoredJob;
      });
      if (new Set(this.jobs.map((j) => j.id)).size !== this.jobs.length)
        throw new HttpFailure(400, 'INVALID_JOB_STORE');
      for (const job of this.jobs)
        if (!terminal(job.state)) {
          job.state = 'uncertain';
          job.revision++;
        }
      await this.persist();
      for (const job of this.jobs) await this.changed(publicJob(job));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  private persist(): Promise<void> {
    return atomicJson(this.file, { schema: 'web-jobs/1', jobs: this.jobs });
  }
  list(actor: ActorContext): PublicJob[] {
    return this.jobs
      .filter((j) => actor.projectIds.includes(j.projectId) && actor.permissions.includes('read'))
      .map(publicJob);
  }
  get(actor: ActorContext, id: string): PublicJob {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) throw new BusinessError('NOT_FOUND', 'Job not found.');
    authorize(actor, job.projectId, 'read');
    return publicJob(job);
  }
  private async accept(
    actor: ActorContext,
    projectId: string,
    kind: string,
    key: string,
    input: JsonObject,
    scope: { stage: string; provider: string; turnId: string },
    deferred = false,
  ): Promise<{ job: PublicJob; acquired: boolean }> {
    authorize(actor, identifier(projectId), 'execute');
    identifier(key);
    identifier(kind);
    Object.values(scope).forEach(identifier);
    const definition = this.definitions.get(kind);
    if (!definition) throw new HttpFailure(501, 'NOT_IMPLEMENTED');
    definition.validate(input);
    const inputHash = createHash('sha256').update(canonical({ input, scope })).digest('hex');
    const result = await this.queue.run(async () => {
      if (!this.accepting) throw new HttpFailure(503, 'SERVER_DRAINING');
      const previous = this.jobs.find(
        (j) =>
          j.projectId === projectId &&
          j.userId === actor.userId &&
          j.kind === kind &&
          j.key === key,
      );
      if (previous) {
        if (previous.inputHash !== inputHash)
          throw new BusinessError('REVISION_CONFLICT', 'Idempotency input changed.');
        return { job: previous, fresh: false };
      }
      if (
        this.jobs.some(
          (j) =>
            j.projectId === projectId &&
            j.kind === kind &&
            j.stage === scope.stage &&
            j.provider === scope.provider &&
            !terminal(j.state),
        )
      )
        throw new BusinessError('RUNTIME_BUSY', 'Scope already reserved.');
      if (this.jobs.length >= 10_000) throw new HttpFailure(503, 'JOB_CAPACITY');
      const job: StoredJob = {
        id: randomUUID(),
        projectId,
        kind,
        state: 'reserved',
        ...scope,
        sessionId: actor.sessionId,
        userId: actor.userId,
        requestId: actor.requestId,
        key,
        inputHash,
        input,
        progress: 0,
        revision: 0,
      };
      this.jobs.push(job);
      // No side effect may occur until this reservation has been persisted.
      try {
        await this.persist();
      } catch (error) {
        this.fault = error;
        this.accepting = false;
        throw error;
      }
      return { job, fresh: true };
    });
    if (result.fresh && !deferred) this.start(result.job, actor, definition);
    return { job: publicJob(result.job), acquired: result.fresh };
  }
  async submit(
    actor: ActorContext,
    projectId: string,
    kind: string,
    key: string,
    input: JsonObject,
    scope: { stage: string; provider: string; turnId: string },
  ): Promise<PublicJob> {
    return (await this.accept(actor, projectId, kind, key, input, scope)).job;
  }
  async reserve(
    actor: ActorContext,
    projectId: string,
    kind: string,
    key: string,
    input: JsonObject,
    scope: { stage: string; provider: string; turnId: string },
  ) {
    return this.accept(actor, projectId, kind, key, input, scope, true);
  }
  private activating = new Set<string>();
  private owned(actor: ActorContext, id: string) {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) throw new BusinessError('NOT_FOUND', 'Job not found.');
    authorize(actor, job.projectId, 'execute');
    if (job.userId !== actor.userId) throw new BusinessError('FORBIDDEN', 'Job owner differs.');
    return job;
  }
  reservationInput(actor: ActorContext, id: string): JsonObject {
    return structuredClone(this.owned(actor, id).input);
  }
  async activate(actor: ActorContext, id: string, input: JsonObject): Promise<PublicJob> {
    const job = this.owned(actor, id);
    await this.queue.run(async () => {
      if (job.state !== 'reserved' || this.activating.has(id) || this.active.has(id))
        throw new BusinessError('RUNTIME_BUSY', 'Reservation already activated.');
      if (!this.accepting) throw new HttpFailure(503, 'SERVER_DRAINING');
      this.definitions.get(job.kind)!.validate(input);
      job.input = input;
      try {
        await this.persist();
      } catch (e) {
        this.fault = e;
        this.accepting = false;
        throw e;
      }
      this.activating.add(id);
    });
    this.start(job, actor, this.definitions.get(job.kind)!);
    return publicJob(job);
  }
  async rejectReservation(actor: ActorContext, id: string, state: 'failed' | 'uncertain') {
    const job = this.owned(actor, id);
    if (state === 'failed' && (this.active.has(id) || this.activating.has(id)))
      throw new BusinessError('RUNTIME_UNCERTAIN', 'Reservation already activated.');
    await this.update(job, state);
  }
  private start(job: StoredJob, actor: ActorContext, definition: JobDefinition) {
    const abort = new AbortController();
    const promise = this.execute(job, actor, definition, abort.signal).finally(() =>
      this.active.delete(job.id),
    );
    this.active.set(job.id, { promise, abort });
    void promise.catch(() => {
      this.accepting = false;
    });
  }
  private async update(job: StoredJob, state: JobState, progress = job.progress): Promise<void> {
    await this.queue.run(async () => {
      if (terminal(job.state) || (this.forced.has(job.id) && state !== 'uncertain')) return;
      if (job.state === 'cancelling' && state === 'running') state = 'cancelling';
      job.state = state;
      job.progress = progress;
      job.revision++;
      try {
        await this.persist();
        await this.changed(publicJob(job));
      } catch (error) {
        this.fault = error;
        this.accepting = false;
        job.state = 'uncertain';
        throw error;
      }
    });
  }
  private async execute(
    job: StoredJob,
    actor: ActorContext,
    definition: JobDefinition,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      if (definition.reserve)
        this.leases.set(job.id, await definition.reserve(publicJob(job), actor, job.input));
      if (signal.aborted) {
        await this.finish(job, 'cancelled');
        return;
      }
      await this.update(job, 'running');
      const outcome = await definition.run({
        job: publicJob(job),
        actor,
        input: job.input,
        signal,
        progress: async (value) => {
          if (!Number.isFinite(value) || value < 0 || value > 1 || value < job.progress)
            throw new BusinessError('INVALID_INPUT', 'Invalid progress.');
          await this.update(job, job.state, value);
        },
      });
      await this.finish(job, outcome.state);
    } catch {
      // A thrown runtime error is not evidence that an external side effect failed.
      await this.update(job, 'uncertain');
    }
  }
  private async finish(job: StoredJob, state: JobState): Promise<void> {
    if (this.forced.has(job.id)) return;
    if (!['succeeded', 'failed', 'cancelled', 'uncertain'].includes(state))
      throw new BusinessError('RUNTIME_UNCERTAIN', 'Invalid outcome.');
    if (terminal(state)) {
      await this.leases.get(job.id)?.release();
      this.leases.delete(job.id);
    }
    await this.update(job, state, state === 'succeeded' ? 1 : job.progress);
  }
  async cancel(actor: ActorContext, id: string): Promise<PublicJob> {
    const known = this.get(actor, id);
    authorize(actor, known.projectId, 'execute');
    const job = this.jobs.find((j) => j.id === id)!;
    if (terminal(job.state)) return publicJob(job);
    if (job.kind === 'agent' && job.userId !== actor.userId)
      throw new BusinessError('FORBIDDEN', 'Agent job owner differs.');
    const work = this.active.get(id);
    if (!work) throw new BusinessError('RUNTIME_UNCERTAIN', 'Reconciliation required.');
    await this.update(job, 'cancelling');
    work.abort.abort();
    return publicJob(job);
  }
  async reconcile(actor: ActorContext, id: string): Promise<PublicJob> {
    const known = this.get(actor, id);
    authorize(actor, known.projectId, 'admin');
    if (!this.accepting) throw new HttpFailure(503, 'SERVER_DRAINING');
    if (this.active.has(id)) throw new BusinessError('RUNTIME_BUSY', 'Job is active.');
    const job = this.jobs.find((j) => j.id === id)!;
    if (job.state !== 'uncertain') return publicJob(job);
    const definition = this.definitions.get(job.kind);
    if (!definition?.reconcile)
      throw new BusinessError('DEPENDENCY_UNAVAILABLE', 'Reconciliation adapter unavailable.');
    const existing = this.reconciling.get(id);
    if (existing) return existing;
    const pending = Promise.resolve().then(async () => {
      const outcome = await definition.reconcile!(publicJob(job), job.input);
      await this.finish(job, outcome.state);
      return publicJob(job);
    });
    this.reconciling.set(id, pending);
    try {
      return await pending;
    } finally {
      this.reconciling.delete(id);
    }
  }
  stopAccepting(): void {
    this.accepting = false;
  }
  async drain(): Promise<void> {
    await Promise.allSettled(
      [...this.active.values()]
        .map((w) => w.promise)
        .concat(
          [...this.reconciling.values()].map(async (p) => {
            await p;
          }),
        ),
    );
    await this.queue.drain();
    if (this.fault) throw new Error('Job persistence requires reconciliation.');
  }
  requestStopAll(): void {
    for (const work of this.active.values()) work.abort.abort();
  }
  async forceUncertain(): Promise<void> {
    this.stopAccepting();
    const interrupts: Promise<void>[] = [];
    for (const [id, work] of this.active) {
      this.forced.add(id);
      work.abort.abort();
      const job = this.jobs.find((j) => j.id === id)!;
      await this.update(job, 'uncertain');
      const interrupt = this.definitions.get(job.kind)?.interrupt;
      if (interrupt) interrupts.push(interrupt(publicJob(job), job.input));
    }
    for (const id of this.reconciling.keys()) {
      this.forced.add(id);
      await this.update(this.jobs.find((job) => job.id === id)!, 'uncertain');
    }
    await Promise.all(interrupts);
  }
  route = async ({ request, response, url, actor, input }: RequestContext): Promise<boolean> => {
    if (url.pathname === '/api/v1/jobs' && request.method === 'GET') {
      json(response, 200, { jobs: this.list(actor) });
      return true;
    }
    const get = /^\/api\/v1\/jobs\/([a-zA-Z0-9_-]+)(?:\/(cancel|reconcile))?$/.exec(url.pathname);
    if (get) {
      if (request.method === 'GET' && !get[2]) {
        json(response, 200, { job: this.get(actor, get[1]) });
        return true;
      }
      if (request.method === 'POST' && get[2]) {
        fields(input, []);
        json(response, 202, {
          job:
            get[2] === 'cancel'
              ? await this.cancel(actor, get[1])
              : await this.reconcile(actor, get[1]),
        });
        return true;
      }
    }
    const create = /^\/api\/v1\/projects\/([a-zA-Z0-9_-]+)\/jobs\/([a-z0-9-]+)$/.exec(url.pathname);
    if (create && request.method === 'POST') {
      if (create[2] === 'agent') throw new HttpFailure(400, 'AGENT_API_REQUIRED');
      fields(input, ['input', 'stage', 'provider', 'turnId']);
      json(response, 202, {
        job: await this.submit(
          actor,
          create[1],
          create[2],
          identifier(request.headers['idempotency-key']),
          object(input.input),
          {
            stage: identifier(input.stage),
            provider: identifier(input.provider),
            turnId: identifier(input.turnId),
          },
        ),
      });
      return true;
    }
    return false;
  };
}
