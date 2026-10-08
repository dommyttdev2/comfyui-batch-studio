import { AgentPreferencesUseCases } from '../application/agent-preferences-use-cases.js';
import type { AgentRuntime } from './agent-runtime.js';
import type { AgentArtifacts } from './agent-artifacts.js';
import { type ActorContext, authorize } from '../domain/contracts.js';
import { contextStageForTask, agentTaskContexts } from '../domain/agent-stage-policy.js';
import type { AgentScope } from '../application/agent-use-cases.js';
import type { TaskStage } from '../application/agent-task-planning.js';
import { fields, HttpFailure, identifier, json, type RequestContext } from './http.js';
import { publicProject } from './project-api.js';
export class AgentApi {
  constructor(
    private runtime: AgentRuntime,
    private artifacts?: AgentArtifacts,
  ) {}
  async route(ctx: RequestContext): Promise<boolean> {
    const match =
      /^\/api\/v1\/projects\/([a-zA-Z0-9_-]+)\/agents\/(story|models|promptPlan|caption)\/(codex|grok)(?:\/(.*))?$/.exec(
        ctx.url.pathname,
      );
    if (!match) return false;
    const scope: AgentScope = {
      projectId: match[1],
      stage: match[2] as AgentScope['stage'],
      provider: match[3] as AgentScope['provider'],
    };
    const action = match[4] ?? 'history';
    authorize(ctx.actor, scope.projectId, 'read');
    if (ctx.request.method === 'GET') {
      if (action === 'availability') {
        json(ctx.response, 200, await this.runtime.availability(scope));
        return true;
      }
      if (action === 'models') {
        try {
          json(ctx.response, 200, await this.runtime.models(scope));
        } catch {
          throw new HttpFailure(503, 'DEPENDENCY_UNAVAILABLE');
        }
        return true;
      }
      if (action === 'preferences') {
        json(ctx.response, 200, await this.runtime.preferences.read(ctx.actor, scope));
        return true;
      }
      if (action === 'history') {
        for (const key of ctx.url.searchParams.keys())
          if (key !== 'conversationId') throw new HttpFailure(400, 'INVALID_INPUT');
        const id = ctx.url.searchParams.get('conversationId');
        json(ctx.response, 200, {
          ...this.runtime.store.history(ctx.actor, scope, id ? identifier(id) : undefined),
          records: this.runtime.store.publicRecords(ctx.actor, scope),
        });
        return true;
      }
    }
    if (ctx.request.method !== 'POST') throw new HttpFailure(404, 'NOT_FOUND');
    const key = identifier(ctx.request.headers['idempotency-key']),
      actor: ActorContext = { ...ctx.actor, requestId: key };
    const { input } = ctx;
    if (action === 'conversations/new' || action === 'conversations/restore') {
      fields(input, action.endsWith('restore') ? ['conversationId'] : []);
      const result = await this.runtime.jobs.idleAgentScope(
        actor,
        scope.projectId,
        scope.stage,
        scope.provider,
        () =>
          this.runtime.store.select(
            actor,
            scope,
            key,
            action.endsWith('restore') ? identifier(input.conversationId) : null,
          ),
      );
      json(ctx.response, 200, result);
      return true;
    }
    if (action === 'preferences') {
      authorize(actor, scope.projectId, 'edit');
      fields(input, ['expectedRevision', 'leaseId', 'model', 'reasoningEffort']);
      if (
        input.model !== null &&
        (typeof input.model !== 'string' || !input.model.trim() || input.model.length > 256)
      )
        throw new HttpFailure(400, 'INVALID_INPUT');
      if (
        input.reasoningEffort != null &&
        (typeof input.reasoningEffort !== 'string' ||
          !input.reasoningEffort.trim() ||
          input.reasoningEffort.length > 64)
      )
        throw new HttpFailure(400, 'INVALID_INPUT');
      const capabilities = await this.runtime.capabilities(scope);
      const preferences = new AgentPreferencesUseCases(
        this.runtime.projects,
        { now: Date.now },
        { modelCapabilities: async () => capabilities },
      );
      const command = {
        ...scope,
        expectedRevision: input.expectedRevision as number,
        leaseId: identifier(input.leaseId),
        change: {
          kind: 'model' as const,
          value: {
            model: input.model as string | null,
            reasoningEffort: input.reasoningEffort as string | null | undefined,
          },
        },
      };
      const result = await this.runtime.jobs.idleAgentScope(
        actor,
        scope.projectId,
        scope.stage,
        scope.provider,
        () =>
          this.runtime.projects.execute(actor, scope.projectId, key, input, () =>
            preferences.update(actor, command),
          ),
      );
      json(ctx.response, 200, {
        project: publicProject(actor, result.project),
        eventDelivery: result.eventDelivery,
      });
      return true;
    }
    const use = this.runtime.bind(actor);
    if (action === 'chat') {
      fields(input, ['text', 'conversationId']);
      const job = await use.chat.start(actor, {
        ...scope,
        kind: 'chat',
        text: input.text as string,
        sessionId: input.conversationId === null ? null : identifier(input.conversationId),
      });
      json(ctx.response, 202, { job: this.runtime.jobs.get(actor, job.id) });
      return true;
    }
    if (action === 'task') {
      fields(input, ['stage', 'extra']);
      const stage = String(input.stage) as TaskStage;
      if (!Object.values(agentTaskContexts).flat().includes(stage))
        throw new HttpFailure(400, 'INVALID_INPUT');
      const context = contextStageForTask(stage);
      if ((context === 'prompt-plan' ? 'promptPlan' : context) !== scope.stage)
        throw new HttpFailure(400, 'AGENT_SCOPE_MISMATCH');
      const job = await use.tasks.start(actor, {
        projectId: scope.projectId,
        provider: scope.provider,
        stage,
        extra: input.extra as string | undefined,
      });
      json(ctx.response, 202, { job: this.runtime.jobs.get(actor, job.id) });
      return true;
    }
    const job = /^jobs\/([a-zA-Z0-9_-]+)\/(stop|reconcile|import|abandon)$/.exec(action);
    if (job) {
      const existing = this.runtime.jobs.get(actor, job[1]);
      if (
        existing.kind !== 'agent' ||
        existing.projectId !== scope.projectId ||
        existing.stage !== scope.stage ||
        existing.provider !== scope.provider
      )
        throw new HttpFailure(403, 'FORBIDDEN');
      if (job[2] === 'stop') {
        fields(input, []);
        await use.chat.stop(actor, { ...scope, jobId: job[1] });
        json(ctx.response, 202, { job: this.runtime.jobs.get(actor, job[1]) });
        return true;
      }
      this.runtime.jobs.assertOwner(actor, job[1]);
      if (job[2] === 'reconcile') {
        fields(input, []);
        json(ctx.response, 200, { job: await this.runtime.jobs.reconcile(actor, job[1]) });
        return true;
      }
      if (job[2] === 'abandon') {
        fields(input, ['acknowledge']);
        if (input.acknowledge !== 'discard-unknown-result')
          throw new HttpFailure(400, 'ACKNOWLEDGEMENT_REQUIRED');
        json(ctx.response, 200, { job: await this.runtime.abandon(actor, scope, job[1]) });
        return true;
      }
      fields(input, []);
      if (!this.artifacts) throw new HttpFailure(503, 'DEPENDENCY_UNAVAILABLE');
      if (['reserved', 'running', 'cancelling', 'uncertain'].includes(existing.state))
        throw new HttpFailure(409, 'AGENT_JOB_UNFINISHED');
      const result = await this.artifacts.ingest(actor, scope, job[1]);
      json(ctx.response, 200, {
        project: publicProject(actor, result.project),
        eventDelivery: result.eventDelivery,
      });
      return true;
    }
    throw new HttpFailure(404, 'NOT_FOUND');
  }
}
