import { MAX_REFERENCE_BYTES } from '../domain/agent-artifact-policy.js';
import { validateAgentModelSelection } from '../domain/agent-state-policy.js';
import type { ModelsArtifact } from '../domain/artifact-types.js';
import { parseArtifact, validateCanonicalArtifact } from '../domain/canonical-artifact.js';
import { type ActorContext, authorize, BusinessError, type Command } from '../domain/contracts.js';
import { utf8Size } from '../domain/text-policy.js';
import { buildAgentTask, type TaskStage } from './agent-task-planning.js';
import type { AgentPort, AgentProvider, AgentStage } from './agent-use-cases.js';
import { assertCurrentProject } from './project-access.js';
import type { CatalogRepository, ProjectRepository } from './project-ports.js';
import type { Digest } from './workflow-use-cases.js';
export class AgentTaskUseCases {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly catalogs: CatalogRepository,
    private readonly runtime: AgentPort,
    private readonly digest?: Digest,
  ) {}
  async start(
    actor: ActorContext,
    command: Command & { stage: TaskStage; provider: AgentProvider; extra?: string },
  ) {
    authorize(actor, command.projectId, 'execute');
    if (!['codex', 'grok'].includes(command.provider))
      throw new BusinessError('INVALID_INPUT', 'Unknown provider.');
    if (
      ![
        'story-initial',
        'story-finalize',
        'story-fix',
        'models',
        'models-fix',
        'prompt-plan',
        'prompt-plan-fix',
        'prompt-plan-patch',
        'caption',
      ].includes(command.stage)
    )
      throw new BusinessError('INVALID_INPUT', 'Unknown task scope.');
    if (
      command.extra !== undefined &&
      (typeof command.extra !== 'string' || command.extra.length > 750_000)
    )
      throw new BusinessError('INVALID_INPUT', 'Invalid task conditions.');
    const stage: AgentStage = command.stage.startsWith('story-')
      ? 'story'
      : command.stage.startsWith('models')
        ? 'models'
        : command.stage === 'caption'
          ? 'caption'
          : 'promptPlan';
    const scope = { projectId: command.projectId, provider: command.provider, stage };
    const { job, acquired } = await this.runtime.reserve(scope, actor.requestId, {
      kind: 'task',
      text: JSON.stringify({ stage: command.stage, extra: command.extra ?? '' }),
      sessionId: null,
    });
    if (!acquired) return job;
    let plan;
    try {
      plan = await this.prepare(actor, command);
      if (!(await this.runtime.available(scope)))
        throw new BusinessError('DEPENDENCY_UNAVAILABLE', 'Configured agent is unavailable.');
    } catch (error) {
      await this.runtime.fail(scope, job.id);
      throw error;
    }
    try {
      return await this.runtime.launch(scope, job.id, {
        kind: 'task',
        text: plan.prompt,
        sessionId: null,
        attachments: plan.attachments,
        model: plan.model,
        projectRevision: plan.projectRevision,
      });
    } catch {
      await this.runtime.markUnknown(scope, job.id);
      throw new BusinessError(
        'RUNTIME_UNCERTAIN',
        'Agent task launch outcome is unknown; do not resubmit.',
      );
    }
  }
  async prepare(
    actor: ActorContext,
    command: Command & { stage: TaskStage; extra?: string; provider: AgentProvider },
  ) {
    authorize(actor, command.projectId, 'execute');
    if (!['codex', 'grok'].includes(command.provider))
      throw new BusinessError('INVALID_INPUT', 'Unknown provider.');
    if (
      ![
        'story-initial',
        'story-finalize',
        'story-fix',
        'models',
        'models-fix',
        'prompt-plan',
        'prompt-plan-fix',
        'prompt-plan-patch',
        'caption',
      ].includes(command.stage)
    )
      throw new BusinessError('INVALID_INPUT', 'Unknown task stage.');
    if (
      command.extra !== undefined &&
      (typeof command.extra !== 'string' || command.extra.length > 750_000)
    )
      throw new BusinessError('INVALID_INPUT', 'Invalid task conditions.');
    return this.projects.transaction(command.projectId, async (tx) => {
      const project = await tx.load();
      assertCurrentProject(project, command.projectId);
      const catalog = await this.catalogs.read(project.id);
      const resource: Record<string, unknown> = {};
      for (const [key, id] of [
        ['brief', 'brief'],
        ['story', 'story'],
        ['models', 'models'],
        ['promptPlan', 'prompt-plan'],
      ] as const) {
        const artifact = project.artifacts[key];
        if (
          artifact?.status === 'confirmed' &&
          !validateCanonicalArtifact(
            key,
            artifact.content,
            project.artifacts.models
              ? (parseArtifact(project.artifacts.models.content) as ModelsArtifact)
              : null,
            catalog,
          ).valid
        )
          throw new BusinessError('INVALID_ARTIFACT', 'Invalid confirmed task input.');
        if (artifact?.status === 'confirmed')
          resource[id] = key === 'story' ? artifact.content : parseArtifact(artifact.content);
      }
      if (project.drafts.models?.status === 'draft')
        resource['models-draft'] = parseArtifact(project.drafts.models.content);
      if (project.drafts.promptPlan?.status === 'draft')
        resource['prompt-plan-draft'] = parseArtifact(project.drafts.promptPlan.content);
      if (project.artifacts.models?.modelPromptFallbacks?.length)
        resource['model-prompt-fallbacks'] = {
          promptFallbacks: project.artifacts.models.modelPromptFallbacks,
        };
      if (catalog) resource.catalog = catalog;
      for (const name of ['models', 'models-draft', 'prompt-plan', 'prompt-plan-draft']) {
        const data = resource[name] as { schemaVersion?: number } | undefined;
        if (data && data.schemaVersion !== (name.startsWith('models') ? 5 : 2))
          throw new BusinessError('INVALID_ARTIFACT', 'Current task input schema required.');
      }
      const raw: Record<string, string> = {};
      for (const [key, id] of [
        ['promptPlan', 'prompt-plan'],
        ['models', 'models'],
      ] as const) {
        const artifact = project.artifacts[key];
        if (artifact?.status === 'confirmed') raw[id] = artifact.content;
      }
      if (project.drafts.promptPlan?.status === 'draft')
        raw['prompt-plan-draft'] = project.drafts.promptPlan.content;
      const plan = await buildAgentTask(
        {
          text: async (id) => raw[id] ?? null,
          hashText: this.digest ? (value) => this.digest!.text(value) : undefined,
          exists: async (id) => Object.hasOwn(resource, id),
          json: async <T>(id: string) => (resource[id] as T) ?? null,
          catalogResourceId: async () => (catalog ? 'catalog' : null),
        },
        command.stage,
        command.extra,
      );
      if (plan.attachments.some((item) => !item.exists))
        throw new BusinessError('INVALID_ARTIFACT', 'Task inputs are not confirmed.');
      const scope = command.stage.startsWith('story-')
          ? 'story'
          : command.stage.startsWith('models')
            ? 'models'
            : command.stage === 'caption'
              ? 'caption'
              : 'promptPlan',
        model = project.agentPreferences?.[scope + ':' + command.provider]?.model;
      const attachments = plan.attachments.map((item) => {
        const content =
          raw[item.resourceId] ??
          (typeof resource[item.resourceId] === 'string'
            ? (resource[item.resourceId] as string)
            : JSON.stringify(resource[item.resourceId]));
        if (typeof content !== 'string' || utf8Size(content) > MAX_REFERENCE_BYTES)
          throw new BusinessError(
            'INVALID_ARTIFACT',
            'Task input is absent or exceeds its size limit.',
          );
        return { ...item, content, sha256: this.digest?.text(content) };
      });
      return {
        ...plan,
        attachments,
        projectRevision: project.revision,
        model: model ? validateAgentModelSelection(model) : undefined,
      };
    });
  }
}
