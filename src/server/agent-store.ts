import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { activateAgentSession, rememberAgentSession } from '../domain/agent-state-policy.js';
import type { AgentEvent } from '../domain/agent-runtime-types.js';
import { type ActorContext, authorize, BusinessError } from '../domain/contracts.js';
import type { AgentScope } from '../application/agent-use-cases.js';
import { fields, HttpFailure, identifier, object } from './http.js';
import { atomicJson, SerialQueue } from './storage.js';

interface Conversation {
  id: string;
  userId: string;
  scope: AgentScope;
  cliSessionId: string | null;
  messages: { id: string; role: 'user' | 'assistant'; text: string }[];
}
export interface AgentRecord {
  jobId: string;
  userId: string;
  scope: AgentScope;
  conversationId: string;
  cliSessionId: string | null;
  turnId: string | null;
  taskStage: string | null;
  projectRevision: number | null;
  state: 'running' | 'completed' | 'failed' | 'cancelled' | 'uncertain';
  imported: boolean;
  importError: string | null;
  artifact: { name: string; sha256: string; size: number } | null;
}
interface Store {
  schema: 'web-agent-store/1';
  conversations: Conversation[];
  records: AgentRecord[];
  active: Record<string, { activeSessionId: string | null; sessionIds: string[] }>;
  operations: { key: string; userId: string; scopeKey: string; hash: string; id: string }[];
}
export function agentScopeKey(user: string, scope: AgentScope): string {
  return [user, scope.projectId, scope.stage, scope.provider].join(':');
}
function same(left: AgentScope, right: AgentScope) {
  return (
    left.projectId === right.projectId &&
    left.stage === right.stage &&
    left.provider === right.provider
  );
}
function validateScope(raw: unknown): AgentScope {
  const s = object(raw);
  fields(s, ['projectId', 'stage', 'provider']);
  identifier(s.projectId);
  if (
    !['story', 'models', 'promptPlan', 'caption'].includes(String(s.stage)) ||
    !['codex', 'grok'].includes(String(s.provider))
  )
    throw new HttpFailure(400, 'INVALID_AGENT_STORE');
  return s as unknown as AgentScope;
}
export function validateAgentStore(raw: unknown): Store {
  const s = object(raw);
  fields(s, ['schema', 'conversations', 'records', 'active', 'operations']);
  if (
    s.schema !== 'web-agent-store/1' ||
    !Array.isArray(s.conversations) ||
    !Array.isArray(s.records) ||
    !Array.isArray(s.operations)
  )
    throw new HttpFailure(400, 'INVALID_AGENT_STORE');
  object(s.active);
  if (s.records.length > 10_000 || s.operations.length > 50_000)
    throw new HttpFailure(400, 'INVALID_AGENT_STORE');
  const owners = new Map<string, { userId: string; scope: AgentScope }>();
  const counts = new Map<string, number>();
  const ids = new Set<string>();
  for (const raw of s.conversations) {
    const c = object(raw);
    fields(c, ['id', 'userId', 'scope', 'cliSessionId', 'messages']);
    const id = identifier(c.id);
    identifier(c.userId);
    const scope = validateScope(c.scope);
    owners.set(id, { userId: String(c.userId), scope });
    const scopeKey = agentScopeKey(String(c.userId), scope);
    const count = (counts.get(scopeKey) ?? 0) + 1;
    if (count > 100) throw new HttpFailure(400, 'INVALID_AGENT_STORE');
    counts.set(scopeKey, count);
    if (ids.has(id)) throw new HttpFailure(400, 'INVALID_AGENT_STORE');
    ids.add(id);
    if (c.cliSessionId !== null) identifier(c.cliSessionId);
    if (!Array.isArray(c.messages)) throw new HttpFailure(400, 'INVALID_AGENT_STORE');
    const messages = new Set<string>();
    for (const raw of c.messages) {
      const m = object(raw);
      fields(m, ['id', 'role', 'text']);
      const messageId = identifier(m.id);
      if (messages.has(messageId)) throw new HttpFailure(400, 'INVALID_AGENT_STORE');
      messages.add(messageId);
      if (!['user', 'assistant'].includes(String(m.role)) || typeof m.text !== 'string')
        throw new HttpFailure(400, 'INVALID_AGENT_STORE');
    }
    if (Buffer.byteLength(JSON.stringify(c.messages)) > 1024 * 1024)
      throw new HttpFailure(400, 'INVALID_AGENT_STORE');
  }
  const jobs = new Set<string>();
  for (const raw of s.records) {
    const r = object(raw);
    fields(r, [
      'jobId',
      'userId',
      'scope',
      'conversationId',
      'cliSessionId',
      'turnId',
      'taskStage',
      'projectRevision',
      'state',
      'artifact',
      'imported',
      'importError',
    ]);
    const id = identifier(r.jobId);
    identifier(r.userId);
    validateScope(r.scope);
    if (jobs.has(id) || !ids.has(identifier(r.conversationId)))
      throw new HttpFailure(400, 'INVALID_AGENT_STORE');
    const owner = owners.get(String(r.conversationId))!;
    if (owner.userId !== r.userId || !same(owner.scope, r.scope as unknown as AgentScope))
      throw new HttpFailure(400, 'INVALID_AGENT_STORE');
    jobs.add(id);
    for (const key of ['cliSessionId', 'turnId', 'taskStage'])
      if (r[key] !== null) identifier(r[key]);
    if (
      r.projectRevision !== null &&
      (!Number.isSafeInteger(r.projectRevision) || Number(r.projectRevision) < 0)
    )
      throw new HttpFailure(400, 'INVALID_AGENT_STORE');
    if (!['running', 'completed', 'failed', 'cancelled', 'uncertain'].includes(String(r.state)))
      throw new HttpFailure(400, 'INVALID_AGENT_STORE');
    if (
      typeof r.imported !== 'boolean' ||
      (r.importError !== null &&
        (typeof r.importError !== 'string' || !/^[A-Z_]{1,64}$/.test(r.importError)))
    )
      throw new HttpFailure(400, 'INVALID_AGENT_STORE');
    if (r.artifact !== null) {
      const a = object(r.artifact);
      fields(a, ['name', 'sha256', 'size']);
      if (
        typeof a.name !== 'string' ||
        !/^[a-z_]+\.(json|md)$/.test(a.name) ||
        typeof a.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(a.sha256) ||
        !Number.isSafeInteger(a.size) ||
        Number(a.size) < 1 ||
        Number(a.size) > 10_000_000
      )
        throw new HttpFailure(400, 'INVALID_AGENT_STORE');
    }
  }
  for (const [key, raw] of Object.entries(object(s.active))) {
    const a = object(raw);
    fields(a, ['activeSessionId', 'sessionIds']);
    if (
      !Array.isArray(a.sessionIds) ||
      a.sessionIds.length > 100 ||
      a.sessionIds.some((id) => !ids.has(identifier(id))) ||
      (a.activeSessionId !== null && !a.sessionIds.includes(a.activeSessionId)) ||
      !key ||
      new Set(a.sessionIds).size !== a.sessionIds.length ||
      a.sessionIds.some((id) => {
        const owner = owners.get(String(id));
        return !owner || agentScopeKey(owner.userId, owner.scope) !== key;
      })
    )
      throw new HttpFailure(400, 'INVALID_AGENT_STORE');
  }
  const operations = new Set<string>();
  for (const raw of s.operations) {
    const o = object(raw);
    fields(o, ['key', 'userId', 'scopeKey', 'hash', 'id']);
    identifier(o.key);
    identifier(o.userId);
    if (
      typeof o.scopeKey !== 'string' ||
      typeof o.hash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(o.hash) ||
      !ids.has(identifier(o.id))
    )
      throw new HttpFailure(400, 'INVALID_AGENT_STORE');
    const owner = owners.get(String(o.id));
    const operation = JSON.stringify([o.userId, o.scopeKey, o.key]);
    if (
      !owner ||
      owner.userId !== o.userId ||
      agentScopeKey(owner.userId, owner.scope) !== o.scopeKey ||
      operations.has(operation)
    )
      throw new HttpFailure(400, 'INVALID_AGENT_STORE');
    operations.add(operation);
  }
  return s as unknown as Store;
}
export class AgentStore {
  private state: Store = {
    schema: 'web-agent-store/1',
    conversations: [],
    records: [],
    active: {},
    operations: [],
  };
  private queue = new SerialQueue();
  private fault = false;
  private file: string;
  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'agents.json');
  }
  async initialize() {
    try {
      const raw = await readFile(this.file);
      if (raw.length > 64 * 1024 * 1024) throw new HttpFailure(503, 'AGENT_STORAGE_LIMIT');
      this.state = validateAgentStore(JSON.parse(raw.toString()));
      let changed = false;
      for (const record of this.state.records)
        if (record.state === 'running') {
          record.state = 'uncertain';
          changed = true;
        }
      if (changed) await atomicJson(this.file, this.state);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  private async mutate<T>(work: (next: Store) => T): Promise<T> {
    return this.queue.run(async () => {
      if (this.fault) throw new HttpFailure(409, 'AGENT_STORAGE_UNCERTAIN');
      const next = structuredClone(this.state);
      const result = work(next);
      if (Buffer.byteLength(JSON.stringify(next)) > 64 * 1024 * 1024)
        throw new HttpFailure(503, 'AGENT_STORAGE_LIMIT');
      try {
        await atomicJson(this.file, next);
      } catch (e) {
        this.fault = true;
        throw e;
      }
      this.state = next;
      return structuredClone(result);
    });
  }
  private conversation(state: Store, actor: ActorContext, scope: AgentScope, id: string) {
    authorize(actor, scope.projectId, 'read');
    const c = state.conversations.find(
      (c) => c.id === id && c.userId === actor.userId && same(c.scope, scope),
    );
    if (!c) throw new BusinessError('NOT_FOUND', 'Conversation not found.');
    return c;
  }
  history(actor: ActorContext, scope: AgentScope, id?: string) {
    authorize(actor, scope.projectId, 'read');
    const active = this.state.active[agentScopeKey(actor.userId, scope)]?.activeSessionId ?? null;
    const selected = id ?? active;
    const c = selected ? this.conversation(this.state, actor, scope, selected) : null;
    return {
      activeConversationId: active,
      conversationId: c?.id ?? null,
      messages: structuredClone(c?.messages ?? []),
      conversations: this.state.conversations
        .filter((c) => c.userId === actor.userId && same(c.scope, scope))
        .map((c) => ({
          id: c.id,
          resumable: c.cliSessionId !== null,
          messageCount: c.messages.length,
        })),
    };
  }
  resolve(actor: ActorContext, scope: AgentScope, id: string) {
    return this.conversation(this.state, actor, scope, id).cliSessionId;
  }
  async select(actor: ActorContext, scope: AgentScope, key: string, id: string | null) {
    authorize(actor, scope.projectId, 'execute');
    identifier(key);
    const scopeKey = agentScopeKey(actor.userId, scope),
      hash = createHash('sha256').update(JSON.stringify({ id })).digest('hex');
    return this.mutate((s) => {
      const prior = s.operations.find(
        (o) => o.key === key && o.userId === actor.userId && o.scopeKey === scopeKey,
      );
      if (prior) {
        if (prior.hash !== hash) throw new HttpFailure(409, 'OPERATION_KEY_CONFLICT');
        return { conversationId: prior.id };
      }
      if (s.operations.length >= 50_000) throw new HttpFailure(503, 'AGENT_STORAGE_LIMIT');
      let c: Conversation;
      if (id) {
        c = this.conversation(s, actor, scope, id);
        if (!c.cliSessionId)
          throw new BusinessError('RUNTIME_BUSY', 'Conversation has no resumable session.');
        s.active[scopeKey] = activateAgentSession(s.active[scopeKey], id);
      } else {
        if (
          s.conversations.filter((c) => c.userId === actor.userId && same(c.scope, scope)).length >=
          100
        )
          throw new HttpFailure(503, 'CONVERSATION_CAPACITY');
        c = { id: randomUUID(), userId: actor.userId, scope, cliSessionId: null, messages: [] };
        s.conversations.push(c);
        s.active[scopeKey] = rememberAgentSession(s.active[scopeKey], c.id);
      }
      s.operations.push({ key, userId: actor.userId, scopeKey, hash, id: c.id });
      return { conversationId: c.id };
    });
  }
  async begin(
    actor: ActorContext,
    scope: AgentScope,
    jobId: string,
    id: string | null,
    text: string,
    taskStage: string | null,
    revision: number | null,
  ) {
    authorize(actor, scope.projectId, 'execute');
    identifier(jobId);
    return this.mutate((s) => {
      const prior = s.records.find((r) => r.jobId === jobId);
      if (prior) {
        if (prior.userId !== actor.userId || !same(prior.scope, scope))
          throw new BusinessError('FORBIDDEN', 'Job scope differs.');
        return prior;
      }
      let c: Conversation;
      if (id) c = this.conversation(s, actor, scope, id);
      else {
        if (
          s.conversations.filter((c) => c.userId === actor.userId && same(c.scope, scope)).length >=
          100
        )
          throw new HttpFailure(503, 'CONVERSATION_CAPACITY');
        c = { id: randomUUID(), userId: actor.userId, scope, cliSessionId: null, messages: [] };
        s.conversations.push(c);
        const key = agentScopeKey(actor.userId, scope);
        s.active[key] = rememberAgentSession(s.active[key], c.id);
      }
      if (s.records.length >= 10_000 || Buffer.byteLength(text) > 750_000)
        throw new HttpFailure(503, 'AGENT_STORAGE_LIMIT');
      c.messages.push({ id: jobId + '-user', role: 'user', text });
      c.messages.push({ id: jobId + '-assistant', role: 'assistant', text: '' });
      if (Buffer.byteLength(JSON.stringify(c.messages)) > 1024 * 1024)
        throw new HttpFailure(503, 'CONVERSATION_CAPACITY');
      const record: AgentRecord = {
        jobId,
        userId: actor.userId,
        scope,
        conversationId: c.id,
        cliSessionId: c.cliSessionId,
        turnId: null,
        taskStage,
        projectRevision: revision,
        state: 'running',
        artifact: null,
        imported: false,
        importError: null,
      };
      s.records.push(record);
      return record;
    });
  }
  record(actor: ActorContext, scope: AgentScope, jobId: string) {
    authorize(actor, scope.projectId, 'read');
    const r = this.state.records.find(
      (r) => r.jobId === jobId && r.userId === actor.userId && same(r.scope, scope),
    );
    if (!r) throw new BusinessError('NOT_FOUND', 'Agent job not found.');
    return structuredClone(r);
  }
  async update(actor: ActorContext, scope: AgentScope, jobId: string, event: AgentEvent) {
    return this.mutate((s) => {
      const r = s.records.find(
        (r) => r.jobId === jobId && r.userId === actor.userId && same(r.scope, scope),
      );
      if (!r || r.state !== 'running')
        throw new BusinessError('RUNTIME_UNCERTAIN', 'Late agent event.');
      const c = this.conversation(s, actor, scope, r.conversationId);
      if (event.type === 'session.started') {
        identifier(event.sessionId);
        if (c.cliSessionId && c.cliSessionId !== event.sessionId)
          throw new BusinessError('RUNTIME_UNCERTAIN', 'CLI session mismatch.');
        c.cliSessionId = r.cliSessionId = event.sessionId;
      } else if (event.type === 'turn.started') {
        identifier(event.turnId);
        if (r.turnId && r.turnId !== event.turnId)
          throw new BusinessError('RUNTIME_UNCERTAIN', 'CLI turn mismatch.');
        r.turnId = event.turnId;
      } else if (event.type === 'message.delta' || event.type === 'message.completed') {
        const m = c.messages.find((m) => m.id === jobId + '-assistant')!;
        m.text = event.type === 'message.delta' ? m.text + event.text : event.text;
        if (Buffer.byteLength(JSON.stringify(c.messages)) > 1024 * 1024)
          throw new HttpFailure(503, 'CONVERSATION_CAPACITY');
      }
    });
  }
  publicRecords(actor: ActorContext, scope: AgentScope) {
    authorize(actor, scope.projectId, 'read');
    return this.state.records
      .filter((r) => r.userId === actor.userId && same(r.scope, scope))
      .slice(-100)
      .map((r) => ({
        jobId: r.jobId,
        conversationId: r.conversationId,
        taskStage: r.taskStage,
        state: r.state,
        artifact: r.artifact,
        imported: r.imported,
        importError: r.importError,
      }));
  }
  reconciliationRecord(id: string) {
    const record = this.state.records.find((r) => r.jobId === id);
    return record ? structuredClone(record) : null;
  }
  async abandonRecord(actor: ActorContext, scope: AgentScope, id: string) {
    return this.mutate((s) => {
      const record = s.records.find(
        (r) => r.jobId === id && r.userId === actor.userId && same(r.scope, scope),
      );
      if (!record) throw new BusinessError('NOT_FOUND', 'Agent record unavailable.');
      record.state = 'cancelled';
      record.artifact = null;
      record.imported = false;
      record.importError = null;
    });
  }
  completion(id: string) {
    const r = this.state.records.find((r) => r.jobId === id);
    return r?.importError
      ? 'failed'
      : r?.state === 'completed' && r.artifact && !r.imported
        ? 'uncertain'
        : (r?.state ?? 'uncertain');
  }
  async importResult(actor: ActorContext, scope: AgentScope, id: string, error: string | null) {
    return this.mutate((s) => {
      const r = s.records.find(
        (r) => r.jobId === id && r.userId === actor.userId && same(r.scope, scope),
      );
      if (!r || r.state !== 'completed' || !r.artifact)
        throw new HttpFailure(409, 'AGENT_ARTIFACT_UNAVAILABLE');
      r.imported = error === null;
      r.importError = error;
    });
  }
  async finish(
    actor: ActorContext,
    scope: AgentScope,
    jobId: string,
    state: AgentRecord['state'],
    artifact: AgentRecord['artifact'] = null,
  ) {
    return this.mutate((s) => {
      const r = s.records.find(
        (r) => r.jobId === jobId && r.userId === actor.userId && same(r.scope, scope),
      );
      if (!r) throw new BusinessError('NOT_FOUND', 'Agent job not found.');
      if (r.state !== 'running' && r.state !== state)
        throw new BusinessError('RUNTIME_UNCERTAIN', 'Agent result fenced.');
      r.state = state;
      r.artifact = artifact;
      return r;
    });
  }
}
