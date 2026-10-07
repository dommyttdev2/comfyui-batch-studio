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
  const app = new ProjectUseCases(projects, catalogs, { now: () => 1 }, { next: () => 'id' });
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
  const run = await f.createExecutionRun(f.ports);
  assert.equal(run.progress.overall.total, 1);
  assert.equal(run.progress.branches[0].total, 1);
  assert.equal(f.count(), 3);
  assert.deepEqual(f.calls, ['lock', 'snapshot', 'write', 'current', 'unlock']);
});
test('a blocked Preflight cannot create a Run or snapshot', async () => {
  const f = await creationFixture();
  f.ports.preflight = async () => ({ state: 'BLOCKED', blocking: [{ message: 'blocked' }] });
  await assert.rejects(f.createExecutionRun(f.ports), /BLOCKED/);
  assert.deepEqual(f.calls, ['lock', 'unlock']);
});
test('changes during Preflight reject Run creation before snapshot copying', async () => {
  const f = await creationFixture();
  let n = 0;
  f.ports.capture = async () => ({ ...structuredClone(f.snapshot), runIdentity: String(n++) });
  await assert.rejects(f.createExecutionRun(f.ports), /changed during Preflight/);
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
  await assert.rejects(f.createExecutionRun(f.ports), /SOURCE_CHANGED/);
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
    project: async () => project,
    exists: async (name) => name === 'story.md' || Object.hasOwn(documents, name),
    json: async (name) => documents[name] ?? null,
    catalog: async () => f.catalogs.value,
    availability: async () => ({
      executionTarget: 'local',
      rows: [],
      validation: { valid: true, issues: [] },
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
  let stored = await f.createExecutionRun(f.ports);
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
