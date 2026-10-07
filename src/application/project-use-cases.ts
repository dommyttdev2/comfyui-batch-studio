import { assertConfirmable, downstream } from '../domain/artifact-policy.js';
import type {
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
import { configureBaseModels, replaceModelSelection } from '../domain/model-editing.js';
import { assertCurrentProject, assertMutation, nextRevision } from './project-access.js';
import {
  type CatalogRepository,
  type Clock,
  event,
  type IdSource,
  type ProjectRepository,
  type ProjectState,
} from './project-ports.js';
export class ProjectUseCases {
  constructor(
    private readonly repository: ProjectRepository,
    private readonly catalogs: CatalogRepository,
    private readonly clock: Clock,
    private readonly ids: IdSource,
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
        project.drafts[command.key] = { ...current, status: 'draft' };
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
        const content = JSON.stringify(updated);
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
        const changed = changesGenerationInputs(
          command.key,
          project.artifacts[command.key]?.content,
          draft.content,
        );
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
