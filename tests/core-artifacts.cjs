const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { artifacts } = require('./core-support/artifact-fixtures.cjs');
const { MemoryProjects } = require('./core-support/memory-ports.cjs');
const load = (name) => import(pathToFileURL(path.resolve(__dirname, '../dist-core', name)).href);
const mods = Promise.all([
  load('domain/canonical-artifact.js'),
  load('domain/model-editing.js'),
  load('domain/workflow-compilation.js'),
  load('application/project-use-cases.js'),
  load('domain/contracts.js'),
]);
const actor = {
  userId: 'u',
  sessionId: 's',
  requestId: 'r',
  projectIds: ['p'],
  permissions: ['read', 'edit', 'execute'],
};
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
async function setup() {
  const [policy, editing, compilation, { ProjectUseCases }, { BusinessError }] = await mods;
  const { models, plan } = artifacts();
  const catalogs = {
    value: catalogFor(models),
    async read() {
      return this.value;
    },
  };
  const projects = new MemoryProjects(
    {
      schema: 'web-project/1',
      id: 'p',
      revision: 0,
      lease: { id: 'l', userId: 'u', sessionId: 's', expiresAt: 10000 },
      artifacts: {},
      drafts: {},
      runs: [],
    },
    BusinessError,
  );
  const app = new ProjectUseCases(
    projects,
    catalogs,
    { now: () => 1 },
    { next: () => 'id' },
    { text: (value) => require('node:crypto').createHash('sha256').update(value).digest('hex') },
  );
  const command = () => ({
    projectId: 'p',
    leaseId: 'l',
    expectedRevision: projects.state.revision,
  });
  return { policy, editing, compilation, models, plan, catalogs, projects, app, command };
}
test('canonical model validation uses current schemas and actual catalog identities', async () => {
  const f = await setup();
  assert.equal(
    f.policy.validateCanonicalArtifact('models', JSON.stringify(f.models), null, f.catalogs.value)
      .valid,
    true,
  );
  const changed = structuredClone(f.models);
  changed.checkpoint.fileId++;
  assert.ok(
    f.policy
      .validateCanonicalArtifact('models', JSON.stringify(changed), null, f.catalogs.value)
      .issues.some((i) => i.code === 'VERSION_FILE_NOT_FOUND'),
  );
  changed.schemaVersion = 4;
  assert.equal(
    f.policy.validateCanonicalArtifact('models', JSON.stringify(changed), null, f.catalogs.value)
      .valid,
    false,
  );
});
test('confirm reloads the catalog inside the transaction and preserves state on identity failure', async () => {
  const f = await setup();
  await f.app.saveDraft(actor, {
    ...f.command(),
    key: 'models',
    content: JSON.stringify(f.models),
  });
  f.catalogs.value.collections[0].items[0].versions[0].files = [];
  await assert.rejects(
    f.app.confirm(actor, { ...f.command(), key: 'models' }),
    (e) => e.code === 'INVALID_ARTIFACT',
  );
  assert.equal(f.projects.state.revision, 1);
  assert.equal(f.projects.state.artifacts.models, undefined);
});
test('metadata-only model edits preserve downstream outputs while weight identity changes invalidate them', async () => {
  const f = await setup();
  const current = {
    key: 'models',
    content: JSON.stringify(f.models),
    status: 'confirmed',
    validation: { valid: true, issues: [] },
  };
  f.projects.state.artifacts.models = current;
  f.projects.state.artifacts.promptPlan = {
    key: 'promptPlan',
    content: JSON.stringify(f.plan),
    status: 'confirmed',
    validation: { valid: true, issues: [] },
  };
  f.models.checkpoint.reason = 'Revised explanation';
  f.models.catalog.generation++;
  await f.app.saveDraft(actor, {
    ...f.command(),
    key: 'models',
    content: JSON.stringify(f.models),
  });
  await f.app.confirm(actor, { ...f.command(), key: 'models' });
  assert.equal(f.projects.state.artifacts.promptPlan.status, 'confirmed');
  f.models.checkpoint.trainedWords.push('another_trigger');
  await f.app.saveDraft(actor, {
    ...f.command(),
    key: 'models',
    content: JSON.stringify(f.models),
  });
  await f.app.confirm(actor, { ...f.command(), key: 'models' });
  assert.equal(f.projects.state.artifacts.promptPlan.status, 'stale');
});
test('prompt plan validation resolves actual confirmed model references and trigger candidates', async () => {
  const f = await setup();
  assert.equal(
    f.policy.validateCanonicalArtifact('promptPlan', JSON.stringify(f.plan), f.models, null).valid,
    true,
  );
  f.plan.rootLoras[0].modelRef = 'lora.missing';
  assert.equal(
    f.policy.validateCanonicalArtifact('promptPlan', JSON.stringify(f.plan), f.models, null).valid,
    false,
  );
  assert.equal(
    f.policy.validateCanonicalArtifact('promptPlan', JSON.stringify(f.plan), null, null).valid,
    false,
  );
});
test('model updates reject stale identity and preserve the LoRA slot ref', async () => {
  const f = await setup();
  const selected = f.models.loras[0];
  const next = { ...selected, ref: 'lora.wrong', versionId: 2001 };
  const updated = f.editing.replaceModelSelection(f.models, selected, next);
  assert.equal(updated.loras[0].ref, selected.ref);
  assert.equal(updated.loras[0].versionId, 2001);
  assert.throws(
    () => f.editing.replaceModelSelection(updated, selected, next),
    (e) => e.code === 'REVISION_CONFLICT',
  );
  assert.equal(f.models.loras[0].versionId, selected.versionId);
});
test('Anima base construction requires both file selections and does not carry Checkpoint inputs', async () => {
  const f = await setup();
  const command = { family: 'anima', base: f.models.checkpoint, catalog: f.catalogs.value };
  assert.throws(() => f.editing.configureBaseModels(command));
  const result = f.editing.configureBaseModels({
    ...command,
    textEncoder: { ref: 'text_encoder.main', fileName: 'qwen.safetensors', reason: 'test' },
    vae: { ref: 'vae.main', fileName: 'vae.safetensors', reason: 'test' },
  });
  assert.equal(result.checkpoint, undefined);
  assert.equal(result.diffusionModel.ref, 'diffusion_model.main');
});
test('real standard template compiles one reachable image task per leaf with actual selected weights', async () => {
  const f = await setup();
  const raw = fs.readFileSync(
    path.resolve(__dirname, '../templates/illustrious-scene-batch/template.json'),
    'utf8',
  );
  const { api, ui } = f.compilation.compileImageWorkflow(f.models, f.plan, raw, 'project');
  assert.equal(Object.values(api).filter((n) => n.class_type === 'SaveImage').length, 1);
  assert.ok(Object.values(api).some((n) => n.inputs.ckpt_name === 'base.safetensors'));
  assert.ok(ui.nodes.length > 0);
  const bad = JSON.parse(raw);
  bad.generation.width = 17;
  assert.throws(
    () => f.compilation.compileImageWorkflow(f.models, f.plan, JSON.stringify(bad), 'project'),
    /STANDARD_TEMPLATE_INVALID/,
  );
});
test('canonical caption rejects missing Pixiv title and accepts current bilingual content', async () => {
  const f = await setup();
  const caption = {
    schemaVersion: 2,
    title: { ja: '題名', en: 'Title' },
    description: { ja: ['説明'], en: ['Description'] },
    pixivTitle: { ja: '題名', en: 'Title' },
  };
  assert.equal(
    f.policy.validateCanonicalArtifact('caption', JSON.stringify(caption), null, null).valid,
    true,
  );
  caption.pixivTitle.en = 'x'.repeat(33);
  assert.equal(
    f.policy.validateCanonicalArtifact('caption', JSON.stringify(caption), null, null).valid,
    false,
  );
});

async function creationFixture() {
  const { createExecutionRun } = await load('application/execution-creation.js');
  const { plan } = artifacts();
  const snapshot = {
    projectId: 'p',
    target: 'local',
    remote: null,
    runIdentity: 'r',
    workflow: { workflowIdentity: 'w', modelsSha256: 'm' },
    plan: {
      sha256: 's',
      branches: plan.branches.map((b) => ({ branchId: b.id, leafIds: b.leaves.map((l) => l.id) })),
    },
  };
  const calls = [];
  let captures = 0;
  const ports = {
    exclusive: async (work) => {
      calls.push('lock');
      try {
        return await work();
      } finally {
        calls.push('unlock');
      }
    },
    current: async () => null,
    capture: async () => {
      captures++;
      return structuredClone(snapshot);
    },
    preflight: async () => ({
      state: 'READY',
      plannedImages: 1,
      targetImages: 1,
      blocking: [],
      warnings: [],
      sections: [],
    }),
    persistSnapshot: async (id, value) => {
      calls.push('snapshot');
      return value;
    },
    removeSnapshot: async () => calls.push('remove'),
    write: async () => calls.push('write'),
    setCurrent: async () => calls.push('current'),
    now: () => '2026-10-06T00:00:00Z',
    nextId: () => 'run',
  };
  return { createExecutionRun, ports, calls, snapshot, count: () => captures };
}
test('Run creation owns the lock and persists the verified snapshot before the active pointer', async () => {
  const f = await creationFixture();
  const run = await f.createExecutionRun(f.ports, f.ports.preflight);
  assert.equal(run.progress.overall.total, 1);
  assert.equal(run.progress.branches[0].total, 1);
  assert.equal(f.count(), 3);
  assert.deepEqual(f.calls, ['lock', 'snapshot', 'write', 'current', 'unlock']);
});
test('a blocked Preflight cannot create a Run or snapshot', async () => {
  const f = await creationFixture();
  f.ports.preflight = async () => ({ state: 'BLOCKED', blocking: [{ message: 'blocked' }] });
  await assert.rejects(f.createExecutionRun(f.ports, f.ports.preflight), /BLOCKED/);
  assert.deepEqual(f.calls, ['lock', 'unlock']);
});
test('changes during Preflight reject Run creation before snapshot copying', async () => {
  const f = await creationFixture();
  let n = 0;
  f.ports.capture = async () => ({ ...structuredClone(f.snapshot), runIdentity: String(n++) });
  await assert.rejects(
    f.createExecutionRun(f.ports, f.ports.preflight),
    /changed during Preflight/,
  );
  assert.deepEqual(f.calls, ['lock', 'unlock']);
});
test('changes during copying remove the provisional snapshot without publishing a Run', async () => {
  const f = await creationFixture();
  let n = 0;
  f.ports.capture = async () => {
    const value = structuredClone(f.snapshot);
    if (++n === 3) value.workflow.modelsSha256 = 'changed';
    return value;
  };
  await assert.rejects(f.createExecutionRun(f.ports, f.ports.preflight), /SOURCE_CHANGED/);
  assert.deepEqual(f.calls, ['lock', 'snapshot', 'remove', 'unlock']);
});
async function preflightFixture() {
  const { assessPreflight } = await load('application/preflight.js');
  const { canonical } = await load('domain/workflow-graph.js');
  const { createHash } = require('node:crypto');
  const hash = (value) =>
    createHash('sha256')
      .update(JSON.stringify(canonical(value)))
      .digest('hex');
  const f = await setup();
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
      id: 'p',
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
test('Preflight uses real artifacts, graph structure and cryptographic provenance', async () => {
  const f = await preflightFixture();
  const ready = await f.assessPreflight(f.ports);
  assert.equal(ready.state, 'READY', JSON.stringify(ready));
  assert.equal(ready.plannedImages, 1);
  f.documents['workflow.api.json']['1'].inputs.ckpt_name = 'changed.safetensors';
  const blocked = await f.assessPreflight(f.ports);
  assert.equal(blocked.state, 'BLOCKED');
  assert.ok(blocked.blocking.some((i) => i.code === 'API_GRAPH_HASH_MISMATCH'));
});
test('Preflight rejects stale artifacts and treats target count differences as warnings', async () => {
  const f = await preflightFixture();
  f.project.targetImageCount = 2;
  const ready = await f.assessPreflight(f.ports);
  assert.equal(ready.state, 'READY');
  assert.ok(ready.warnings.some((i) => i.code === 'TARGET_DELTA'));
  f.project.artifacts.push({ key: 'models', state: 'stale', label: 'Models' });
  const blocked = await f.assessPreflight(f.ports);
  assert.ok(blocked.blocking.some((i) => i.code === 'ARTIFACT_STALE'));
});
test('recovery never treats a lost local POST response as a safely paused Run', async () => {
  const { planPersistedRecovery } = await load('domain/execution-policy.js');
  const run = {
    executionTarget: 'local',
    phase: 'EXECUTING',
    current: { promptId: null },
    submission: null,
  };
  assert.equal(planPersistedRecovery(run), 'retain-uncertain');
  run.submission = { status: 'prepared' };
  assert.equal(planPersistedRecovery(run), 'pause-prepared');
  run.submission.status = 'sending';
  assert.equal(planPersistedRecovery(run), 'recover-local');
});
test('portable pixel rotation and composition accept ordinary byte arrays', async () => {
  const { applyExifOrientation, compositeBitmapOnWhite } = await load('domain/image-pixels.js');
  const source = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 128]);
  const rotated = applyExifOrientation(source, 2, 1, 6);
  assert.equal(rotated.width, 1);
  assert.equal(rotated.height, 2);
  assert.deepEqual([...rotated.bitmap], [...source]);
  assert.deepEqual([...compositeBitmapOnWhite(new Uint8Array([0, 0, 0, 0]))], [255, 255, 255, 255]);
  assert.equal(source[7], 128);
});

test('malformed typed artifact fields produce validation errors rather than escaping JSON boundary', async () => {
  const f = await setup();
  assert.equal(
    f.policy.validateCanonicalArtifact(
      'brief',
      JSON.stringify({ project: { id: 'p', title: 123 } }),
      null,
      null,
    ).valid,
    false,
  );
});

async function recoveryFixture() {
  const f = await creationFixture();
  let stored = await f.createExecutionRun(f.ports, f.ports.preflight);
  const calls = [];
  const { recoverExecutionRun } = await load('application/execution-recovery.js');
  const ports = {
    load: async () => structuredClone(stored),
    save: async (run) => {
      stored = structuredClone(run);
      calls.push('save');
    },
    hasActiveWorker: async () => false,
    reserveOwnership: async () => calls.push('reserve'),
    recoverLocal: async () => calls.push('recover-local'),
    recoverRemote: async () => calls.push('recover-remote'),
    verifyLocalOutputs: async () => calls.push('verify'),
    finalizeRemote: async () => {
      calls.push('finalize');
      stored.remoteLifecycle = { finalizedAt: 'time', latest: { status: 'stopped' } };
    },
    hash: (value) => JSON.stringify(value),
    now: () => '2026-10-06T00:00:00Z',
  };
  return { ports, calls, recoverExecutionRun, run: () => stored };
}
test('recovery pauses a durable prepared intent without submitting another Prompt', async () => {
  const f = await recoveryFixture();
  f.run().phase = 'EXECUTING';
  f.run().submission = { status: 'prepared' };
  const result = await f.recoverExecutionRun(f.ports, 'p', 'run');
  assert.equal(result.lifecycle, 'PAUSED');
  assert.deepEqual(f.calls, ['save']);
});
test('a lost POST response retains ownership and becomes explicitly uncertain', async () => {
  const f = await recoveryFixture();
  f.run().phase = 'EXECUTING';
  const result = await f.recoverExecutionRun(f.ports, 'p', 'run');
  assert.equal(result.recovery, 'uncertain');
  assert.equal(result.lifecycle, 'FAILED');
  assert.ok(f.calls.includes('reserve'));
  assert.ok(!f.calls.includes('recover-local'));
});
test('a submitted Prompt is reconciled using its owner and never guessed safely stopped', async () => {
  const f = await recoveryFixture();
  f.run().phase = 'EXECUTING';
  f.run().current.promptId = 'prompt';
  await f.recoverExecutionRun(f.ports, 'p', 'run');
  assert.deepEqual(f.calls, ['reserve', 'recover-local']);
});
test('an unconfirmed output or foreign scope cannot become successful completion', async () => {
  const f = await recoveryFixture();
  f.run().phase = 'COMPLETED';
  f.ports.verifyLocalOutputs = async () => {
    throw new Error('Missing output');
  };
  const result = await f.recoverExecutionRun(f.ports, 'p', 'run');
  assert.equal(result.recovery, 'uncertain');
  const foreign = await recoveryFixture();
  await assert.rejects(
    foreign.recoverExecutionRun(foreign.ports, 'foreign', 'run'),
    (e) => e.code === 'FORBIDDEN',
  );
  assert.deepEqual(foreign.calls, []);
});
test('remote finalization requires authenticated completion evidence before stopping billing', async () => {
  const f = await recoveryFixture();
  const run = f.run();
  run.executionTarget = 'remote';
  run.phase = 'CLOUD_INSTANCE_FINALIZING';
  run.remote = { provider: 'vastai', instanceId: 1 };
  const rejected = await f.recoverExecutionRun(f.ports, 'p', 'run');
  assert.equal(rejected.recovery, 'uncertain');
  assert.ok(!f.calls.includes('finalize'));
  const good = await recoveryFixture();
  const owned = good.run();
  owned.executionTarget = 'remote';
  owned.phase = 'CLOUD_INSTANCE_FINALIZING';
  owned.remote = { provider: 'vastai', instanceId: 1 };
  owned.evidence = ['LOCAL_FILE_VERIFIED', 'CLEANUP_COMPLETED'].map((kind, i) => ({
    id: String(i),
    kind,
    scope: 'run',
    runIdentity: owned.snapshot.runIdentity,
    fingerprint: JSON.stringify({
      runIdentity: owned.snapshot.runIdentity,
      kind,
      scope: 'run',
      data: {},
    }),
  }));
  const completed = await good.recoverExecutionRun(good.ports, 'p', 'run');
  assert.equal(completed.lifecycle, 'COMPLETED');
  assert.equal(completed.finalization, 'stopped');
  assert.ok(good.calls.includes('finalize'));
});

async function workflowFixture() {
  const f = await setup();
  const { WorkflowUseCases } = await load('application/workflow-use-cases.js');
  const { createHash } = require('node:crypto');
  const digest = { text: (value) => createHash('sha256').update(value, 'utf8').digest('hex') };
  const dir = path.resolve(__dirname, '../templates/illustrious-scene-batch');
  const template = {
    content: fs.readFileSync(path.join(dir, 'template.json'), 'utf8'),
    manifest: JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')),
  };
  const templates = { read: async () => template };
  for (const [key, value] of [
    ['models', f.models],
    ['promptPlan', f.plan],
  ])
    f.projects.state.artifacts[key] = {
      key,
      content: JSON.stringify(value),
      status: 'confirmed',
      validation: { valid: true, issues: [] },
    };
  const app = new WorkflowUseCases(f.projects, f.catalogs, templates, digest, { now: () => 1 });
  return { ...f, app, template };
}
test('workflow use case canonically validates and atomically commits generated graph provenance', async () => {
  const f = await workflowFixture();
  const result = await f.app.compile(actor, f.command());
  assert.equal(result.revision, 1);
  assert.equal(result.artifacts.workflow.status, 'confirmed');
  assert.equal(f.projects.events.length, 1);
  const build = JSON.parse(result.artifacts.workflow.content);
  assert.match(build.workflowIdentity, /^[a-f0-9]{64}$/);
  assert.match(build.modelsSha256, /^[a-f0-9]{64}$/);
  assert.ok(build.api);
  assert.ok(build.ui);
});
test('workflow generation refuses tampered templates and stale confirmed inputs', async () => {
  const f = await workflowFixture();
  f.template.content += ' ';
  await assert.rejects(f.app.compile(actor, f.command()), (e) => e.code === 'INVALID_ARTIFACT');
  assert.equal(f.projects.state.artifacts.workflow, undefined);
  const stale = await workflowFixture();
  stale.projects.state.artifacts.models.status = 'stale';
  await assert.rejects(
    stale.app.compile(actor, stale.command()),
    (e) => e.code === 'INVALID_ARTIFACT',
  );
});
test('workflow storage failure rolls back generation result and event together', async () => {
  const f = await workflowFixture();
  f.projects.failCommit = true;
  await assert.rejects(f.app.compile(actor, f.command()), /Persistence unavailable/);
  assert.equal(f.projects.state.revision, 0);
  assert.equal(f.projects.state.artifacts.workflow, undefined);
  assert.equal(f.projects.events.length, 0);
});

test('Preflight and downstream invalidation agree on explanation-only model edits', async () => {
  const f = await preflightFixture();
  f.documents['models.json'].checkpoint.reason = 'New explanation';
  f.documents['models.json'].checkpoint.modelName = 'New display name';
  const result = await f.assessPreflight(f.ports);
  assert.equal(result.state, 'READY', JSON.stringify(result));
  f.documents['models.json'].checkpoint.trainedWords.push('changed_trigger');
  const changed = await f.assessPreflight(f.ports);
  assert.ok(changed.blocking.some((i) => i.code === 'WORKFLOW_MODEL_STALE'));
});

test('current Preflight rejects legacy schemas and incomplete placement observations', async () => {
  const f = await preflightFixture();
  f.documents['models.json'].schemaVersion = 4;
  let result = await f.assessPreflight(f.ports);
  assert.equal(result.state, 'BLOCKED');
  assert.ok(result.blocking.some((i) => i.code === 'MODELS_CURRENT_SCHEMA_REQUIRED'));
  f.documents['models.json'].schemaVersion = 5;
  f.documents['prompt_plan.json'].schemaVersion = 1;
  result = await f.assessPreflight(f.ports);
  assert.ok(result.blocking.some((i) => i.code === 'PROMPT_PLAN_CURRENT_SCHEMA_REQUIRED'));
  f.documents['prompt_plan.json'].schemaVersion = 2;
  f.ports.availability = async () => ({
    rows: [],
    executionTarget: 'local',
    localModelsRoot: '/models',
    localRootExists: true,
  });
  result = await f.assessPreflight(f.ports);
  assert.ok(result.blocking.some((i) => i.code === 'MODEL_PLACEMENT_EVIDENCE_REQUIRED'));
});
test('remote requirements are computed from facts, not a supplied validation verdict', async () => {
  const { assessRemoteTarget } = await load('domain/remote-target-policy.js');
  const facts = {
    provider: 'vastai',
    instanceId: 1,
    configured: true,
    installPath: '/comfy',
    githubPatConfigured: true,
    sshPrivateKeyPath: 'key',
    sshPrivateKeyExists: true,
    sshPublicKeyPath: 'pub',
    sshPublicKeyExists: true,
    sshKeyPairValid: true,
    instance: { id: 1, status: 'running', sshHost: 'host', sshPort: 22 },
    lookupError: null,
  };
  assert.deepEqual(assessRemoteTarget(facts), []);
  facts.sshKeyPairValid = false;
  assert.ok(assessRemoteTarget(facts).some((i) => i.code === 'VASTAI_SSH_KEY_PAIR_MISMATCH'));
  facts.instance.status = 'offline';
  assert.ok(assessRemoteTarget(facts).some((i) => i.code === 'VASTAI_INSTANCE_UNAVAILABLE'));
});
test('LoRA supplemental tags are preserved and invalidate downstream when only tags change', async () => {
  const f = await setup();
  const base = {
    key: 'models',
    content: JSON.stringify(f.models),
    status: 'confirmed',
    validation: { valid: true, issues: [] },
  };
  f.projects.state.artifacts.models = base;
  f.projects.state.artifacts.workflow = {
    key: 'workflow',
    content: 'graph',
    status: 'confirmed',
    validation: { valid: true, issues: [] },
  };
  const payload = {
    schemaVersion: 1,
    loras: f.models.loras,
    promptFallbacks: [
      {
        requirement: 'lighting',
        positiveTags: ['soft_light'],
        negativeTags: [],
        reason: 'No matching LoRA',
      },
    ],
  };
  await f.app.importLoras(actor, { ...f.command(), payload });
  await f.app.confirm(actor, { ...f.command(), key: 'models' });
  assert.equal(
    f.projects.state.artifacts.models.modelPromptFallbacks[0].positiveTags[0],
    'soft_light',
  );
  assert.equal(JSON.parse(f.projects.state.artifacts.models.content).promptFallbacks, undefined);
  assert.equal(f.projects.state.artifacts.workflow.status, 'stale');
  f.projects.state.artifacts.workflow.status = 'confirmed';
  await f.app.beginEdit(actor, { ...f.command(), key: 'models' });
  const value = JSON.parse(f.projects.state.drafts.models.content);
  value.promptFallbacks[0].reason = 'Explanation only';
  await f.app.saveDraft(actor, { ...f.command(), key: 'models', content: JSON.stringify(value) });
  await f.app.confirm(actor, { ...f.command(), key: 'models' });
  assert.equal(f.projects.state.artifacts.workflow.status, 'confirmed');
  const before = structuredClone(f.projects.state);
  await assert.rejects(
    f.app.importLoras(actor, {
      ...f.command(),
      payload: {
        ...payload,
        missingRequirements: [{ role: 'character', requirement: 'x', reason: 'unresolved' }],
      },
    }),
  );
  assert.deepEqual(f.projects.state, before);
});
test('caption fingerprints exclude Pixiv titles and detect output loss and changed inputs', async () => {
  const { assessCaptionBuild, captionContentHash, captionRenderInputHash } = await load(
    'domain/caption-build-policy.js',
  );
  const { renderCaption } = await load('domain/caption-policy.js');
  const content = {
    schemaVersion: 2,
    title: { ja: '作品', en: 'Work' },
    pixivTitle: { ja: '投稿', en: 'Post' },
    description: { ja: ['説明'], en: ['Description'] },
  };
  const hash = (s) => require('node:crypto').createHash('sha256').update(s).digest('hex');
  const actualCaption = renderCaption(content, 1, false);
  const facts = {
    sourceDirectory: 'asset:final',
    sourceExists: true,
    imageCount: 1,
    content,
    validation: { valid: true, issues: [] },
    actualCaption,
    copyrightedCharacter: false,
    build: {
      sourceDirectory: 'asset:final',
      imageCount: 1,
      contentSha256: captionContentHash(content, hash),
      renderInputSha256: captionRenderInputHash(content, 1, 'asset:final', false, hash),
      outputSha256: hash(actualCaption),
    },
  };
  assert.equal(assessCaptionBuild(facts, hash).state, 'generated');
  content.pixivTitle.ja = '変更';
  assert.equal(assessCaptionBuild(facts, hash).stale, false);
  assert.equal(assessCaptionBuild({ ...facts, actualCaption: null }, hash).stale, true);
  assert.equal(assessCaptionBuild({ ...facts, imageCount: 2 }, hash).stale, true);
});
test('marketplace output verification rejects source, crop and produced-byte changes', async () => {
  const p = await load('domain/marketplace-generation-policy.js');
  const targets = [{ id: 't', service: 'site', fileName: 'image', width: 10, height: 10 }];
  const source = { path: 'asset:source', size: 1, mtimeMs: 2, sha256: 'a'.repeat(64) },
    state = {
      sourceImagePath: 'asset:source',
      sourceType: 'final-artifact',
      format: 'png',
      targets: { t: { crop: null } },
    };
  const expected = {
    targetId: 't',
    relativePath: 'site/image.png',
    size: 3,
    sha256: 'b'.repeat(64),
  };
  const manifest = {
    schemaVersion: 1,
    generationId: '12345678-1234-4234-8234-123456789012',
    format: 'png',
    inputSignature: p.marketplaceInputSignature(state, targets),
    source,
    outputs: [expected],
  };
  p.validateMarketplaceGeneration(manifest, state, targets, source);
  p.assertMarketplaceOutput(expected, targets[0], 'png', { size: 3, sha256: expected.sha256 });
  assert.throws(() =>
    p.validateMarketplaceGeneration(
      manifest,
      { ...state, targets: { t: { crop: { x: 0, y: 0, width: 4, height: 4 } } } },
      targets,
      source,
    ),
  );
  assert.throws(() =>
    p.validateMarketplaceGeneration(manifest, state, targets, {
      ...source,
      sha256: 'c'.repeat(64),
    }),
  );
  assert.throws(() =>
    p.assertMarketplaceOutput(expected, targets[0], 'png', { size: 3, sha256: 'c'.repeat(64) }),
  );
});

test('atomic agent import preserves valid drafts on rejection and deduplicates successful replay', async () => {
  const f = await setup();
  f.projects.state.artifacts.models = {
    key: 'models',
    content: JSON.stringify(f.models),
    status: 'confirmed',
    validation: { valid: true, issues: [] },
  };
  const command = {
    ...f.command(),
    provider: 'codex',
    stage: 'models',
    sourceId: 'job:one',
    raw: JSON.stringify({ schemaVersion: 1, loras: f.models.loras }),
  };
  await f.app.importAgentArtifact(actor, command);
  const saved = structuredClone(f.projects.state);
  await f.app.importAgentArtifact(actor, command);
  assert.deepEqual(f.projects.state, saved);
  await assert.rejects(
    f.app.importAgentArtifact(actor, {
      ...command,
      ...f.command(),
      sourceId: 'job:two',
      raw: JSON.stringify({ schemaVersion: 1, loras: [], checkpoint: {} }),
    }),
  );
  assert.deepEqual(f.projects.state, saved);
  await assert.rejects(f.app.importAgentArtifact({ ...actor, permissions: ['read'] }, command));
  assert.deepEqual(f.projects.state, saved);
});
test('LoRA fix reset restores initial selection and tags while preserving user base models', async () => {
  const f = await setup();
  f.projects.state.artifacts.models = {
    key: 'models',
    content: JSON.stringify(f.models),
    status: 'confirmed',
    validation: { valid: true, issues: [] },
  };
  const initial = {
    schemaVersion: 1,
    loras: f.models.loras,
    promptFallbacks: [
      { requirement: 'x', positiveTags: ['tag'], negativeTags: [], reason: 'no LoRA' },
    ],
  };
  await f.app.importLoras(actor, { ...f.command(), payload: initial, stage: 'models' });
  await f.app.confirm(actor, { ...f.command(), key: 'models' });
  await f.app.importLoras(actor, {
    ...f.command(),
    payload: { schemaVersion: 1, loras: [] },
    stage: 'models-fix',
  });
  await f.app.confirm(actor, { ...f.command(), key: 'models' });
  await f.app.resetStage(actor, { ...f.command(), scope: 'models-fix' });
  assert.deepEqual(JSON.parse(f.projects.state.artifacts.models.content), f.models);
  assert.equal(f.projects.state.artifacts.models.modelPromptFallbacks[0].positiveTags[0], 'tag');
  assert.equal(f.projects.state.modelSelectionHistory.fix, undefined);
  await f.app.resetStage(actor, { ...f.command(), scope: 'models' });
  assert.equal(JSON.parse(f.projects.state.artifacts.models.content).loras.length, 0);
  assert.equal(f.projects.state.modelSelectionHistory.initial, undefined);
});
test('Caption output reads canonical project input and committed build, with revision and failure guards', async () => {
  const f = await setup();
  const { OutputUseCases } = await load('application/output-use-cases.js');
  const hash = (value) => require('node:crypto').createHash('sha256').update(value).digest('hex');
  const content = {
    schemaVersion: 2,
    title: { ja: '作品', en: 'Work' },
    pixivTitle: { ja: '投稿', en: 'Post' },
    description: { ja: ['説明'], en: ['Description'] },
  };
  await f.app.importCaption(actor, { ...f.command(), raw: JSON.stringify(content) });
  const facts = {
    sourceDirectory: 'asset:final',
    sourceExists: true,
    imageCount: 1,
    content: { ...content, title: { ja: '別の内容', en: 'Wrong' } },
    build: null,
    actualCaption: null,
    copyrightedCharacter: false,
  };
  const outputs = new OutputUseCases(
    f.projects,
    { caption: async () => facts },
    { text: hash },
    { now: () => 1 },
  );
  await outputs.generateCaption(actor, f.command());
  assert.match(f.projects.state.captionOutput.text, /作品/);
  assert.doesNotMatch(f.projects.state.captionOutput.text, /別の内容/);
  assert.equal((await outputs.captionStatus(actor, { projectId: 'p' })).state, 'generated');
  await f.app.editPixivTitle(actor, { ...f.command(), title: { ja: '変更', en: 'Changed' } });
  assert.equal((await outputs.captionStatus(actor, { projectId: 'p' })).stale, false);
  const saved = structuredClone(f.projects.state);
  facts.imageCount = 0;
  await assert.rejects(outputs.generateCaption(actor, f.command()));
  assert.deepEqual(f.projects.state, saved);
});
test('portable ISO and JST archive timestamps match calendar boundaries', async () => {
  const { formatIsoUtc, executionArchiveTimestampJst } = await load('domain/time-policy.js');
  for (const date of [
    '2000-02-29T23:59:59.999Z',
    '2024-12-31T23:59:59.001Z',
    '2026-10-08T00:00:00.000Z',
  ])
    assert.equal(formatIsoUtc(Date.parse(date)), date);
  assert.equal(executionArchiveTimestampJst('2024-12-31T23:59:59.000Z'), '20250101_085959');
});

test('AI stage task reserves before planning and failed input validation cannot launch', async () => {
  const f = await setup();
  const { AgentTaskUseCases } = await load('application/agent-task-use-cases.js');
  const events = [];
  const runtime = {
    reserve: async () => {
      events.push('reserve');
      return { job: { id: 'j', status: 'reserved' }, acquired: true };
    },
    fail: async () => events.push('fail'),
    available: async () => {
      events.push('available');
      return true;
    },
    launch: async () => {
      events.push('launch');
      return { id: 'j', status: 'running' };
    },
  };
  const tasks = new AgentTaskUseCases(
    f.projects,
    {
      read: async () => {
        events.push('catalog');
        return f.catalogs.value;
      },
    },
    runtime,
  );
  await assert.rejects(tasks.start(actor, { projectId: 'p', stage: 'models', provider: 'codex' }));
  assert.deepEqual(events, ['reserve', 'catalog', 'fail']);
  f.projects.state.artifacts.story = {
    key: 'story',
    status: 'confirmed',
    content: 'Story',
    validation: { valid: true, issues: [] },
  };
  f.projects.state.artifacts.models = {
    key: 'models',
    status: 'confirmed',
    content: JSON.stringify(f.models),
    validation: { valid: true, issues: [] },
  };
  events.length = 0;
  await tasks.start(actor, { projectId: 'p', stage: 'models', provider: 'codex' });
  assert.deepEqual(events, ['reserve', 'catalog', 'available', 'launch']);
});
test('new Run creation rejects execution destination changes during Preflight', async () => {
  const f = await creationFixture();
  let count = 0;
  f.ports.capture = async () => ({
    ...structuredClone(f.snapshot),
    remote: { provider: 'vastai', instanceId: ++count },
  });
  await assert.rejects(
    f.createExecutionRun(f.ports, f.ports.preflight),
    /changed during Preflight/,
  );
  assert.deepEqual(f.calls, ['lock', 'unlock']);
});
test('Local output verification owns count and authenticated byte fingerprint rules', async () => {
  const { verifyGeneratedLocalOutputs } = await load('application/local-output-verification.js');
  const hash = (v) => JSON.stringify(v),
    run = { snapshot: { runIdentity: 'r' }, progress: { overall: { total: 1 } }, evidence: [] };
  const data = { relativePath: 'branch/a.png', size: 3, sha256: 'a' };
  run.evidence.push({
    id: 'e',
    kind: 'CUSTOM',
    scope: 'local-generated-file',
    runIdentity: 'r',
    data,
    fingerprint: hash({ runIdentity: 'r', kind: 'CUSTOM', scope: 'local-generated-file', data }),
  });
  const actual = { isFile: true, size: 3, sha256: 'a' };
  assert.equal((await verifyGeneratedLocalOutputs(run, hash, async () => actual)).count, 1);
  await assert.rejects(
    verifyGeneratedLocalOutputs(run, hash, async () => ({ ...actual, sha256: 'changed' })),
    /modified/,
  );
  run.evidence[0].data.relativePath = 'foreign';
  await assert.rejects(
    verifyGeneratedLocalOutputs(run, hash, async () => actual),
    /expected 1/,
  );
});
test('Marketplace generation commits only unchanged inputs, then cleans tracked prior outputs', async () => {
  const { generateMarketplaceOutputs } = await load('application/marketplace-generation.js');
  const { createDefaultMarketplaceImageState } = await load('domain/marketplace-editor-policy.js');
  const target = {
      id: 't',
      service: 'site',
      fileName: 'image',
      width: 10,
      height: 10,
      label: 'Image',
    },
    state = createDefaultMarketplaceImageState([target]);
  state.sourceImagePath = 'asset:source';
  state.targets.t.crop = { x: 0, y: 0, width: 20, height: 20 };
  const source = { path: 'asset:source', size: 3, mtimeMs: 1, sha256: 'a' },
    events = [];
  let changed = false;
  const io = {
    targets: async () => [target],
    writeState: async () => {},
    readState: async () => state,
    loadSource: async () => ({
      resolved: 'asset:source',
      image: {},
      size: { width: 20, height: 20 },
    }),
    fingerprint: async () => ({ ...source, sha256: changed ? 'changed' : 'a' }),
    outputDirectory: async () => 'asset:output',
    join: (...p) => p.join('/'),
    readManifest: async () => null,
    removeManifest: async () => events.push('invalidate'),
    writeManifest: async () => events.push('commit'),
    encode: async () => new Uint8Array([1, 2, 3]),
    writeImage: async () => events.push('write'),
    hashBytes: () => 'b',
    nextId: () => 'generation',
    now: () => 'now',
    cleanupTrackedOutput: async () => {
      events.push('cleanup');
      return null;
    },
  };
  await generateMarketplaceOutputs(io, 'p', state);
  assert.deepEqual(events, ['invalidate', 'write', 'commit']);
  events.length = 0;
  io.encode = async () => {
    changed = true;
    return new Uint8Array([1]);
  };
  await assert.rejects(generateMarketplaceOutputs(io, 'p', state));
  assert.deepEqual(events, []);
});

test('Thumbnail output commits its manifest before deleting an unchanged previous format', async () => {
  const { exportThumbnailOutput } = await load('application/thumbnail-output-generation.js');
  const { trackedOutputMatches, sameObservedFile } = await load('domain/output-tracking-policy.js');
  const events = [],
    manifest = {
      schemaVersion: 1,
      outputs: { 1: { fileName: 'thumbnail-01.jpg', size: 3, sha256: 'old' } },
    };
  const io = {
    directory: async () => 'asset:output',
    join: (...p) => p.join('/'),
    exclusive: async (_p, work) => work(),
    readManifest: async () => manifest,
    writeManifest: async () => events.push('commit'),
    writeImage: async () => events.push('write'),
    hash: () => 'new',
    cleanup: async () => {
      events.push('cleanup');
      return null;
    },
  };
  await exportThumbnailOutput(io, 'p', 1, 'png', new Uint8Array([1, 2, 3]));
  assert.deepEqual(events, ['write', 'commit', 'cleanup']);
  assert.equal(manifest.outputs[1].fileName, 'thumbnail-01.png');
  assert.equal(
    trackedOutputMatches({ size: 3, sha256: 'a' }, { isFile: true, size: 3, sha256: 'changed' }),
    false,
  );
  const observed = { isFile: true, size: 3, dev: 1, ino: 2, mtimeMs: 1, ctimeMs: 1 };
  assert.equal(sameObservedFile(observed, { ...observed, ino: 3 }), false);
});
test('Prompt Plan patch task uses the exact stored base text without CLI-specific paths', async () => {
  const f = await setup();
  const { AgentTaskUseCases } = await load('application/agent-task-use-cases.js');
  const hash = (s) => require('node:crypto').createHash('sha256').update(s).digest('hex');
  f.projects.state.artifacts.models = {
    key: 'models',
    content: JSON.stringify(f.models),
    status: 'confirmed',
    validation: { valid: true, issues: [] },
  };
  const raw = JSON.stringify(f.plan, null, 2);
  f.projects.state.artifacts.promptPlan = {
    key: 'promptPlan',
    content: raw,
    status: 'confirmed',
    validation: { valid: true, issues: [] },
  };
  const tasks = new AgentTaskUseCases(f.projects, f.catalogs, {}, { text: hash });
  const plan = await tasks.prepare(actor, {
    projectId: 'p',
    stage: 'prompt-plan-patch',
    provider: 'codex',
  });
  assert.ok(plan.prompt.includes(hash(raw)));
  assert.doesNotMatch(plan.prompt, /input\/1-|Codex Pane/);
  assert.equal(plan.attachments[0].resourceId, 'prompt-plan');
});
