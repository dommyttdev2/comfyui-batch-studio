import type { Confirmation } from '../domain/confirmation-policy.js';
import { assertMutation } from '../application/project-access.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ActorContext, DomainEvent } from '../domain/contracts.js';
import { authorize } from '../domain/contracts.js';
import { assertCurrentProject } from '../application/project-access.js';
import type {
  ProjectRepository,
  ProjectState,
  ProjectTransaction,
} from '../application/project-ports.js';
import { HttpFailure, fields, object } from './http.js';
import { Ownership, type FileLease, type ProjectRegistry } from './ownership.js';
import { EventBroker, type ProjectEvent } from './events.js';
import { atomicJson, SerialQueue } from './storage.js';
interface Operation {
  id: string;
  user: string;
  hash: string;
  time: number;
  state: 'reserved' | 'done';
  result: ProjectState | null;
}
interface Envelope {
  schema: 'web-project-store/1';
  confirmations: Confirmation[];
  project: ProjectState;
  operations: Operation[];
  outbox: Omit<ProjectEvent, 'sequence'>[];
  delivery: number;
}
interface Context {
  id: string;
  envelope: Envelope;
  committed: boolean;
}
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => [k, canonical(x)]),
    );
  return v;
}
export class DiskProjects implements ProjectRepository {
  private readonly queues = new Map<string, SerialQueue>();
  private readonly leases = new Map<string, FileLease>();
  private readonly context = new AsyncLocalStorage<Context>();
  private readonly failed = new Set<string>();
  constructor(
    private readonly registry: ProjectRegistry,
    private readonly ownership: Ownership,
    private readonly broker: EventBroker,
    private readonly now = Date.now,
  ) {}
  private queue(id: string) {
    let q = this.queues.get(id);
    if (!q) {
      q = new SerialQueue();
      this.queues.set(id, q);
    }
    return q;
  }
  private actor(id: string): ActorContext {
    return {
      userId: 'repository',
      sessionId: 'server',
      requestId: 'load',
      projectIds: [id],
      permissions: ['read'],
    };
  }
  async root(id: string) {
    return this.registry.resolve(this.actor(id), id);
  }
  private async load(id: string): Promise<Envelope> {
    const root = await this.root(id);
    if (!this.leases.has(id))
      this.leases.set(id, await this.ownership.project(root, 'project:' + id));
    const file = path.join(root, 'web-project.json');
    const data = await readFile(file);
    if (data.length > 64 * 1024 * 1024) throw new HttpFailure(503, 'STORAGE_LIMIT');
    const e = object(JSON.parse(data.toString()));
    fields(e, ['schema', 'project', 'operations', 'outbox', 'delivery', 'confirmations']);
    if (
      e.schema !== 'web-project-store/1' ||
      !Array.isArray(e.confirmations) ||
      !Array.isArray(e.operations) ||
      !Array.isArray(e.outbox) ||
      !Number.isSafeInteger(e.delivery) ||
      Number(e.delivery) < 0 ||
      Number(e.delivery) > e.outbox.length
    )
      throw new HttpFailure(400, 'INVALID_PROJECT_STORE');
    assertCurrentProject(e.project as ProjectState, id);
    for (const op of e.operations) {
      const o = object(op);
      fields(o, ['id', 'user', 'hash', 'time', 'state', 'result']);
      if (
        typeof o.id !== 'string' ||
        typeof o.user !== 'string' ||
        typeof o.hash !== 'string' ||
        !Number.isSafeInteger(o.time) ||
        !['reserved', 'done'].includes(String(o.state))
      )
        throw new HttpFailure(400, 'INVALID_PROJECT_STORE');
      if (o.result !== null) assertCurrentProject(o.result as ProjectState, id);
    }
    for (const raw of e.outbox) {
      const x = object(raw);
      fields(x, ['type', 'eventId', 'projectId', 'revision', 'subjectId', 'requestId']);
      if (
        x.type !== 'project.changed' ||
        x.projectId !== id ||
        typeof x.eventId !== 'string' ||
        typeof x.subjectId !== 'string' ||
        typeof x.requestId !== 'string' ||
        !Number.isSafeInteger(x.revision) ||
        Number(x.revision) > Number((e.project as ProjectState).revision)
      )
        throw new HttpFailure(400, 'INVALID_PROJECT_STORE');
    }
    return e as unknown as Envelope;
  }
  private async persist(id: string, e: Envelope) {
    const encoded = JSON.stringify(e);
    if (Buffer.byteLength(encoded) > 64 * 1024 * 1024) throw new HttpFailure(503, 'STORAGE_LIMIT');
    try {
      await atomicJson(path.join(await this.root(id), 'web-project.json'), e);
    } catch (error) {
      this.failed.add(id);
      throw error;
    }
  }
  async flush(id: string, e: Envelope): Promise<void> {
    for (let n = e.delivery; n < e.outbox.length; n++) {
      await this.broker.appendProject(e.outbox[n]);
      e.delivery = n + 1;
      await this.persist(id, e);
      await this.broker.acknowledge([e.outbox[n].eventId]);
    }
    if (e.delivery === e.outbox.length && e.outbox.length) {
      await this.broker.acknowledge(e.outbox.map((event) => event.eventId));
      e.outbox = [];
      e.delivery = 0;
      await this.persist(id, e);
    }
  }
  async initialize() {
    for (const r of await this.registry.records())
      await this.queue(r.id).run(async () => {
        const e = await this.load(r.id);
        await this.flush(r.id, e);
        const startupId = randomUUID();
        await this.broker.appendProject({
          type: 'project.changed',
          eventId: startupId,
          projectId: r.id,
          revision: e.project.revision,
          subjectId: 'snapshot',
          requestId: 'startup',
        });
        await this.broker.acknowledge([startupId]);
      });
  }
  async transaction<T>(id: string, work: (tx: ProjectTransaction) => Promise<T>): Promise<T> {
    const existing = this.context.getStore();
    if (existing && existing.id === id) return work(this.tx(existing));
    return this.queue(id).run(async () => {
      const envelope = await this.load(id);
      return work({
        load: async () => structuredClone(envelope.project),
        commit: async () => {
          throw new HttpFailure(409, 'OPERATION_REQUIRED');
        },
      });
    });
  }
  private tx(ctx: Context): ProjectTransaction {
    return {
      load: async () => structuredClone(ctx.envelope.project),
      commit: async (before, next, event: DomainEvent) => {
        if (
          ctx.committed ||
          ctx.envelope.project.revision !== before ||
          next.revision !== before + 1 ||
          event.projectId !== ctx.id ||
          event.revision !== next.revision ||
          event.type !== 'project.changed'
        )
          throw new HttpFailure(409, 'REVISION_CONFLICT');
        assertCurrentProject(next, ctx.id);
        ctx.envelope.project = structuredClone(next);
        ctx.envelope.outbox.push({
          type: 'project.changed',
          eventId: randomUUID(),
          projectId: ctx.id,
          revision: next.revision,
          subjectId: event.subjectId,
          requestId: event.requestId,
        });
        ctx.committed = true;
      },
    };
  }
  async execute(
    actor: ActorContext,
    id: string,
    key: string,
    input: unknown,
    work: () => Promise<ProjectState>,
  ): Promise<{ project: ProjectState; eventDelivery: 'complete' | 'pending' }> {
    authorize(actor, id, 'edit');
    return this.queue(id).run(async () => {
      if (this.failed.has(id)) throw new HttpFailure(409, 'OPERATION_UNCERTAIN');
      const e = await this.load(id);
      const hash = createHash('sha256')
        .update(JSON.stringify(canonical(input)))
        .digest('hex');
      const previous = e.operations.find((o) => o.id === key && o.user === actor.userId);
      if (previous) {
        if (previous.hash !== hash) throw new HttpFailure(409, 'OPERATION_KEY_CONFLICT');
        if (previous.state !== 'done') throw new HttpFailure(409, 'OPERATION_UNCERTAIN');
        if (!previous.result || this.now() - previous.time > 7 * 86400000)
          throw new HttpFailure(410, 'OPERATION_EXPIRED');
        return {
          project: structuredClone(previous.result),
          eventDelivery: e.delivery === e.outbox.length ? 'complete' : 'pending',
        };
      }
      if (e.operations.length >= 100000) throw new HttpFailure(503, 'STORAGE_LIMIT');
      for (const op of e.operations) if (this.now() - op.time > 7 * 86400000) op.result = null;
      const operation: Operation = {
        id: key,
        user: actor.userId,
        hash,
        time: this.now(),
        state: 'reserved',
        result: null,
      };
      e.operations.push(operation);
      await this.persist(id, e);
      const beforeConfirmations = structuredClone(e.confirmations);
      const beforeProject = structuredClone(e.project);
      const beforeOutbox = structuredClone(e.outbox);
      const ctx: Context = { id, envelope: e, committed: false };
      let result: ProjectState;
      try {
        result = await this.context.run(ctx, work);
        if (!ctx.committed) throw new HttpFailure(409, 'OPERATION_UNCERTAIN');
      } catch (error) {
        e.confirmations = beforeConfirmations;
        e.project = beforeProject;
        e.outbox = beforeOutbox;
        e.operations = e.operations.filter((o) => o !== operation);
        await this.persist(id, e);
        throw error;
      }
      operation.state = 'done';
      operation.result = structuredClone(result);
      await this.persist(id, e);
      let eventDelivery: 'complete' | 'pending' = 'complete';
      try {
        await this.flush(id, e);
      } catch {
        eventDelivery = 'pending';
      }
      return { project: result, eventDelivery };
    });
  }
  fingerprint(project: ProjectState) {
    return createHash('sha256')
      .update(JSON.stringify(canonical({ artifacts: project.artifacts, drafts: project.drafts })))
      .digest('hex');
  }
  async prepare(
    actor: ActorContext,
    id: string,
    input: { expectedRevision: number; leaseId: string; target: string; stage: boolean },
  ): Promise<Confirmation> {
    return this.queue(id).run(async () => {
      const e = await this.load(id);
      assertMutation(actor, { projectId: id, ...input }, e.project, { now: this.now });
      e.confirmations = e.confirmations.filter((c) => c.expiresAt > this.now());
      if (e.confirmations.length >= 1000) throw new HttpFailure(503, 'STORAGE_LIMIT');
      const confirmation: Confirmation = {
        id: randomUUID(),
        userId: actor.userId,
        sessionId: actor.sessionId,
        projectId: id,
        operation: input.stage ? 'stage-reset' : 'artifact-reset',
        targetId: input.target,
        fingerprint: this.fingerprint(e.project),
        revision: e.project.revision,
        expiresAt: this.now() + 60000,
      };
      e.confirmations.push(confirmation);
      await this.persist(id, e);
      return confirmation;
    });
  }
  take(id: string): Confirmation {
    const ctx = this.context.getStore();
    if (!ctx) throw new HttpFailure(409, 'OPERATION_REQUIRED');
    const value = ctx.envelope.confirmations.find((c) => c.id === id);
    if (!value) throw new HttpFailure(409, 'CONFIRMATION_REQUIRED');
    ctx.envelope.confirmations = ctx.envelope.confirmations.filter((c) => c.id !== id);
    return value;
  }
  async close() {
    for (const q of this.queues.values()) await q.drain();
    for (const lease of this.leases.values()) await lease.release();
    this.leases.clear();
  }
}
