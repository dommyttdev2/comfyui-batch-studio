import { createHash } from 'node:crypto';
import { assessPreflight } from '../application/preflight.js';
import type { CatalogRepository, ProjectState } from '../application/project-ports.js';
import type { ModelAvailabilityRow, ModelsArtifact } from '../domain/artifact-types.js';
import { assessModelAvailability, modelAvailabilityState } from '../domain/availability-policy.js';
import { parseArtifact, validateCanonicalArtifact } from '../domain/canonical-artifact.js';
import { type ActorContext, authorize, type MutationCommand } from '../domain/contracts.js';
import { joinR2ModelKey, requiredRemoteModels } from '../domain/model-placement.js';
import { resourceBindings } from '../domain/resource-bindings.js';
import { canonical } from '../domain/workflow-graph.js';
import type { FileResources } from './file-resources.js';
import { fields, HttpFailure, identifier, json, type RequestContext } from './http.js';
import type { IntegrationSettings } from './integration-settings.js';
import type { ProjectApi } from './project-api.js';
import { publicProject } from './project-api.js';
import type { R2Service } from './r2-service.js';
import type { SshResources } from './ssh-resources.js';
import type { WorkflowApi } from './workflow-api.js';

const hash = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
export class ProjectResources {
  constructor(
    private projectApi: ProjectApi,
    private workflow: WorkflowApi,
    private catalogs: CatalogRepository,
    private files: FileResources,
    private r2: R2Service,
    private settings: IntegrationSettings,
    private reauthorize: (actor: ActorContext) => Promise<ActorContext>,
    private ssh: Pick<SshResources, 'endpoint'>,
  ) {}
  private async observe(actor: ActorContext, p: ProjectState) {
    authorize(actor, p.id, 'read');
    if (!p.resourceBindings) throw new HttpFailure(409, 'RESOURCE_BINDINGS_REQUIRED');
    const bindings = resourceBindings(p.resourceBindings),
      artifact = p.artifacts.models,
      models = artifact ? (parseArtifact(artifact.content) as ModelsArtifact) : null,
      catalog = await this.catalogs.read(p.id);
    if (
      !artifact ||
      artifact.status !== 'confirmed' ||
      !validateCanonicalArtifact('models', artifact.content, null, catalog).valid ||
      !models
    )
      throw new HttpFailure(409, 'MODELS_NOT_CONFIRMED');
    const roots = this.files.roots(actor, p.id),
      root =
        bindings.localRootId === null ? null : roots.find((r) => r.id === bindings.localRootId);
    if (bindings.localRootId && !root) throw new HttpFailure(403, 'RESOURCE_NOT_REGISTERED');
    const rows: ModelAvailabilityRow[] = [],
      evidence = [];
    const generation = bindings.r2Bucket ? this.settings.resolve('r2').fingerprint : null,
      index = bindings.r2Bucket ? this.r2.indexedObjects(bindings.r2Bucket) : [];
    for (const model of requiredRemoteModels(models)) {
      const local = root
          ? await this.files.observe(actor, p.id, root.id, model.relativePath)
          : null,
        key = joinR2ModelKey(bindings.r2Prefix, model.relativePath),
        indexed = index.find((row) => row.key === key);
      let remote: { key: string; size: number; etag: string } | null = null;
      if (indexed) {
        try {
          const head = await this.r2.port.send('HeadObject', {
            Bucket: bindings.r2Bucket,
            Key: key,
          });
          if (head.ContentLength !== indexed.size || head.ETag !== indexed.etag)
            throw new HttpFailure(409, 'R2_INDEX_CHANGED');
          remote = { key, size: head.ContentLength, etag: head.ETag };
        } catch (error) {
          if ((error as any)?.$metadata?.httpStatusCode === 404)
            throw new HttpFailure(409, 'R2_INDEX_CHANGED');
          throw error;
        }
      }
      rows.push({
        ref: model.ref,
        fileName: model.fileName,
        kind: model.kind,
        local: !!local,
        r2: !!remote,
        state: modelAvailabilityState(bindings.executionTarget, !!local, !!remote),
      });
      evidence.push({ ref: model.ref, relativePath: model.relativePath, local, remote });
    }
    if (generation !== null && generation !== this.settings.resolve('r2').fingerprint)
      throw new HttpFailure(409, 'SETTINGS_CHANGED');
    const remote =
      bindings.executionTarget === 'remote' && bindings.remoteInstanceId !== null
        ? await this.ssh.endpoint(actor, bindings.remoteInstanceId)
        : null;
    return {
      remote,
      bindings,
      catalog,
      rows,
      evidence,
      sourceGeneration: generation,
      localRoot: root?.id ?? '',
      rootExists: !!root,
    };
  }
  async snapshot(actor: ActorContext, projectId: string, preflight = false) {
    authorize(actor, projectId, 'read');
    const p = await this.projectApi.projects.read(actor, { projectId });
    const first = await this.observe(actor, p);
    let result: Awaited<ReturnType<typeof assessPreflight>> | undefined;
    if (preflight) {
      result = await assessPreflight({
        project: async () => p,
        catalog: async () => first.catalog,
        availability: async () => ({
          rows: first.rows,
          executionTarget: first.bindings.executionTarget,
          localModelsRoot: first.localRoot,
          localRootExists: first.rootExists,
        }),
        hash,
        remoteTarget: async () => ({
          provider: 'vastai',
          instanceId: first.bindings.remoteInstanceId ?? undefined,
          configured: this.settings.providerState('vast') === 'ready',
          installPath: first.remote?.comfyUiDirectory ?? '',
          githubPatConfigured: false,
          sshPrivateKeyPath: first.remote?.keyId ?? null,
          sshPublicKeyPath: first.remote?.keyId ?? null,
          sshPrivateKeyExists: !!first.remote,
          sshPublicKeyExists: !!first.remote,
          sshKeyPairValid: !!first.remote,
          instance: first.remote
            ? {
                id: first.remote.instanceId,
                status: 'running',
                sshHost: first.remote.host,
                sshPort: first.remote.port,
              }
            : null,
          lookupError: null,
        }),
      });
      const status = await this.workflow.workflows.status(actor, { projectId });
      if (
        status !== 'current' &&
        !result.blocking.some((i) => i.code === 'WORKFLOW_RESOURCE_STALE')
      ) {
        const issue = {
          severity: 'error' as const,
          code: 'WORKFLOW_RESOURCE_STALE',
          message: 'Current template/manifest provenance is required.',
        };
        result.blocking.push(issue);
        result.sections.push({ name: 'Workflow resources', valid: false, issues: [issue] });
        result.state = 'BLOCKED';
      }
    }
    const currentActor = await this.reauthorize(actor);
    authorize(currentActor, projectId, 'read');
    const next = await this.projectApi.projects.read(currentActor, { projectId });
    if (next.revision !== p.revision) throw new HttpFailure(409, 'REVISION_CONFLICT');
    const second = await this.observe(currentActor, next);
    if (hash(first) !== hash(second)) throw new HttpFailure(409, 'RESOURCE_SNAPSHOT_CHANGED');
    const identity = hash({
      projectId,
      revision: p.revision,
      artifacts: p.artifacts,
      observation: first,
    });
    const availability = assessModelAvailability(
      first.rows,
      first.bindings.executionTarget,
      first.localRoot,
      first.rootExists,
    );
    return {
      projectId,
      revision: p.revision,
      snapshotId: identity,
      bindings: first.bindings,
      availability,
      evidence: first.evidence,
      remoteTarget: first.remote,
      ...(preflight
        ? { preflight: result, executionReady: false, runtimeRequirement: 'P6_REQUIRED' }
        : {}),
    };
  }
  async route(ctx: RequestContext) {
    const match =
      /^\/api\/v1\/projects\/([a-zA-Z0-9_-]+)\/(resource-roots|availability|preflight|commands\/configure-resources)$/.exec(
        ctx.url.pathname,
      );
    if (!match) return false;
    const projectId = identifier(match[1]);
    if (ctx.url.searchParams.size) throw new HttpFailure(400, 'INVALID_INPUT');
    if (ctx.request.method === 'GET') {
      authorize(ctx.actor, projectId, 'read');
      if (match[2] === 'resource-roots')
        json(ctx.response, 200, { roots: this.files.roots(ctx.actor, projectId) });
      else if (match[2] === 'availability' || match[2] === 'preflight')
        json(
          ctx.response,
          200,
          await this.snapshot(ctx.actor, projectId, match[2] === 'preflight'),
        );
      else throw new HttpFailure(404, 'NOT_FOUND');
      return true;
    }
    if (ctx.request.method !== 'POST' || match[2] !== 'commands/configure-resources')
      throw new HttpFailure(404, 'NOT_FOUND');
    fields(ctx.input, ['bindings', 'expectedRevision', 'leaseId']);
    const bindings = resourceBindings(ctx.input.bindings);
    if (
      bindings.localRootId &&
      !this.files.roots(ctx.actor, projectId).some((r) => r.id === bindings.localRootId)
    )
      throw new HttpFailure(403, 'RESOURCE_NOT_REGISTERED');
    if (bindings.r2Bucket) this.settings.resolve('r2');
    const command = { ...ctx.input, bindings, projectId } as unknown as MutationCommand & {
      bindings: unknown;
    };
    const receipt = await this.projectApi.repository.execute(
      ctx.actor,
      projectId,
      identifier(ctx.request.headers['idempotency-key']),
      { action: 'configure-resources', ...ctx.input },
      () => this.projectApi.projects.configureResources(ctx.actor, command),
    );
    json(ctx.response, 200, {
      project: publicProject(ctx.actor, receipt.project),
      eventDelivery: receipt.eventDelivery,
    });
    return true;
  }
}
