import type { ArtifactStage } from '../domain/agent-artifact-policy.js';
import { assertConfirmable, downstream } from '../domain/artifact-policy.js';
import type {
  CaptionContent,
  ModelFamily,
  ModelSelectionBase,
  ModelsArtifact,
  TextEncoderSelection,
  VaeSelection,
} from '../domain/artifact-types.js';
import {
  changesGenerationInputs,
  parseArtifact,
  validateCanonicalArtifact,
} from '../domain/canonical-artifact.js';
import { importCaptionResponse, updatePixivTitle } from '../domain/caption-import-policy.js';
import {
  type ActorContext,
  type ArtifactKey,
  authorize,
  BusinessError,
  type Command,
  type MutationCommand,
  requireId,
} from '../domain/contracts.js';
import { leaveProject } from '../domain/execution-policy.js';
import { mergeLoraImport, splitModelDraft } from '../domain/model-draft-policy.js';
import { configureBaseModels, replaceModelSelection } from '../domain/model-editing.js';
import {
  type ModelResetScope,
  modelResetPlan,
  restoreModelSelection,
} from '../domain/model-reset-policy.js';
import { applyPromptPlanDifference } from '../domain/prompt-plan-patch-policy.js';
import { utf8Size } from '../domain/text-policy.js';
import { assertCurrentProject, assertMutation, nextRevision } from './project-access.js';
import {
  type CatalogRepository,
  type Clock,
  event,
  type IdSource,
  type ProjectRepository,
  type ProjectState,
} from './project-ports.js';
import type { Digest } from './workflow-use-cases.js';
export class ProjectUseCases {
  constructor(
    private readonly repository: ProjectRepository,
    private readonly catalogs: CatalogRepository,
    private readonly clock: Clock,
    private readonly ids: IdSource,
    private readonly digest?: Digest,
  ) {}
  async read(actor: ActorContext, command: Command): Promise<ProjectState> {
    authorize(actor, command.projectId, 'read');
    return this.repository.transaction(command.projectId, async (tx) => {
      const project = await tx.load();
      assertCurrentProject(project, command.projectId);
      return project;
    });
  }
  leave(actor: ActorContext, command: Command) {
    authorize(actor, command.projectId, 'read');
    return leaveProject();
  }
  async acquireLease(actor: ActorContext, command: Command) {
    authorize(actor, command.projectId, 'edit');
    return this.repository.transaction(command.projectId, async (tx) => {
      const project = await tx.load();
      assertCurrentProject(project, command.projectId);
      if (
        project.lease &&
        project.lease.expiresAt > this.clock.now() &&
        (project.lease.userId !== actor.userId || project.lease.sessionId !== actor.sessionId)
      )
        throw new BusinessError('LEASE_REQUIRED', 'Another session owns the editing lease.');
      const before = project.revision;
      project.lease = {
        id: this.ids.next(),
        userId: actor.userId,
        sessionId: actor.sessionId,
        expiresAt: this.clock.now() + 60_000,
      };
      project.revision = nextRevision(project);
      await tx.commit(before, project, event(actor, project, 'project.changed', 'lease'));
      return project;
    });
  }
  async beginEdit(actor: ActorContext, command: MutationCommand & { key: ArtifactKey }) {
    return this.mutate(
      actor,
      command,
      async (project) => {
        const current = project.artifacts[command.key];
        if (!current) throw new BusinessError('NOT_FOUND', 'Confirmed artifact does not exist.');
        if (project.drafts[command.key])
          throw new BusinessError('REVISION_CONFLICT', 'A draft already exists.');
        project.drafts[command.key] = {
          ...current,
          content:
            command.key === 'models' && current.modelPromptFallbacks?.length
              ? JSON.stringify({
                  ...(parseArtifact(current.content) as ModelsArtifact),
                  promptFallbacks: current.modelPromptFallbacks,
                })
              : current.content,
          status: 'draft',
        };
      },
      command.key,
    );
  }
  async saveDraft(
    actor: ActorContext,
    command: MutationCommand & { key: ArtifactKey; content: string },
  ) {
    return this.mutate(
      actor,
      command,
      async (project) => {
        if (!Object.hasOwn(downstream, command.key) || typeof command.content !== 'string')
          throw new BusinessError('INVALID_INPUT', 'Unknown artifact or invalid content.');
        const validation = await this.validate(command.key, command.content, project);
        project.drafts[command.key] = {
          key: command.key,
          content: command.content,
          status: 'draft',
          validation,
        };
      },
      command.key,
    );
  }
  async configureModels(
    actor: ActorContext,
    command: MutationCommand & {
      family: ModelFamily;
      base: ModelSelectionBase;
      textEncoder?: TextEncoderSelection;
      vae?: VaeSelection;
    },
  ) {
    return this.mutate(
      actor,
      command,
      async (project) => {
        const catalog = await this.catalogs.read(project.id);
        const models = configureBaseModels({ ...command, catalog });
        const content = JSON.stringify(models);
        const validation = await this.validate('models', content, project);
        if (!validation.valid)
          throw new BusinessError(
            'INVALID_ARTIFACT',
            'Base selection does not match the current catalog.',
          );
        project.drafts.models = { key: 'models', content, status: 'draft', validation };
      },
      'models',
    );
  }
  async replaceModels(
    actor: ActorContext,
    command: MutationCommand & { expected: ModelSelectionBase; next: ModelSelectionBase },
  ) {
    return this.mutate(
      actor,
      command,
      async (project) => {
        const source = project.drafts.models ?? project.artifacts.models;
        if (!source || source.status === 'stale')
          throw new BusinessError('INVALID_ARTIFACT', 'Current model selection is required.');
        const models = parseArtifact(source.content) as ModelsArtifact | null;
        if (!models || models.schemaVersion !== 5)
          throw new BusinessError('INVALID_ARTIFACT', 'Current model schema is required.');
        const updated = replaceModelSelection(models, command.expected, command.next);
        const content = JSON.stringify({
          ...updated,
          ...(source.modelPromptFallbacks?.length
            ? { promptFallbacks: source.modelPromptFallbacks }
            : {}),
        });
        const validation = await this.validate('models', content, project);
        if (!validation.valid)
          throw new BusinessError(
            'INVALID_ARTIFACT',
            'Replacement does not match the current catalog.',
          );
        project.drafts.models = { key: 'models', content, status: 'draft', validation };
      },
      'models',
    );
  }
  async patchPromptPlan(actor: ActorContext, command: MutationCommand & { raw: string }) {
    return this.mutate(
      actor,
      command,
      async (project) => {
        const source = project.drafts.promptPlan ?? project.artifacts.promptPlan;
        const confirmed = project.artifacts.models;
        if (!source || source.status === 'stale' || !confirmed || confirmed.status !== 'confirmed')
          throw new BusinessError(
            'INVALID_ARTIFACT',
            'Current plan and confirmed models are required.',
          );
        const models = parseArtifact(confirmed.content) as ModelsArtifact;
        if (models.schemaVersion !== 5)
          throw new BusinessError('INVALID_ARTIFACT', 'Current model schema required.');
        const result = applyPromptPlanDifference(
          source.content,
          this.requireDigest().text(source.content),
          command.raw,
          models,
        );
        if (!result.validation.valid)
          throw new BusinessError(
            'INVALID_ARTIFACT',
            result.validation.issues.map((issue) => issue.message).join(' / '),
          );
        project.drafts.promptPlan = {
          key: 'promptPlan',
          status: 'draft',
          content: result.extracted,
          validation: result.validation,
        };
      },
      'promptPlan',
    );
  }
  async importLoras(
    actor: ActorContext,
    command: MutationCommand & { payload: unknown; stage?: 'models' | 'models-fix' },
  ) {
    return this.mutate(
      actor,
      command,
      async (project) => {
        const source = project.drafts.models ?? project.artifacts.models;
        if (!source || source.status === 'stale')
          throw new BusinessError('INVALID_ARTIFACT', 'Base models are required.');
        const merged = mergeLoraImport(
          parseArtifact(source.content) as ModelsArtifact | null,
          command.payload,
        );
        const content = JSON.stringify(merged),
          validation = await this.validate('models', content, project);
        if (!validation.valid)
          throw new BusinessError(
            'INVALID_ARTIFACT',
            validation.issues.map((issue) => issue.message).join(' / '),
          );
        project.drafts.models = { key: 'models', content, status: 'draft', validation };
        const stage = command.stage ?? 'models';
        if (!['models', 'models-fix'].includes(stage))
          throw new BusinessError('INVALID_INPUT', 'Invalid model selection stage.');
        project.modelSelectionHistory = {
          ...project.modelSelectionHistory,
          [stage === 'models' ? 'initial' : 'fix']: JSON.parse(JSON.stringify(command.payload)),
        };
      },
      'models',
    );
  }
  async importAgentArtifact(
    actor: ActorContext,
    command: MutationCommand & {
      provider: 'codex' | 'grok';
      stage: ArtifactStage;
      sourceId: string;
      raw: string;
    },
  ) {
    authorize(actor, command.projectId, 'edit');
    requireId(command.sourceId, 'Source');
    if (
      !['codex', 'grok'].includes(command.provider) ||
      ![
        'story-finalize',
        'story-fix',
        'models',
        'models-fix',
        'prompt-plan',
        'prompt-plan-fix',
        'prompt-plan-patch',
        'caption',
      ].includes(command.stage) ||
      typeof command.raw !== 'string' ||
      !command.raw.trim() ||
      utf8Size(command.raw) > 10_000_000
    )
      throw new BusinessError('INVALID_INPUT', 'Invalid agent artifact.');
    const digest = this.requireDigest(),
      key = digest.text(
        [command.provider, command.stage, command.sourceId, digest.text(command.raw)].join('\0'),
      );
    return this.repository.transaction(command.projectId, async (tx) => {
      const project = await tx.load();
      assertCurrentProject(project, command.projectId);
      if (project.agentImports?.some((record) => record.key === key)) return project;
      assertMutation(actor, command, project, this.clock);
      const artifactKey = command.stage.startsWith('story-')
        ? 'story'
        : command.stage.startsWith('models')
          ? 'models'
          : command.stage === 'caption'
            ? 'caption'
            : 'promptPlan';
      let content = command.raw.trim();
      if (artifactKey !== 'story') {
        const match = content.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/i);
        content = match?.[1] ?? content;
        if (command.stage === 'prompt-plan-patch') {
          const plan = project.drafts.promptPlan ?? project.artifacts.promptPlan,
            models = project.artifacts.models;
          if (!plan || plan.status === 'stale' || models?.status !== 'confirmed')
            throw new BusinessError(
              'INVALID_ARTIFACT',
              'Current plan and confirmed models required.',
            );
          const result = applyPromptPlanDifference(
            plan.content,
            digest.text(plan.content),
            content,
            parseArtifact(models.content) as ModelsArtifact,
          );
          if (!result.validation.valid)
            throw new BusinessError('INVALID_ARTIFACT', 'Invalid Prompt Plan patch.');
          content = result.extracted;
        } else {
          const parsed = parseArtifact(content);
          if (!parsed) throw new BusinessError('INVALID_ARTIFACT', 'Invalid JSON response.');
          if (artifactKey === 'models') {
            const base = project.drafts.models ?? project.artifacts.models;
            if (!base || base.status === 'stale')
              throw new BusinessError('INVALID_ARTIFACT', 'Current base models required.');
            content = JSON.stringify(
              mergeLoraImport(parseArtifact(base.content) as ModelsArtifact, parsed),
            );
            project.modelSelectionHistory = {
              ...project.modelSelectionHistory,
              [command.stage === 'models' ? 'initial' : 'fix']: parsed,
            };
          } else content = JSON.stringify(parsed);
        }
      } else content = content.replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i, '$1');
      const validation = await this.validate(artifactKey, content, project);
      if (!validation.valid)
        throw new BusinessError('INVALID_ARTIFACT', 'Agent artifact validation failed.');
      project.drafts[artifactKey] = { key: artifactKey, content, status: 'draft', validation };
      project.agentImports = [
        ...(project.agentImports ?? []),
        {
          key,
          provider: command.provider,
          stage: command.stage,
          sourceId: command.sourceId,
          raw: command.raw,
        },
      ].slice(-300);
      const before = project.revision;
      project.revision = nextRevision(project);
      await tx.commit(before, project, event(actor, project, 'project.changed', artifactKey));
      return project;
    });
  }
  async importCaption(actor: ActorContext, command: MutationCommand & { raw: string }) {
    return this.mutate(
      actor,
      command,
      async (project) => {
        const result = importCaptionResponse(command.raw);
        if (
          !result.validation.valid ||
          (parseArtifact(result.extracted) as CaptionContent)?.schemaVersion !== 2
        )
          throw new BusinessError('INVALID_ARTIFACT', 'Current Caption v2 required.');
        project.drafts.caption = {
          key: 'caption',
          content: result.extracted,
          status: 'draft',
          validation: result.validation,
        };
      },
      'caption',
    );
  }
  async editPixivTitle(actor: ActorContext, command: MutationCommand & { title: unknown }) {
    return this.mutate(
      actor,
      command,
      async (project) => {
        const source = project.drafts.caption ?? project.artifacts.caption;
        if (!source || source.status === 'stale')
          throw new BusinessError('INVALID_ARTIFACT', 'Current Caption draft required.');
        const content = parseArtifact(source.content) as CaptionContent;
        if (content?.schemaVersion !== 2)
          throw new BusinessError('INVALID_ARTIFACT', 'Caption v2 required.');
        const next = JSON.stringify(updatePixivTitle(content, command.title));
        project.drafts.caption = {
          key: 'caption',
          content: next,
          status: 'draft',
          validation: await this.validate('caption', next, project),
        };
      },
      'caption',
    );
  }
  async resetStage(actor: ActorContext, command: MutationCommand & { scope: ModelResetScope }) {
    return this.mutate(
      actor,
      command,
      async (project) => {
        const plan = modelResetPlan(command.scope);
        if (command.scope === 'models' || command.scope === 'models-fix') {
          const source = project.drafts.models ?? project.artifacts.models;
          const restored = restoreModelSelection(
            source ? (parseArtifact(source.content) as ModelsArtifact) : null,
            project.modelSelectionHistory?.initial,
            command.scope,
          );
          const content = JSON.stringify(restored.models),
            validation = await this.validate('models', content, project);
          if (!validation.valid)
            throw new BusinessError('INVALID_ARTIFACT', 'Restored models are invalid.');
          project.artifacts.models = {
            key: 'models',
            content,
            status: 'confirmed',
            validation,
            modelPromptFallbacks: restored.fallbacks,
          };
          delete project.drafts.models;
        } else if (plan.models) {
          delete project.artifacts.models;
          delete project.drafts.models;
        }
        if (plan.story) {
          delete project.artifacts.story;
          delete project.drafts.story;
        }
        if (plan.promptPlan) {
          delete project.artifacts.promptPlan;
          delete project.drafts.promptPlan;
        }
        for (const key of downstream[
          plan.story
            ? 'story'
            : plan.models
              ? 'models'
              : plan.promptPlan
                ? 'promptPlan'
                : 'workflow'
        ]) {
          if (project.artifacts[key]) project.artifacts[key]!.status = 'stale';
          if (project.drafts[key]) project.drafts[key]!.status = 'stale';
        }
        delete project.artifacts.workflow;
        delete project.drafts.workflow;
        if (plan.initialHistory && project.modelSelectionHistory)
          delete project.modelSelectionHistory.initial;
        if (plan.fixHistory && project.modelSelectionHistory)
          delete project.modelSelectionHistory.fix;
      },
      'models',
    );
  }
  async confirm(actor: ActorContext, command: MutationCommand & { key: ArtifactKey }) {
    return this.mutate(
      actor,
      command,
      async (project) => {
        const draft = project.drafts[command.key];
        assertConfirmable(draft);
        // Revalidate canonical content inside the transaction, not a UI result.
        const validation = await this.validate(command.key, draft.content, project);
        if (!validation.valid)
          throw new BusinessError('INVALID_ARTIFACT', 'Canonical validation rejected the draft.');
        const modelDraft =
          command.key === 'models'
            ? splitModelDraft(parseArtifact(draft.content) as ModelsArtifact)
            : null;
        const changed = changesGenerationInputs(
          command.key,
          project.artifacts[command.key]?.content,
          modelDraft ? JSON.stringify(modelDraft.models) : draft.content,
          project.artifacts[command.key]?.modelPromptFallbacks ?? [],
          modelDraft?.fallbacks ?? [],
        );
        if (modelDraft) {
          draft.content = JSON.stringify(modelDraft.models);
          draft.modelPromptFallbacks = modelDraft.fallbacks;
        }
        draft.status = 'confirmed';
        draft.validation = validation;
        project.artifacts[command.key] = draft;
        delete project.drafts[command.key];
        for (const key of changed ? downstream[command.key] : []) {
          const item = project.artifacts[key];
          if (item) item.status = 'stale';
          const pending = project.drafts[key];
          if (pending) pending.status = 'stale';
        }
      },
      command.key,
    );
  }
  async reset(actor: ActorContext, command: MutationCommand & { key: ArtifactKey }) {
    return this.mutate(
      actor,
      command,
      async (project) => {
        if (!Object.hasOwn(downstream, command.key))
          throw new BusinessError('INVALID_INPUT', 'Unknown artifact.');
        delete project.artifacts[command.key];
        delete project.drafts[command.key];
        for (const key of downstream[command.key]) {
          const item = project.artifacts[key];
          if (item) item.status = 'stale';
          const pending = project.drafts[key];
          if (pending) pending.status = 'stale';
        }
      },
      command.key,
    );
  }
  private requireDigest() {
    if (!this.digest) throw new BusinessError('DEPENDENCY_UNAVAILABLE', 'Digest port required.');
    return this.digest;
  }
  private async validate(key: ArtifactKey, content: string, project: ProjectState) {
    const confirmed = project.artifacts.models;
    const models =
      confirmed?.status === 'confirmed' && confirmed.validation.valid
        ? (parseArtifact(confirmed.content) as ModelsArtifact | null)
        : null;
    const catalog = key === 'models' ? await this.catalogs.read(project.id) : null;
    return validateCanonicalArtifact(key, content, models, catalog);
  }
  private async mutate(
    actor: ActorContext,
    command: MutationCommand,
    apply: (project: ProjectState) => Promise<void>,
    subjectId: string,
  ) {
    authorize(actor, command.projectId, 'edit');
    requireId(subjectId, 'Artifact');
    if (!Object.hasOwn(downstream, subjectId))
      throw new BusinessError('INVALID_INPUT', 'Unknown artifact.');
    return this.repository.transaction(command.projectId, async (tx) => {
      const project = await tx.load();
      assertMutation(actor, command, project, this.clock);
      await apply(project);
      const before = project.revision;
      project.revision = nextRevision(project);
      await tx.commit(before, project, event(actor, project, 'project.changed', subjectId));
      return project;
    });
  }
}
