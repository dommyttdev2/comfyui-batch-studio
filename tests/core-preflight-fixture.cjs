const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const load = (name) => import(pathToFileURL(path.resolve(__dirname, '../dist-core', name)).href);
function catalogFor(models) {
  const selections = [models.checkpoint, ...models.loras];
  return {
    ...models.catalog,
    collections: [
      {
        items: selections.map((s) => ({
          ...s,
          modelType: s.ref.startsWith('lora.') ? 'LORA' : 'Checkpoint',
          versions: [
            {
              ...s,
              baseModel: 'Illustrious',
              files: [{ id: s.fileId, name: s.fileName, type: 'Model' }],
            },
          ],
        })),
      },
    ],
  };
}

async function preflightFixture(projectId = 'p') {
  const { assessPreflight } = await load('application/preflight.js');
  const { canonical } = await load('domain/workflow-graph.js');
  const { createHash } = require('node:crypto');
  const hash = (value) =>
    createHash('sha256')
      .update(JSON.stringify(canonical(value)))
      .digest('hex');
  const { artifacts } = require('./core-support/artifact-fixtures.cjs');
  const f = artifacts();
  f.catalogs = { value: catalogFor(f.models) };
  f.compilation = await load('domain/workflow-compilation.js');
  const raw = fs.readFileSync(
    path.resolve(__dirname, '../templates/illustrious-scene-batch/template.json'),
    'utf8',
  );
  const { api, ui } = f.compilation.compileImageWorkflow(f.models, f.plan, raw, 'p');
  const { modelGenerationInputs } = await load('domain/model-impact.js');
  const inputs = JSON.parse(modelGenerationInputs(f.models));
  const apiHash = hash(api),
    uiHash = hash(ui);
  const project = {
    artifacts: [{ key: 'workflow', relativePath: 'workflow.json', state: 'confirmed' }],
    targetImageCount: 1,
    meta: {
      settings: {},
      workflowBuild: {
        modelsSha256: hash(inputs),
        apiOutputPath: 'workflow.api.json',
        outputs: { api: { sha256: apiHash }, ui: { sha256: uiHash } },
        workflowIdentity: hash({ uiSha256: uiHash, apiSha256: apiHash }),
      },
    },
  };
  const documents = {
    'models.json': f.models,
    'prompt_plan.json': f.plan,
    'workflow.json': ui,
    'workflow.api.json': api,
  };
  const ports = {
    project: async () => ({
      schema: 'web-project/1',
      id: projectId,
      revision: 0,
      lease: null,
      runs: [],
      drafts: {},
      targetImageCount: project.targetImageCount,
      artifacts: {
        story: {
          key: 'story',
          content: 'Story',
          status: 'confirmed',
          validation: { valid: true, issues: [] },
        },
        models: {
          key: 'models',
          content: JSON.stringify(documents['models.json']),
          status: project.artifacts.find((a) => a.key === 'models')?.state ?? 'confirmed',
          validation: { valid: true, issues: [] },
        },
        promptPlan: {
          key: 'promptPlan',
          content: JSON.stringify(documents['prompt_plan.json']),
          status: 'confirmed',
          validation: { valid: true, issues: [] },
        },
        workflow: {
          key: 'workflow',
          status: 'confirmed',
          validation: { valid: true, issues: [] },
          content: JSON.stringify({
            schema: 'workflow/1',
            ui: documents['workflow.json'],
            api: documents['workflow.api.json'],
            uiSha256: project.meta.workflowBuild.outputs.ui.sha256,
            apiSha256: project.meta.workflowBuild.outputs.api.sha256,
            workflowIdentity: project.meta.workflowBuild.workflowIdentity,
            modelsSha256: project.meta.workflowBuild.modelsSha256,
            promptPlanSha256: hash(documents['prompt_plan.json']),
          }),
        },
      },
    }),
    exists: async (name) => name === 'story.md' || Object.hasOwn(documents, name),
    json: async (name) => documents[name] ?? null,
    catalog: async () => f.catalogs.value,
    availability: async () => ({
      executionTarget: 'local',
      rows: Object.values(f.models)
        .filter((s) => s && typeof s === 'object' && s.ref)
        .concat(f.models.loras)
        .map((s) => ({
          ref: s.ref,
          fileName: s.fileName,
          kind: s.ref.startsWith('checkpoint.') ? 'checkpoint' : 'lora',
          local: true,
          r2: false,
          state: 'available',
        })),
      localModelsRoot: '/models',
      localRootExists: true,
    }),
    hash,
  };
  return { assessPreflight, ports, project, documents };
}
module.exports = { preflightFixture };
