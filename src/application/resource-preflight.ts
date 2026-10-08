import type {
  ExecutionTarget,
  ModelAvailabilityRow,
  ModelCatalog,
  ModelsArtifact,
  PreflightResult,
  ProjectSummary,
  PromptPlanArtifact,
  ValidationIssue,
} from '../domain/artifact-types.js';
import { validateModels, validatePromptPlan } from '../domain/artifact-validation.js';
import { assessModelAvailability } from '../domain/availability-policy.js';
import { validateModelsWithCatalog } from '../domain/catalog-validation.js';
import { modelGenerationInputs } from '../domain/model-impact.js';
import { assessRemoteTarget, type RemoteTargetFacts } from '../domain/remote-target-policy.js';
import { validateApiGraphStructure } from '../domain/workflow-graph.js';
export interface PreflightPorts {
  project(): Promise<ProjectSummary>;
  exists(resourceId: string): Promise<boolean>;
  json<T>(resourceId: string): Promise<T | null>;
  catalog(): Promise<ModelCatalog | null>;
  availability(): Promise<{
    rows: ModelAvailabilityRow[];
    executionTarget: ExecutionTarget;
    localModelsRoot: string;
    localRootExists: boolean;
  }>;
  remoteTarget?: () => Promise<RemoteTargetFacts>;
  hash(value: unknown): string;
}
function modelInputsHash(models: ModelsArtifact, hash: PreflightPorts['hash']) {
  return hash(JSON.parse(modelGenerationInputs(models)));
}
export async function assessResourcePreflight(ports: PreflightPorts): Promise<PreflightResult> {
  const project = await ports.project();
  const sections: PreflightResult['sections'] = [];
  const block: ValidationIssue[] = [];
  const warn: ValidationIssue[] = [];
  const add = (name: string, issues: ValidationIssue[]) => {
    sections.push({ name, valid: !issues.some((i) => i.severity === 'error'), issues });
    block.push(...issues.filter((i) => i.severity === 'error'));
    warn.push(...issues.filter((i) => i.severity === 'warning'));
  };
  const artifactIssues: ValidationIssue[] = [];
  for (const a of project.artifacts) {
    if (a.state === 'stale' && ['story', 'models', 'promptPlan', 'workflow'].includes(a.key))
      artifactIssues.push({
        severity: 'error',
        code: 'ARTIFACT_STALE',
        message: `${a.label} は上流Artifact更新後に再確定/再生成が必要です。`,
        path: a.key,
      });
  }
  add('Artifact整合性', artifactIssues);
  const storyExists = await ports.exists('story.md');
  add(
    'ストーリー',
    storyExists
      ? []
      : [{ severity: 'error', code: 'STORY_MISSING', message: 'story.mdが確定していません。' }],
  );
  const models = await ports.json<ModelsArtifact>('models.json');
  if (!models)
    add('モデル選定', [
      { severity: 'error', code: 'MODELS_MISSING', message: 'models.jsonが確定していません。' },
    ]);
  else {
    const v = validateModels(models);
    add(
      'モデル選定',
      v.valid ? validateModelsWithCatalog(await ports.catalog(), models, v).issues : v.issues,
    );
  }
  const plan = await ports.json<PromptPlanArtifact>('prompt_plan.json');
  if (!plan)
    add('プロンプト設計', [
      { severity: 'error', code: 'PLAN_MISSING', message: 'prompt_plan.jsonが確定していません。' },
    ]);
  else add('プロンプト設計', validatePromptPlan(plan, models).issues);
  const workflowName = project.artifacts.find((a) => a.key === 'workflow')?.relativePath;
  add(
    'ワークフロー',
    workflowName
      ? []
      : [
          {
            severity: 'error',
            code: 'WORKFLOW_MISSING',
            message: 'ワークフローが生成されていません。',
          },
        ],
  );
  const build = project.meta?.workflowBuild as any;
  const apiRelativePath = build?.apiOutputPath ?? build?.outputs?.api?.path;
  const apiIssues: ValidationIssue[] = [];
  if (
    models &&
    (!build?.modelsSha256 ||
      build.modelsSha256 !== modelInputsHash(models, (value) => ports.hash(value)))
  )
    apiIssues.push({
      severity: 'error',
      code: 'WORKFLOW_MODEL_STALE',
      message:
        'models.jsonの内容がWorkflow生成時と異なります。モデルを確認してWorkflowを再生成してください。',
      path: 'models.json',
    });
  if (!apiRelativePath)
    apiIssues.push({
      severity: 'error',
      code: 'API_GRAPH_MISSING',
      message: 'Execution用ComfyUI API-format graphが生成されていません。',
    });
  else {
    const apiPath = String(apiRelativePath);
    if (!(await ports.exists(apiPath)))
      apiIssues.push({
        severity: 'error',
        code: 'API_GRAPH_MISSING',
        message: 'Execution用ComfyUI API-format graphが見つかりません。',
        path: String(apiRelativePath),
      });
    else {
      const apiGraph = await ports.json<unknown>(apiPath);
      apiIssues.push(...validateApiGraphStructure(apiGraph));
      if (
        apiGraph &&
        build?.outputs?.api?.sha256 &&
        ports.hash(apiGraph) !== build.outputs.api.sha256
      )
        apiIssues.push({
          severity: 'error',
          code: 'API_GRAPH_HASH_MISMATCH',
          message: 'Execution API graphのhashがWorkflow build provenanceと一致しません。',
          path: String(apiRelativePath),
        });
      if (apiGraph && workflowName && build?.outputs?.ui?.sha256) {
        const uiWorkflow = await ports.json<unknown>(workflowName);
        if (uiWorkflow) {
          const uiHash = ports.hash(uiWorkflow),
            apiHash = ports.hash(apiGraph);
          if (uiHash !== build.outputs.ui.sha256)
            apiIssues.push({
              severity: 'error',
              code: 'UI_WORKFLOW_HASH_MISMATCH',
              message: 'UI WorkflowのhashがWorkflow build provenanceと一致しません。',
              path: workflowName,
            });
          if (
            build?.workflowIdentity &&
            ports.hash({ uiSha256: uiHash, apiSha256: apiHash }) !== build.workflowIdentity
          )
            apiIssues.push({
              severity: 'error',
              code: 'WORKFLOW_IDENTITY_MISMATCH',
              message: 'UI WorkflowとExecution API graphの対応identityが一致しません。',
            });
        }
      }
    }
  }
  add('Execution API graph', apiIssues);
  const facts = await ports.availability();
  const av = assessModelAvailability(
    facts.rows,
    facts.executionTarget,
    facts.localModelsRoot,
    facts.localRootExists,
  );
  add('モデル配置', av.validation.issues);
  if (av.executionTarget === 'remote') {
    add(
      'クラウド実行先',
      assessRemoteTarget(
        ports.remoteTarget
          ? await ports.remoteTarget()
          : {
              provider: project.meta?.settings.remoteProvider,
              instanceId: project.meta?.settings.remoteInstanceId,
              configured: false,
              installPath: '',
              githubPatConfigured: false,
              sshPrivateKeyPath: '',
              sshPrivateKeyExists: false,
              sshPublicKeyPath: '',
              sshPublicKeyExists: false,
              sshKeyPairValid: false,
              instance: null,
              lookupError: null,
            },
      ),
    );
  }
  const planned = plan ? plan.branches.reduce((n, b) => n + b.leaves.length, 0) : 0;
  if (project.targetImageCount != null && planned && planned !== project.targetImageCount)
    warn.push({
      severity: 'warning',
      code: 'TARGET_DELTA',
      message: `目標${project.targetImageCount}枚 / 現在${planned}枚です。`,
    });
  const uniqueBlock = block.filter(
    (x, i, a) =>
      a.findIndex((y) => y.code === x.code && y.path === x.path && y.message === x.message) === i,
  );
  return {
    state: uniqueBlock.length ? 'BLOCKED' : 'READY',
    plannedImages: planned,
    targetImages: project.targetImageCount,
    blocking: uniqueBlock,
    warnings: warn,
    sections,
  };
}
