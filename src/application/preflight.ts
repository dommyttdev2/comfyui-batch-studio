import type {
  ExecutionTarget,
  ModelAvailabilityRow,
  ModelCatalog,
  ModelsArtifact,
  PreflightResult,
  PromptPlanArtifact,
  ValidationIssue,
} from '../domain/artifact-types.js';
import { assessModelAvailability } from '../domain/availability-policy.js';
import { parseArtifact, validateCanonicalArtifact } from '../domain/canonical-artifact.js';
import { modelGenerationInputs } from '../domain/model-impact.js';
import { requiredModelSelections } from '../domain/model-placement.js';
import { assessRemoteTarget, type RemoteTargetFacts } from '../domain/remote-target-policy.js';
import { canonical, validateApiGraphStructure } from '../domain/workflow-graph.js';
import { assertCurrentProject } from './project-access.js';
import type { ProjectState } from './project-ports.js';
export interface AvailabilityFacts {
  rows: ModelAvailabilityRow[];
  executionTarget: ExecutionTarget;
  localModelsRoot: string;
  localRootExists: boolean;
}
export interface PreflightPorts {
  project(): Promise<ProjectState>;
  catalog(): Promise<ModelCatalog | null>;
  availability(): Promise<AvailabilityFacts>;
  remoteTarget?: () => Promise<RemoteTargetFacts>;
  hash(value: unknown): string;
}
export async function assessPreflight(
  ports: PreflightPorts,
): Promise<PreflightResult & { executionTarget: 'local' | 'remote' }> {
  const project = await ports.project();
  assertCurrentProject(project, project.id);
  const sections: PreflightResult['sections'] = [],
    blocking: ValidationIssue[] = [],
    warnings: ValidationIssue[] = [];
  const add = (name: string, issues: ValidationIssue[]) => {
    sections.push({ name, valid: !issues.some((issue) => issue.severity === 'error'), issues });
    blocking.push(...issues.filter((issue) => issue.severity === 'error'));
    warnings.push(...issues.filter((issue) => issue.severity === 'warning'));
  };
  const catalog = await ports.catalog();
  const modelArtifact = project.artifacts.models;
  const models = modelArtifact
    ? (parseArtifact(modelArtifact.content) as ModelsArtifact | null)
    : null;
  for (const key of ['story', 'models', 'promptPlan'] as const) {
    const artifact = project.artifacts[key];
    if (!artifact || artifact.status !== 'confirmed') {
      add(key, [
        {
          severity: 'error',
          code: artifact?.status === 'stale' ? 'ARTIFACT_STALE' : 'ARTIFACT_NOT_CONFIRMED',
          message: `${key} must be confirmed.`,
          path: key,
        },
      ]);
      continue;
    }
    const validation = validateCanonicalArtifact(key, artifact.content, models, catalog);
    add(
      key,
      validation.issues.map((issue) => ({
        ...issue,
        severity:
          'severity' in issue && issue.severity === 'warning'
            ? ('warning' as const)
            : ('error' as const),
        path: key,
      })),
    );
  }
  const planArtifact = project.artifacts.promptPlan;
  const plan = planArtifact
    ? (parseArtifact(planArtifact.content) as PromptPlanArtifact | null)
    : null;
  const graphIssues: ValidationIssue[] = [],
    artifact = project.artifacts.workflow;
  const issue = (code: string) =>
    graphIssues.push({ severity: 'error', code, message: code, path: 'workflow' });
  if (!artifact || artifact.status !== 'confirmed')
    issue(artifact?.status === 'stale' ? 'ARTIFACT_STALE' : 'WORKFLOW_MISSING');
  else {
    const build = parseArtifact(artifact.content) as {
      schema?: string;
      ui?: unknown;
      api?: unknown;
      uiSha256?: string;
      apiSha256?: string;
      modelsSha256?: string;
      promptPlanSha256?: string;
      workflowIdentity?: string;
    } | null;
    if (!build || build.schema !== 'workflow/1') issue('WORKFLOW_CURRENT_SCHEMA_REQUIRED');
    else {
      graphIssues.push(...validateApiGraphStructure(build.api));
      const hash = (value: unknown) => ports.hash(canonical(value));
      const uiHash = hash(build.ui),
        apiHash = hash(build.api);
      if (!build.ui || build.uiSha256 !== uiHash) issue('UI_WORKFLOW_HASH_MISMATCH');
      if (!build.api || build.apiSha256 !== apiHash) issue('API_GRAPH_HASH_MISMATCH');
      if (build.workflowIdentity !== hash({ uiSha256: uiHash, apiSha256: apiHash }))
        issue('WORKFLOW_IDENTITY_MISMATCH');
      if (
        !models ||
        build.modelsSha256 !==
          hash(JSON.parse(modelGenerationInputs(models, modelArtifact?.modelPromptFallbacks ?? [])))
      )
        issue('WORKFLOW_MODEL_STALE');
      if (!plan || build.promptPlanSha256 !== hash(plan)) issue('WORKFLOW_PLAN_STALE');
    }
  }
  add('Execution API graph', graphIssues);
  const facts = await ports.availability();
  const availability = assessModelAvailability(
    facts.rows,
    facts.executionTarget,
    facts.localModelsRoot,
    facts.localRootExists,
  );
  const placementIssues = [...availability.validation.issues];
  if (models?.schemaVersion === 5)
    for (const selection of requiredModelSelections(models)) {
      const rows = facts.rows.filter(
        (row) =>
          row.ref === selection.ref &&
          row.fileName === selection.fileName &&
          row.kind === selection.kind,
      );
      if (rows.length !== 1)
        placementIssues.push({
          severity: 'error',
          code: 'MODEL_PLACEMENT_EVIDENCE_REQUIRED',
          message: `Placement evidence missing or duplicated: ${selection.ref}`,
          path: selection.ref,
        });
    }
  add('モデル配置', placementIssues);
  if (facts.executionTarget === 'remote')
    add(
      'クラウド実行先',
      ports.remoteTarget
        ? assessRemoteTarget(await ports.remoteTarget())
        : [
            {
              severity: 'error',
              code: 'REMOTE_TARGET_FACTS_REQUIRED',
              message: 'Remote target observations required.',
            },
          ],
    );
  const planned = Array.isArray(plan?.branches)
    ? plan.branches.reduce((n, b) => n + (Array.isArray(b.leaves) ? b.leaves.length : 0), 0)
    : 0;
  if (planned < 1)
    add('Images', [
      { severity: 'error', code: 'PLAN_EMPTY', message: 'At least one planned image required.' },
    ]);
  const target = project.targetImageCount ?? null;
  if (target !== null && planned !== target)
    warnings.push({
      severity: 'warning',
      code: 'TARGET_DELTA',
      message: `Target ${target}, planned ${planned}`,
    });
  return {
    executionTarget: facts.executionTarget,
    state: blocking.length ? 'BLOCKED' : 'READY',
    plannedImages: planned,
    targetImages: target,
    blocking,
    warnings,
    sections,
  };
}
