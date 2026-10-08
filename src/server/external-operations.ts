import { randomUUID } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  assertConfirmation,
  type Confirmation,
  type ConfirmedOperation,
} from '../domain/confirmation-policy.js';
import { type ActorContext, authorize } from '../domain/contracts.js';
import {
  fields,
  HttpFailure,
  identifier,
  type JsonObject,
  json,
  object,
  type RequestContext,
} from './http.js';
import { atomicJson, SerialQueue } from './storage.js';

export type ExternalOperation = Extract<
  ConfirmedOperation,
  | 'rent-instance'
  | 'delete-instance'
  | 'start-instance'
  | 'stop-instance'
  | 'reboot-instance'
  | 'create-bucket'
  | 'delete-bucket'
  | 'delete-objects'
  | 'move-object'
  | 'copy-object'
  | 'trust-ssh'
>;
const operations: ExternalOperation[] = [
  'rent-instance',
  'delete-instance',
  'start-instance',
  'stop-instance',
  'reboot-instance',
  'create-bucket',
  'delete-bucket',
  'delete-objects',
  'move-object',
  'copy-object',
  'trust-ssh',
];
export interface ExternalFacts {
  revision: number;
  fingerprint: string;
  summary: JsonObject;
}
export interface ExternalDefinition {
  scope(targetId: string): string;
  inspect(actor: ActorContext, targetId: string): Promise<ExternalFacts>;
  execute(
    actor: ActorContext,
    targetId: string,
    receiptId: string,
    facts: ExternalFacts,
  ): Promise<{ state: 'succeeded' | 'failed' | 'uncertain'; result?: JsonObject }>;
  reconcile?(
    actor: ActorContext,
    receiptId: string,
    targetId: string,
    facts: ExternalFacts,
  ): Promise<{ state: 'succeeded' | 'failed' | 'uncertain'; result?: JsonObject }>;
}
type Binding = { projectId: string; expectedRevision: number; leaseId: string };
type Prepared = {
  confirmation: Confirmation;
  facts: ExternalFacts;
  binding: Binding | null;
  scope: string;
  consumed: boolean;
};
type Receipt = {
  id: string;
  confirmationId: string;
  userId: string;
  projectId: string;
  operation: ExternalOperation;
  targetId: string;
  scope: string;
  facts: ExternalFacts;
  state: 'reserved' | 'running' | 'succeeded' | 'failed' | 'uncertain';
  result?: JsonObject;
};
type Store = {
  schema: 'web-external-operations/1';
  confirmations: Prepared[];
  receipts: Receipt[];
};
function admin(actor: ActorContext): void {
  if (!actor.permissions.includes('admin')) throw new HttpFailure(403, 'FORBIDDEN');
}
function operation(raw: unknown): ExternalOperation {
  if (!operations.includes(raw as ExternalOperation)) throw new HttpFailure(400, 'INVALID_INPUT');
  return raw as ExternalOperation;
}
function number(raw: unknown): number {
  if (!Number.isSafeInteger(raw) || (raw as number) < 0)
    throw new HttpFailure(400, 'INVALID_INPUT');
  return raw as number;
}
function facts(raw: unknown): ExternalFacts {
  const value = object(raw);
  fields(value, ['revision', 'fingerprint', 'summary']);
  if (
    typeof value.fingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.fingerprint) ||
    Buffer.byteLength(JSON.stringify(value.summary)) > 8192
  )
    throw new HttpFailure(400, 'INVALID_FACTS');
  return {
    revision: number(value.revision),
    fingerprint: value.fingerprint,
    summary: object(value.summary),
  };
}
function binding(raw: unknown): Binding | null {
  if (raw === null || raw === undefined) return null;
  const value = object(raw);
  fields(value, ['projectId', 'expectedRevision', 'leaseId']);
  return {
    projectId: identifier(value.projectId),
    expectedRevision: number(value.expectedRevision),
    leaseId: identifier(value.leaseId),
  };
}
export class ExternalOperations {
  private value: Store = { schema: 'web-external-operations/1', confirmations: [], receipts: [] };
  private readonly file: string;
  private readonly queue = new SerialQueue();
  private readonly active = new Map<string, Promise<void>>();
  private readonly fenced = new Set<string>();
  private readonly reconciling = new Set<string>();
  private fault = false;
  private initialized = false;
  private accepting = true;
  constructor(
    dataDir: string,
    private readonly definitions: ReadonlyMap<ExternalOperation, ExternalDefinition>,
    private readonly guard: (actor: ActorContext, binding: Binding) => Promise<void> = async () => {
      throw new HttpFailure(403, 'FORBIDDEN');
    },
    private readonly reauthorize: (actor: ActorContext) => Promise<ActorContext> = async (actor) =>
      actor,
    private readonly now = Date.now,
  ) {
    this.file = path.join(dataDir, 'external-operations.json');
  }
  async initialize(): Promise<void> {
    let info;
    try {
      info = await lstat(this.file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.initialized = true;
        return;
      }
      throw new HttpFailure(503, 'EXTERNAL_STORE_UNAVAILABLE');
    }
    try {
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.size > 4 * 1024 * 1024 ||
        (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
      )
        throw new Error('Invalid store');
      const raw = object(JSON.parse(await readFile(this.file, 'utf8')));
      fields(raw, ['schema', 'confirmations', 'receipts']);
      if (
        raw.schema !== 'web-external-operations/1' ||
        !Array.isArray(raw.confirmations) ||
        !Array.isArray(raw.receipts) ||
        raw.confirmations.length > 1000 ||
        raw.receipts.length > 1000
      )
        throw new Error('Invalid store');
      const ids = new Set<string>();
      const confirmations = raw.confirmations.map((entry): Prepared => {
        const p = object(entry);
        fields(p, ['confirmation', 'facts', 'binding', 'scope', 'consumed']);
        const c = object(p.confirmation);
        fields(c, [
          'id',
          'userId',
          'sessionId',
          'projectId',
          'operation',
          'targetId',
          'fingerprint',
          'revision',
          'expiresAt',
        ]);
        for (const key of ['id', 'userId', 'sessionId', 'projectId', 'targetId'])
          identifier(c[key]);
        if (
          ids.has(c.id as string) ||
          typeof p.consumed !== 'boolean' ||
          typeof p.scope !== 'string' ||
          !/^[a-zA-Z0-9_:/.-]{1,256}$/.test(p.scope)
        )
          throw new Error('Invalid confirmation');
        ids.add(c.id as string);
        operation(c.operation);
        number(c.expiresAt);
        number(c.revision);
        const inspected = facts(p.facts);
        const bound = binding(p.binding);
        if (
          c.fingerprint !== inspected.fingerprint ||
          c.revision !== inspected.revision ||
          c.projectId !== (bound?.projectId ?? 'global')
        )
          throw new Error('Invalid binding');
        return {
          confirmation: c as unknown as Confirmation,
          facts: inspected,
          binding: bound,
          scope: p.scope,
          consumed: p.consumed,
        };
      });
      const receipts = raw.receipts.map((entry): Receipt => {
        const r = object(entry);
        fields(r, [
          'id',
          'confirmationId',
          'userId',
          'projectId',
          'operation',
          'targetId',
          'scope',
          'facts',
          'state',
          'result',
        ]);
        identifier(r.id);
        identifier(r.confirmationId);
        identifier(r.userId);
        identifier(r.projectId);
        identifier(r.targetId);
        operation(r.operation);
        if (
          ids.has(r.id as string) ||
          !['reserved', 'running', 'succeeded', 'failed', 'uncertain'].includes(r.state as string)
        )
          throw new Error('Invalid receipt');
        ids.add(r.id as string);
        const prepared = confirmations.find((p) => p.confirmation.id === r.confirmationId);
        if (
          !prepared?.consumed ||
          receiptsDuplicate(raw.receipts as JsonObject[], r.confirmationId) ||
          prepared.confirmation.userId !== r.userId ||
          prepared.confirmation.projectId !== r.projectId ||
          prepared.confirmation.targetId !== r.targetId ||
          prepared.confirmation.operation !== r.operation ||
          prepared.scope !== r.scope ||
          JSON.stringify(prepared.facts) !== JSON.stringify(facts(r.facts))
        )
          throw new Error('Receipt binding changed');
        if (r.result !== undefined) object(r.result);
        return { ...r, facts: facts(r.facts) } as unknown as Receipt;
      });
      for (const p of confirmations)
        if (p.consumed && !receipts.some((r) => r.confirmationId === p.confirmation.id))
          throw new Error('Missing receipt');
      const unresolved = new Set<string>();
      for (const r of receipts)
        if (['reserved', 'running', 'uncertain'].includes(r.state)) {
          if (unresolved.has(r.scope)) throw new Error('Duplicate unresolved scope');
          unresolved.add(r.scope);
        }
      this.value = { schema: 'web-external-operations/1', confirmations, receipts };
      let changed = false;
      for (const r of receipts)
        if (r.state === 'reserved' || r.state === 'running') {
          r.state = 'uncertain';
          changed = true;
        }
      if (changed) await atomicJson(this.file, this.value);
      this.initialized = true;
    } catch {
      this.fault = true;
      throw new HttpFailure(503, 'EXTERNAL_STORE_UNAVAILABLE');
    }
  }
  private async save(next: Store): Promise<void> {
    if (this.fault) throw new HttpFailure(503, 'EXTERNAL_STORE_UNAVAILABLE');
    if (Buffer.byteLength(JSON.stringify(next)) > 4 * 1024 * 1024)
      throw new HttpFailure(409, 'EXTERNAL_STORE_LIMIT');
    try {
      await atomicJson(this.file, next);
      this.value = next;
    } catch {
      this.fault = true;
      throw new HttpFailure(503, 'EXTERNAL_STORE_UNAVAILABLE');
    }
  }
  private async checkBinding(actor: ActorContext, bound: Binding | null): Promise<void> {
    admin(actor);
    if (bound) {
      authorize(actor, bound.projectId, 'edit');
      await this.guard(actor, bound);
    }
  }
  private definition(op: ExternalOperation): ExternalDefinition {
    const result = this.definitions.get(op);
    if (!result) throw new HttpFailure(503, 'INTEGRATION_UNAVAILABLE');
    return result;
  }
  async prepare(
    actor: ActorContext,
    op: ExternalOperation,
    targetId: string,
    bound: Binding | null = null,
  ) {
    return this.queue.run(async () => {
      if (this.fault || !this.initialized || !this.accepting)
        throw new HttpFailure(503, 'EXTERNAL_STORE_UNAVAILABLE');
      admin(actor);
      operation(op);
      identifier(targetId);
      bound = binding(bound);
      await this.checkBinding(actor, bound);
      const definition = this.definition(op);
      const inspected = facts(await definition.inspect(actor, targetId));
      const scope = definition.scope(targetId);
      if (!/^[a-zA-Z0-9_:/.-]{1,256}$/.test(scope)) throw new HttpFailure(400, 'INVALID_SCOPE');
      const confirmation: Confirmation = {
        id: randomUUID(),
        userId: actor.userId,
        sessionId: actor.sessionId,
        projectId: bound?.projectId ?? 'global',
        operation: op,
        targetId,
        fingerprint: inspected.fingerprint,
        revision: inspected.revision,
        expiresAt: this.now() + 60_000,
      };
      const next = structuredClone(this.value);
      next.confirmations = next.confirmations.filter(
        (p) => p.consumed || p.confirmation.expiresAt > this.now(),
      );
      if (next.confirmations.length >= 1000) throw new HttpFailure(409, 'EXTERNAL_STORE_LIMIT');
      next.confirmations.push({
        confirmation,
        facts: inspected,
        binding: bound,
        scope,
        consumed: false,
      });
      await this.save(next);
      return {
        confirmationId: confirmation.id,
        expiresAt: confirmation.expiresAt,
        operation: op,
        targetId,
        projectId: confirmation.projectId,
        summary: inspected.summary,
      };
    });
  }
  async confirm(
    actor: ActorContext,
    op: ExternalOperation,
    targetId: string,
    confirmationId: string,
  ) {
    const receipt = await this.queue.run(async () => {
      if (this.fault || !this.initialized || !this.accepting)
        throw new HttpFailure(503, 'EXTERNAL_STORE_UNAVAILABLE');
      admin(actor);
      operation(op);
      identifier(targetId);
      identifier(confirmationId);
      const p = this.value.confirmations.find((item) => item.confirmation.id === confirmationId);
      if (!p) throw new HttpFailure(404, 'NOT_FOUND');
      // Check owner and expiration before consulting the external target.
      assertConfirmation(p.confirmation, {
        ...p.confirmation,
        userId: actor.userId,
        sessionId: actor.sessionId,
        operation: op,
        targetId,
        now: this.now(),
      });
      if (p.consumed) throw new HttpFailure(409, 'CONFIRMATION_CONSUMED');
      await this.checkBinding(actor, p.binding);
      const definition = this.definition(op);
      const current = facts(await definition.inspect(actor, targetId));
      assertConfirmation(p.confirmation, {
        ...p.confirmation,
        userId: actor.userId,
        sessionId: actor.sessionId,
        operation: op,
        targetId,
        ...current,
        now: this.now(),
      });
      if (definition.scope(targetId) !== p.scope) throw new HttpFailure(409, 'TARGET_CHANGED');
      if (
        this.value.receipts.some(
          (r) => r.scope === p.scope && ['reserved', 'running', 'uncertain'].includes(r.state),
        )
      )
        throw new HttpFailure(409, 'EXTERNAL_SCOPE_BUSY');
      if (this.value.receipts.length >= 1000) throw new HttpFailure(409, 'EXTERNAL_STORE_LIMIT');
      const next = structuredClone(this.value);
      next.confirmations.find((item) => item.confirmation.id === confirmationId)!.consumed = true;
      const r: Receipt = {
        id: randomUUID(),
        confirmationId,
        userId: actor.userId,
        projectId: p.confirmation.projectId,
        operation: op,
        targetId,
        scope: p.scope,
        facts: p.facts,
        state: 'reserved',
      };
      next.receipts.push(r);
      await this.save(next); // Every side effect is after this durable reservation.
      return r;
    });
    const promise = this.run(actor, receipt).finally(() => {
      this.active.delete(receipt.id);
    });
    this.active.set(receipt.id, promise);
    void promise.catch(() => {
      /* A persistence fault remains blocking. */
    });
    return this.public(receipt);
  }
  private async run(actor: ActorContext, r: Receipt): Promise<void> {
    try {
      const granted = await this.reauthorize(actor);
      admin(granted);
      const prepared = this.value.confirmations.find(
        (p) => p.confirmation.id === r.confirmationId,
      )!;
      await this.checkBinding(granted, prepared.binding);
      await this.queue.run(async () => {
        if (this.fenced.has(r.id)) return;
        const next = structuredClone(this.value);
        next.receipts.find((item) => item.id === r.id)!.state = 'running';
        await this.save(next);
      });
      if (this.fenced.has(r.id)) return;
      const outcome = await this.definition(r.operation).execute(
        granted,
        r.targetId,
        r.id,
        r.facts,
      );
      await this.finish(r.id, outcome);
    } catch {
      await this.finish(r.id, { state: 'uncertain' });
    }
  }
  private async finish(
    id: string,
    outcome: { state: 'succeeded' | 'failed' | 'uncertain'; result?: JsonObject },
  ): Promise<void> {
    await this.queue.run(async () => {
      if (this.fenced.has(id)) return;
      if (!['succeeded', 'failed', 'uncertain'].includes(outcome.state))
        throw new HttpFailure(400, 'INVALID_OUTCOME');
      if (
        outcome.result !== undefined &&
        Buffer.byteLength(JSON.stringify(object(outcome.result))) > 8192
      )
        throw new HttpFailure(400, 'INVALID_OUTCOME');
      const next = structuredClone(this.value);
      const record = next.receipts.find((r) => r.id === id)!;
      record.state = outcome.state;
      if (outcome.result !== undefined) record.result = outcome.result;
      await this.save(next);
    });
  }
  private public(r: Receipt) {
    return {
      id: r.id,
      projectId: r.projectId,
      operation: r.operation,
      targetId: r.targetId,
      state: r.state,
      summary: r.facts.summary,
      result: r.result ?? null,
    };
  }
  read(actor: ActorContext, id: string) {
    admin(actor);
    identifier(id);
    const r = this.value.receipts.find((item) => item.id === id);
    if (!r || r.userId !== actor.userId) throw new HttpFailure(404, 'NOT_FOUND');
    const prepared = this.value.confirmations.find((p) => p.confirmation.id === r.confirmationId)!;
    if (prepared.binding) authorize(actor, prepared.binding.projectId, 'read');
    return this.public(r);
  }
  async reconcile(actor: ActorContext, id: string) {
    const work = await this.queue.run(async () => {
      this.read(actor, id);
      if (!this.accepting || this.fault) throw new HttpFailure(503, 'EXTERNAL_STORE_UNAVAILABLE');
      const r = this.value.receipts.find((item) => item.id === id)!;
      if (r.state !== 'uncertain' || this.active.has(id) || this.reconciling.has(id))
        throw new HttpFailure(409, 'EXTERNAL_SCOPE_BUSY');
      const reconcile = this.definition(r.operation).reconcile;
      if (!reconcile) throw new HttpFailure(409, 'RECONCILIATION_UNAVAILABLE');
      this.reconciling.add(id);
      return { receipt: structuredClone(r), reconcile };
    });
    const pending = (async () => {
      const granted = await this.reauthorize(actor);
      admin(granted);
      const outcome = await work.reconcile(granted, id, work.receipt.targetId, work.receipt.facts);
      await this.finish(id, outcome);
    })();
    this.active.set(id, pending);
    try {
      await pending;
      return this.read(actor, id);
    } finally {
      this.active.delete(id);
      this.reconciling.delete(id);
    }
  }

  stopAccepting(): void {
    this.accepting = false;
  }
  async drain(): Promise<void> {
    await Promise.allSettled([...this.active.values()]);
    await this.queue.drain();
  }
  async forceUncertain(): Promise<void> {
    this.accepting = false;
    await this.queue.run(async () => {
      const next = structuredClone(this.value);
      for (const r of next.receipts)
        if (['reserved', 'running'].includes(r.state) || this.reconciling.has(r.id)) {
          r.state = 'uncertain';
          this.fenced.add(r.id);
        }
      await this.save(next);
    });
  }
  route = async (ctx: RequestContext): Promise<boolean> => {
    const match =
      /^\/api\/v1\/integrations\/operations\/(prepare|confirm|receipts\/([a-zA-Z0-9_-]+)|reconcile\/([a-zA-Z0-9_-]+))$/.exec(
        ctx.url.pathname,
      );
    if (!match) return false;
    if (match[2] && ctx.request.method === 'GET') {
      json(ctx.response, 200, this.read(ctx.actor, match[2]));
      return true;
    }
    if (ctx.request.method !== 'POST') throw new HttpFailure(405, 'METHOD_NOT_ALLOWED');
    if (match[3]) {
      fields(ctx.input, []);
      json(ctx.response, 200, await this.reconcile(ctx.actor, match[3]));
      return true;
    }
    if (match[1] === 'prepare') {
      fields(ctx.input, ['operation', 'targetId', 'binding']);
      json(
        ctx.response,
        200,
        await this.prepare(
          ctx.actor,
          operation(ctx.input.operation),
          identifier(ctx.input.targetId),
          binding(ctx.input.binding),
        ),
      );
      return true;
    }
    if (match[1] === 'confirm') {
      fields(ctx.input, ['operation', 'targetId', 'confirmationId']);
      json(
        ctx.response,
        202,
        await this.confirm(
          ctx.actor,
          operation(ctx.input.operation),
          identifier(ctx.input.targetId),
          identifier(ctx.input.confirmationId),
        ),
      );
      return true;
    }
    throw new HttpFailure(405, 'METHOD_NOT_ALLOWED');
  };
}
function receiptsDuplicate(rows: JsonObject[], id: unknown): boolean {
  return rows.filter((r) => r.confirmationId === id).length !== 1;
}
