import { createHash, randomUUID } from 'node:crypto';
import type { CatalogRepository, ProjectState } from '../application/project-ports.js';
import { confirmedProjectReset } from '../application/project-reset-confirmation.js';
import { ProjectUseCases } from '../application/project-use-cases.js';
import { downstream } from '../domain/artifact-policy.js';
import type { ActorContext, ArtifactKey, MutationCommand } from '../domain/contracts.js';
import { authorize } from '../domain/contracts.js';
import { fields, HttpFailure, identifier, json, type RequestContext } from './http.js';
import type { DiskProjects } from './project-repository.js';
export function publicProject(actor: ActorContext, p: ProjectState) {
  const owned =
    !!p.lease && p.lease.userId === actor.userId && p.lease.sessionId === actor.sessionId;
  return {
    id: p.id,
    schema: p.schema,
    revision: p.revision,
    artifacts: p.artifacts,
    drafts: p.drafts,
    lease: p.lease
      ? {
          ownedByCurrentSession: owned,
          expiresAt: p.lease.expiresAt,
          ...(owned ? { leaseId: p.lease.id } : {}),
        }
      : null,
    resourceBindings: p.resourceBindings ?? null,
    runSummaries: p.runs.map((r) => ({ id: r.id, state: r.lifecycle })),
  };
}
export class ProjectApi {
  readonly projects: ProjectUseCases;
  constructor(
    readonly repository: DiskProjects,
    catalogs: CatalogRepository = { read: async () => null },
  ) {
    this.projects = new ProjectUseCases(
      repository,
      catalogs,
      { now: Date.now },
      { next: randomUUID },
      { text: (v) => createHash('sha256').update(v).digest('hex') },
    );
  }
  async route(ctx: RequestContext): Promise<boolean> {
    const { actor, input, request, response, url } = ctx;
    const match = /^\/api\/v1\/projects\/([a-zA-Z0-9_-]+)(?:\/commands\/([a-z-]+))?$/.exec(
      url.pathname,
    );
    if (!match) return false;
    const projectId = identifier(match[1]);
    if (request.method === 'GET' && !match[2]) {
      const p = await this.projects.read(actor, { projectId });
      json(response, 200, { project: publicProject(actor, p) });
      return true;
    }
    if (request.method !== 'POST' || !match[2]) return false;
    const action = match[2];
    const shape: Record<string, string[]> = {
      'acquire-lease': [],
      'renew-lease': [],
      'release-lease': [],
      'begin-edit': ['key'],
      'save-draft': ['key', 'content'],
      'confirm-artifact': ['key'],
      'reset-artifact': ['key', 'confirmationId'],
      'reset-stage': ['scope', 'confirmationId'],
      'prepare-reset': ['target', 'stage'],
      'configure-models': ['family', 'base', 'textEncoder', 'vae'],
      'replace-models': ['expected', 'next'],
      'import-loras': ['payload', 'stage'],
      'patch-prompt-plan': ['raw'],
    };
    if (!shape[action]) return false;
    fields(
      input,
      action === 'acquire-lease' ? [] : ['expectedRevision', 'leaseId', ...shape[action]],
    );
    authorize(actor, projectId, 'edit');
    const command = { ...input, projectId } as unknown as MutationCommand;
    if (
      ['begin-edit', 'save-draft', 'confirm-artifact', 'reset-artifact'].includes(action) &&
      !Object.hasOwn(downstream, String(input.key))
    )
      throw new HttpFailure(400, 'INVALID_INPUT');
    if (action === 'prepare-reset') {
      const target = identifier(input.target);
      if (
        typeof input.stage !== 'boolean' ||
        (input.stage
          ? !['story', 'base-models', 'models', 'models-fix', 'prompt-plan', 'workflow'].includes(
              target,
            )
          : !Object.hasOwn(downstream, target))
      )
        throw new HttpFailure(400, 'INVALID_INPUT');
      json(response, 200, {
        confirmation: await this.repository.prepare(actor, projectId, {
          expectedRevision: command.expectedRevision,
          leaseId: command.leaseId,
          target,
          stage: input.stage,
        }),
      });
      return true;
    }
    const key = identifier(request.headers['idempotency-key']);
    const receipt = await this.repository.execute(
      actor,
      projectId,
      key,
      { action, ...input },
      async () => {
        switch (action) {
          case 'acquire-lease':
            return this.projects.acquireLease(actor, { projectId });
          case 'renew-lease':
            return this.projects.renewLease(actor, command);
          case 'release-lease':
            return this.projects.releaseLease(actor, command);
          case 'begin-edit':
            return this.projects.beginEdit(actor, { ...command, key: input.key as ArtifactKey });
          case 'save-draft':
            return this.projects.saveDraft(actor, {
              ...command,
              key: input.key as ArtifactKey,
              content: input.content as string,
            });
          case 'confirm-artifact':
            return this.projects.confirm(actor, { ...command, key: input.key as ArtifactKey });
          case 'reset-artifact':
          case 'reset-stage':
            return confirmedProjectReset(
              actor,
              { ...command, confirmationId: identifier(input.confirmationId) },
              String(action === 'reset-stage' ? input.scope : input.key) as ArtifactKey,
              action === 'reset-stage',
              await this.projects.read(actor, { projectId }),
              { now: Date.now },
              this.repository,
              this.projects,
            );
          case 'configure-models':
            return this.projects.configureModels(
              actor,
              command as Parameters<ProjectUseCases['configureModels']>[1],
            );
          case 'import-loras':
            return this.projects.importLoras(
              actor,
              command as Parameters<ProjectUseCases['importLoras']>[1],
            );
          case 'replace-models':
            return this.projects.replaceModels(
              actor,
              command as Parameters<ProjectUseCases['replaceModels']>[1],
            );
          case 'patch-prompt-plan':
            return this.projects.patchPromptPlan(
              actor,
              command as Parameters<ProjectUseCases['patchPromptPlan']>[1],
            );
          default:
            throw new HttpFailure(501, 'NOT_IMPLEMENTED');
        }
      },
    );
    json(response, 200, {
      project: publicProject(actor, receipt.project),
      eventDelivery: receipt.eventDelivery,
    });
    return true;
  }
}
