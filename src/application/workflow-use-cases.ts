import { assertUsable, downstream } from '../domain/artifact-policy.js';
import type {
  ModelFamily,
  ModelsArtifact,
  PromptPlanArtifact,
  WorkflowManifest,
} from '../domain/artifact-types.js';
import { validateWorkflowManifest } from '../domain/artifact-validation.js';
import { parseArtifact, validateCanonicalArtifact } from '../domain/canonical-artifact.js';
import {
  type ActorContext,
  authorize,
  BusinessError,
  type MutationCommand,
} from '../domain/contracts.js';
import { modelGenerationInputs } from '../domain/model-impact.js';
import { normalizeWorkflowTemplateText } from '../domain/template-policy.js';
import { compileImageWorkflow } from '../domain/workflow-compilation.js';
import { canonical } from '../domain/workflow-graph.js';
import { assertCurrentProject, assertMutation, nextRevision } from './project-access.js';
import type { Command } from '../domain/contracts.js';
import {
  workflowResourcesChanged,
  type WorkflowResourceIdentity,
} from '../domain/workflow-resource-policy.js';
import {
  type CatalogRepository,
  type Clock,
  event,
  type ProjectRepository,
} from './project-ports.js';
export interface WorkflowTemplates {
  read(family: ModelFamily): Promise<{ content: string; manifest: WorkflowManifest } | null>;
}
export interface Digest {
  text(value: string): string;
}
export class WorkflowUseCases {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly catalogs: CatalogRepository,
    private readonly templates: WorkflowTemplates,
    private readonly digest: Digest,
    private readonly clock: Clock,
  ) {}
  async status(actor: ActorContext, command: Command) {
    authorize(actor, command.projectId, 'read');
    return this.projects.transaction(command.projectId, async (tx) => {
      const project = await tx.load();
      assertCurrentProject(project, command.projectId);
      const artifact = project.artifacts.workflow;
      if (!artifact) return 'missing' as const;
      if (artifact.status !== 'confirmed') return 'stale' as const;
      const modelsArtifact = project.artifacts.models,
        planArtifact = project.artifacts.promptPlan;
      if (
        !modelsArtifact ||
        !planArtifact ||
        modelsArtifact.status !== 'confirmed' ||
        planArtifact.status !== 'confirmed'
      )
        return 'stale' as const;
      const models = parseArtifact(modelsArtifact.content) as ModelsArtifact;
      const template = await this.templates.read(models.modelFamily!);
      if (!template || !validateWorkflowManifest(template.manifest).valid) return 'stale' as const;
      const hash = (value: unknown) => this.digest.text(JSON.stringify(canonical(value)));
      const current: WorkflowResourceIdentity = {
        modelsSha256: hash(
          JSON.parse(modelGenerationInputs(models, modelsArtifact.modelPromptFallbacks ?? [])),
        ),
        template: {
          ...template.manifest.template,
          sha256: this.digest.text(normalizeWorkflowTemplateText(template.content)),
        },
        manifest: {
          schemaVersion: template.manifest.schemaVersion,
          version: template.manifest.manifestVersion,
          sha256: hash(template.manifest),
        },
      };
      const build = parseArtifact(artifact.content) as WorkflowResourceIdentity & {
        promptPlanSha256: string;
      };
      return workflowResourcesChanged(build, current) ||
        build.promptPlanSha256 !== hash(parseArtifact(planArtifact.content))
        ? ('stale' as const)
        : ('current' as const);
    });
  }
  async compile(actor: ActorContext, command: MutationCommand) {
    authorize(actor, command.projectId, 'edit');
    return this.projects.transaction(command.projectId, async (tx) => {
      const project = await tx.load();
      assertMutation(actor, command, project, this.clock);
      const modelArtifact = project.artifacts.models,
        planArtifact = project.artifacts.promptPlan;
      assertUsable(modelArtifact);
      assertUsable(planArtifact);
      const models = parseArtifact(modelArtifact.content) as ModelsArtifact;
      const catalog = await this.catalogs.read(project.id);
      const modelValidation = validateCanonicalArtifact(
        'models',
        modelArtifact.content,
        null,
        catalog,
      );
      const planValidation = validateCanonicalArtifact(
        'promptPlan',
        planArtifact.content,
        models,
        null,
      );
      if (!modelValidation.valid || !planValidation.valid)
        throw new BusinessError(
          'INVALID_ARTIFACT',
          'Confirmed workflow inputs failed canonical validation.',
        );
      const template = await this.templates.read(models.modelFamily!);
      if (!template || !validateWorkflowManifest(template.manifest).valid)
        throw new BusinessError(
          'INVALID_ARTIFACT',
          'Current standard template and manifest are required.',
        );
      if (
        this.digest.text(normalizeWorkflowTemplateText(template.content)) !==
        template.manifest.template.sha256
      )
        throw new BusinessError('INVALID_ARTIFACT', 'Template SHA-256 mismatch.');
      const plan = parseArtifact(planArtifact.content) as PromptPlanArtifact;
      const generated = compileImageWorkflow(models, plan, template.content, project.id);
      const hash = (value: unknown) => this.digest.text(JSON.stringify(canonical(value)));
      const uiSha256 = hash(generated.ui),
        apiSha256 = hash(generated.api);
      const modelInputs = JSON.parse(
        modelGenerationInputs(models, modelArtifact.modelPromptFallbacks ?? []),
      );
      const build = {
        schema: 'workflow/1',
        ...generated,
        generatedAt: this.clock.now(),
        compilerVersion: '3.0.0',
        modelsSha256: hash(modelInputs),
        promptPlanSha256: hash(plan),
        uiSha256,
        apiSha256,
        workflowIdentity: hash({ uiSha256, apiSha256 }),
        template: template.manifest.template,
        manifest: {
          schemaVersion: template.manifest.schemaVersion,
          version: template.manifest.manifestVersion,
          sha256: hash(template.manifest),
        },
      };
      project.artifacts.workflow = {
        key: 'workflow',
        content: JSON.stringify(build),
        status: 'confirmed',
        validation: { valid: true, issues: [...modelValidation.issues, ...planValidation.issues] },
      };
      delete project.drafts.workflow;
      for (const key of downstream.workflow) {
        if (project.artifacts[key]) project.artifacts[key]!.status = 'stale';
        if (project.drafts[key]) project.drafts[key]!.status = 'stale';
      }
      const before = project.revision;
      project.revision = nextRevision(project);
      await tx.commit(before, project, event(actor, project, 'project.changed', 'workflow'));
      return project;
    });
  }
}
