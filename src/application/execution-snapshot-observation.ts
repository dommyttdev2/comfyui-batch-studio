import { captureExecutionSnapshot } from '../domain/execution-snapshot-capture.js';
import type {
  ExecutionRunSnapshot,
  ModelsArtifact,
  PromptPlanArtifact,
  ProjectMeta,
  PreflightResult,
} from '../domain/artifact-types.js';
export interface SnapshotObservationPorts {
  readProjectMeta(root: string): Promise<ProjectMeta | null>;
  readJson<T>(file: string): Promise<T | null>;
  path: { join(...parts: string[]): string };
  hashCanonicalJson(value: unknown): string;
}
export async function captureProjectExecutionSnapshot(
  ports: SnapshotObservationPorts,
  root: string,
  preflight: PreflightResult,
): Promise<ExecutionRunSnapshot> {
  const { readProjectMeta, readJson, path, hashCanonicalJson } = ports;
  const meta = await readProjectMeta(root),
    build = meta?.workflowBuild as any;
  const uiPath = String(build?.outputs?.ui?.path ?? build?.outputPath ?? ''),
    apiPath = String(build?.outputs?.api?.path ?? build?.apiOutputPath ?? '');
  const [ui, api, models, plan, brief] = await Promise.all([
    readJson<unknown>(path.join(root, uiPath)),
    readJson<unknown>(path.join(root, apiPath)),
    readJson<ModelsArtifact>(path.join(root, 'models.json')),
    readJson<PromptPlanArtifact>(path.join(root, 'prompt_plan.json')),
    readJson<any>(path.join(root, 'project_brief.json')),
  ]);
  const target = meta?.settings.executionTarget === 'remote' ? 'remote' : 'local';
  return captureExecutionSnapshot(
    {
      projectId: String(brief?.project?.id ?? ''),
      target,
      remote:
        target === 'remote'
          ? {
              provider: meta?.settings.remoteProvider ?? null,
              instanceId: meta?.settings.remoteInstanceId ?? null,
            }
          : null,
      uiPath,
      apiPath,
      expectedUiSha: String(build?.outputs?.ui?.sha256 ?? ''),
      expectedApiSha: String(build?.outputs?.api?.sha256 ?? ''),
      expectedIdentity: String(build?.workflowIdentity ?? ''),
      expectedModelsSha: String(build?.modelsSha256 ?? ''),
      ui,
      api,
      models,
      plan,
    },
    preflight,
    hashCanonicalJson,
  );
}
