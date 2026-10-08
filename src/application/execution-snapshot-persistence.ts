import type { ExecutionRunSnapshot, ModelsArtifact } from '../domain/artifact-types.js';
import { seedExecutionSnapshot } from '../domain/execution-snapshot-policy.js';
import { verifyExecutionWorkflow } from '../domain/execution-workflow-policy.js';

export interface SnapshotPersistencePorts {
  read(resourceId: string): Promise<unknown | null>;
  write(resourceId: string, value: unknown): Promise<void>;
  paths(runId: string): { uiPath: string; apiPath: string; planPath: string; modelsPath: string };
  remove(runId: string): Promise<void>;
  seed(): number;
  hash(value: unknown): string;
  modelHash(value: ModelsArtifact): string;
}

export async function persistImmutableRunSnapshot(
  ports: SnapshotPersistencePorts,
  runId: string,
  snapshot: ExecutionRunSnapshot,
) {
  const [ui, api, plan, models] = await Promise.all([
    ports.read(snapshot.workflow.uiPath),
    ports.read(snapshot.workflow.apiPath),
    ports.read('prompt_plan.json'),
    ports.read('models.json'),
  ]);
  if (
    !ui ||
    !api ||
    !plan ||
    !models ||
    ports.hash(ui) !== snapshot.workflow.uiSha256 ||
    ports.hash(api) !== snapshot.workflow.apiSha256 ||
    ports.hash(plan) !== snapshot.plan.sha256 ||
    ports.modelHash(models as ModelsArtifact) !== snapshot.workflow.modelsSha256
  )
    throw new Error(
      'EXECUTION_SNAPSHOT_SOURCE_CHANGED: Workflow, Prompt Plan or models changed while the Run was being created.',
    );
  const paths = ports.paths(runId);
  const seeded = seedExecutionSnapshot(
    api,
    snapshot,
    paths,
    () => ports.seed(),
    (value) => ports.hash(value),
  );
  try {
    await ports.write(paths.uiPath, seeded.ui);
    await ports.write(paths.apiPath, seeded.api);
    await ports.write(paths.planPath, plan);
    await ports.write(paths.modelsPath, models);
    const [copiedUi, copiedApi, copiedPlan, copiedModels] = await Promise.all([
      ports.read(paths.uiPath),
      ports.read(paths.apiPath),
      ports.read(paths.planPath),
      ports.read(paths.modelsPath),
    ]);
    verifyExecutionWorkflow(
      { runId, snapshot: seeded.snapshot },
      {
        ui: copiedUi,
        api: copiedApi,
        plan: copiedPlan,
        models: copiedModels,
      },
      (value) => ports.hash(value),
    );
    return seeded.snapshot;
  } catch (error) {
    await ports.remove(runId);
    throw error;
  }
}
