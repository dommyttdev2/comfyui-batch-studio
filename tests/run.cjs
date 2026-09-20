const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-tests-runtime-'));
const tscBin = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(
  process.execPath,
  [tscBin, '-p', path.join(repo, 'tsconfig.electron.json'), '--outDir', runtime],
  { cwd: repo, stdio: 'inherit' },
);
fs.cpSync(path.join(repo, 'templates'), path.join(runtime, 'templates'), { recursive: true });
const load = (relative) => import(pathToFileURL(path.join(runtime, 'main', relative)).href);

const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
};
const sha = (s) => crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
function models() {
  return {
    schemaVersion: 1,
    catalog: { schemaVersion: 1, generation: 1, generatedAt: '2026-09-08T00:00:00Z' },
    checkpoint: {
      ref: 'checkpoint.main',
      modelId: 1,
      modelName: 'Checkpoint',
      versionId: 2,
      versionName: 'v1',
      fileId: 3,
      fileName: 'checkpoint.safetensors',
      modelUrl: 'https://example.com/models/1',
      trainedWords: [],
      reason: 'test',
    },
    loras: [
      {
        ref: 'lora.character',
        modelId: 10,
        modelName: 'Character',
        versionId: 20,
        versionName: 'v1',
        fileId: 30,
        fileName: 'character.safetensors',
        modelUrl: 'https://example.com/models/10',
        trainedWords: ['character'],
        reason: 'test',
        strengthBaseline: {
          value: 0.7,
          provenance: {
            source: 'civitai',
            basis: 'observed-usage-derived',
            method: 'median-of-post-medians:newest-200',
            sampleCount: 5,
          },
        },
      },
    ],
  };
}
function plan() {
  return {
    schemaVersion: 1,
    common: { positive: 'quality', negative: 'bad' },
    rootLoras: [{ modelRef: 'lora.character', strengthModel: 0.7, strengthClip: 0.7 }],
    branches: [
      {
        id: 'b01',
        label: 'One',
        loras: [],
        leaves: [
          { id: 'l01', name: 'one', positive: 'p1', negative: 'n1' },
          { id: 'l02', name: 'two', positive: 'p2', negative: 'n2' },
        ],
      },
      {
        id: 'b02',
        label: 'Two',
        loras: [],
        leaves: [{ id: 'l03', name: 'three', positive: 'p3', negative: 'n3' }],
      },
    ],
  };
}

(async () => {
  const [validation, artifacts, compiler, scan, grok, availability, preflight, navigation] =
    await Promise.all([
      load('validation.js'),
      load('artifact-service.js'),
      load('compiler.js'),
      load('project-scan.js'),
      load('grok-context.js'),
      load('availability.js'),
      load('preflight.js'),
      load('grok-navigation.js'),
    ]);
  assert.equal(navigation.isGrokNavigationUrl('https://grok.com/'), true, 'Grok must stay in app');
  assert.equal(
    navigation.isGrokNavigationUrl('https://accounts.google.com/o/oauth2/v2/auth'),
    true,
    'Google OAuth must stay in app',
  );
  assert.equal(
    navigation.isOAuthPopupUrl('https://accounts.google.com/o/oauth2/v2/auth'),
    true,
    'Google OAuth popup must use Grok session',
  );
  assert.equal(
    navigation.isGrokNavigationUrl('https://example.com/'),
    false,
    'unrelated sites must not navigate inside Grok pane',
  );
  assert.equal(
    navigation.isSafeExternalUrl('javascript:alert(1)'),
    false,
    'non-http URLs must not be opened externally',
  );

  const brief = {
    project: { id: 'sample-project', title: 'Sample' },
    subject: { copyrightedCharacter: false, characterName: '', series: '' },
    audience: 'visual focus',
    request: '',
    exclusions: '',
    assumptions: { adultCharacters: true, consensual: true },
    generation: { target_image_count: 3, modelFamily: 'Illustrious' },
    references: [],
  };
  assert.equal(validation.validateProjectBrief(brief).valid, true, 'valid project brief must pass');
  assert.equal(
    validation.validateProjectBrief({ ...brief, audience: '' }).valid,
    false,
    'audience is required',
  );
  assert.equal(
    validation.validateProjectBrief({
      ...brief,
      subject: { ...brief.subject, copyrightedCharacter: true, characterName: '' },
    }).valid,
    false,
    'copyrighted character name is required',
  );
  assert.equal(
    validation.validateProjectBrief({
      ...brief,
      assumptions: { adultCharacters: false, consensual: false },
    }).valid,
    false,
    'adult/consent confirmation is required',
  );

  const manifest = JSON.parse(
    fs.readFileSync(path.join(repo, 'templates/default-scene-batch/manifest.json'), 'utf8'),
  );
  const templateRaw = fs.readFileSync(
    path.join(repo, 'templates/default-scene-batch/template.json'),
    'utf8',
  );
  assert.equal(
    validation.validateWorkflowManifest(manifest).valid,
    true,
    'built-in manifest must be valid',
  );
  assert.equal(manifest.template.sha256, sha(templateRaw), 'template SHA must match manifest');
  const badManifest = structuredClone(manifest);
  badManifest.unknown = true;
  assert.equal(
    validation.validateWorkflowManifest(badManifest).valid,
    false,
    'unknown manifest fields must fail',
  );
  const p = plan();
  p.branches[0].leaves[0].unknown = true;
  assert.equal(
    validation.validatePromptPlan(p, models()).valid,
    false,
    'unknown Prompt Plan fields must fail',
  );

  const testBase = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-project-parent-'));
  const projectDestination = path.join(testBase, '15_damon-slayer_kocho-shinobu');
  const root = path.join(projectDestination, 'project-o6a4d6');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(root, '._batch_studio', 'drafts'), { recursive: true });
  fs.mkdirSync(path.join(root, '._batch_studio', 'history'), { recursive: true });
  writeJson(path.join(root, 'project_brief.json'), {
    schemaVersion: 1,
    project: { id: 'test', title: 'Test' },
    subject: { copyrightedCharacter: true, characterName: 'Character', series: 'Series' },
    audience: 'test',
    request: 'test',
    exclusions: '',
    assumptions: { adultCharacters: true, consensual: true },
    generation: { target_image_count: 3, modelFamily: 'Illustrious' },
    references: [],
  });
  const catalogPath = path.join(root, 'model_catalog.json');
  writeJson(catalogPath, {
    schemaVersion: 1,
    generation: 1,
    generatedAt: '2026-09-08T00:00:00Z',
    collections: [
      {
        id: 1,
        name: 'test',
        items: [
          {
            modelId: 1,
            modelName: 'Checkpoint',
            versionId: 2,
            versionName: 'v1',
            files: [{ id: 3, name: 'checkpoint.safetensors' }],
            versions: [
              {
                versionId: 2,
                versionName: 'v1',
                files: [{ id: 3, name: 'checkpoint.safetensors' }],
              },
            ],
          },
          {
            modelId: 10,
            modelName: 'Character',
            versionId: 20,
            versionName: 'v1',
            files: [{ id: 30, name: 'character.safetensors' }],
            versions: [
              {
                versionId: 20,
                versionName: 'v1',
                files: [{ id: 30, name: 'character.safetensors' }],
              },
            ],
          },
        ],
      },
    ],
  });
  writeJson(path.join(root, 'project_meta.json'), {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    settings: { catalogPath },
  });
  fs.writeFileSync(path.join(root, 'story.md'), 'story\n');
  writeJson(path.join(root, 'models.json'), models());
  writeJson(path.join(root, 'prompt_plan.json'), plan());
  const modelTask = await grok.buildGrokTask(root, 'models');
  assert.match(modelTask.prompt, /missingRequirements/);
  assert.match(modelTask.prompt, /model_catalog\.json/);
  const planTask = await grok.buildGrokTask(root, 'prompt-plan');
  assert.match(planTask.prompt, /1 Leaf = 1 image/);
  assert.match(planTask.prompt, /3 枚/);
  assert.match(planTask.prompt, /全Branchで id、非空のlabel、loras配列、leaves配列/);
  assert.match(planTask.prompt, /全Leafで id、非空のname、prompt/);
  assert.match(planTask.prompt, /各画像で構図・視線が変わるなら/);
  assert.match(planTask.prompt, /## Schema v2 JSON構造/);
  assert.ok(
    !planTask.attachments.some((file) => file.name === 'prompt_plan.json'),
    'A new Prompt Plan must not inherit a previous plan',
  );
  const invalidDraft = {
    schemaVersion: 2,
    triggerWordsMode: 'selected',
    common: { positive: {}, negative: {} },
    rootLoras: [],
    branches: [
      {
        id: 'b01',
        loras: [],
        prompt: { positive: { camera: { framing: ['medium_shot'] } }, negative: {} },
        leaves: [
          {
            id: 'l01',
            prompt: { positive: { camera: { framing: ['close-up'] } }, negative: {} },
          },
        ],
      },
    ],
  };
  const promptDraftPath = path.join(root, '._batch_studio', 'drafts', 'prompt_plan.json');
  writeJson(promptDraftPath, invalidDraft);
  const fixTask = await grok.buildGrokTask(root, 'prompt-plan-fix');
  assert.ok(
    fixTask.attachments.some(
      (file) => file.name === 'prompt_plan.json' && file.path === promptDraftPath && file.exists,
    ),
    'Fix task must attach the actual current Prompt Plan draft',
  );
  assert.match(fixTask.prompt, /BRANCH_LABEL: 1件/);
  assert.match(fixTask.prompt, /LEAF_NAME: 1件/);
  assert.match(fixTask.prompt, /CAMERA_FRAMING_CONFLICT: 1件/);
  assert.match(fixTask.prompt, /正常なBranch\/Leafのid・順序・内容を維持/);
  const codexTaskPrompt = fixTask.prompt
    .replace(grok.artifactFileOutputRules('prompt_plan.json'), '')
    .replaceAll('Grok', 'Codex');
  assert.doesNotMatch(codexTaskPrompt, /## 出力契約/);
  assert.match(codexTaskPrompt, /## Schema v2 JSON構造/);
  assert.match(codexTaskPrompt, /"label": "人間向け表示名"/);
  assert.match(codexTaskPrompt, /"name": "S1-01_C1_example"/);
  assert.match(codexTaskPrompt, /CAMERA_FRAMING_CONFLICT: 1件/);
  fs.unlinkSync(promptDraftPath);
  const old = Date.now() - 10000;
  for (const [idx, name] of [
    'project_brief.json',
    'story.md',
    'models.json',
    'prompt_plan.json',
  ].entries())
    fs.utimesSync(path.join(root, name), new Date(old + idx * 1000), new Date(old + idx * 1000));

  const modelRoot = path.join(root, 'local-models');
  fs.mkdirSync(modelRoot, { recursive: true });
  fs.writeFileSync(path.join(modelRoot, 'checkpoint.safetensors'), '');
  fs.writeFileSync(path.join(modelRoot, 'character.safetensors'), '');
  let currentMeta = JSON.parse(fs.readFileSync(path.join(root, 'project_meta.json'), 'utf8'));
  currentMeta.settings.comfyModelsRoot = modelRoot;
  writeJson(path.join(root, 'project_meta.json'), currentMeta);
  fs.writeFileSync(path.join(root, 'LoRA_test.json'), 'legacy workflow\n');
  const originalCwd = process.cwd();
  const foreignCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-foreign-cwd-'));
  let result;
  process.chdir(foreignCwd);
  try {
    result = await compiler.compileWorkflow(root);
  } finally {
    process.chdir(originalCwd);
  }
  assert.equal(result.branchCount, 2);
  assert.equal(result.imageCount, 3);
  assert.equal(result.validation.valid, true);
  const expectedWorkflow = path.join(root, 'LoRA_15_damon-slayer_kocho-shinobu.json');
  assert.equal(result.outputPath, expectedWorkflow);
  assert.equal(fs.existsSync(expectedWorkflow), true);
  assert.equal(
    fs.existsSync(path.join(root, 'LoRA_test.json')),
    false,
    'legacy project-id workflow must be removed',
  );
  const compiled = JSON.parse(fs.readFileSync(expectedWorkflow, 'utf8'));
  const nodeIds = compiled.nodes.map((n) => n.id),
    linkIds = compiled.links.map((l) => l[0]),
    groupIds = (compiled.groups ?? []).map((g) => g.id);
  assert.equal(new Set(nodeIds).size, nodeIds.length, 'compiled node ids must be unique');
  assert.equal(new Set(linkIds).size, linkIds.length, 'compiled link ids must be unique');
  assert.equal(new Set(groupIds).size, groupIds.length, 'compiled group ids must be unique');
  assert.equal(compiled.last_node_id, Math.max(...nodeIds));
  assert.equal(compiled.last_link_id, Math.max(...linkIds));
  const counters = compiled.nodes.filter((n) => n.type === 'ScenePromptCounter');
  assert.equal(counters.length, 2);
  assert.ok(
    counters.every((n) => n.widgets_values?.[0] === 1),
    'all branch counters must equal 1',
  );
  let summary = await scan.scanProject(root);
  assert.equal(summary.artifacts.find((a) => a.key === 'workflow').state, 'generated');
  let pf = await preflight.runPreflight(root);
  assert.equal(pf.state, 'READY', 'all local model files should be READY');
  fs.unlinkSync(path.join(modelRoot, 'character.safetensors'));
  const r2Index = path.join(root, 'r2-index.json');
  writeJson(r2Index, ['models/character.safetensors']);
  currentMeta = JSON.parse(fs.readFileSync(path.join(root, 'project_meta.json'), 'utf8'));
  currentMeta.settings.r2IndexPath = r2Index;
  writeJson(path.join(root, 'project_meta.json'), currentMeta);
  const av = await availability.checkAvailability(root);
  assert.equal(av.rows.find((r) => r.ref === 'lora.character').state, 'transfer-required');
  assert.equal(av.validation.valid, false, 'transfer-required model must block readiness');
  pf = await preflight.runPreflight(root);
  assert.equal(pf.state, 'BLOCKED', 'R2-only model must block Preflight');
  fs.writeFileSync(path.join(modelRoot, 'character.safetensors'), '');

  const briefBeforeFamily = JSON.parse(
    fs.readFileSync(path.join(root, 'project_brief.json'), 'utf8'),
  );
  delete briefBeforeFamily.schemaVersion;
  await artifacts.saveProjectBrief(root, {
    ...briefBeforeFamily,
    generation: { ...briefBeforeFamily.generation, modelFamily: 'illustrious' },
  });
  summary = await scan.scanProject(root);
  assert.notEqual(
    summary.artifacts.find((a) => a.key === 'story').state,
    'stale',
    'modelFamily-only brief update must not stale story',
  );
  assert.notEqual(
    summary.artifacts.find((a) => a.key === 'models').state,
    'stale',
    'modelFamily-only brief update must not stale models',
  );
  assert.notEqual(
    summary.artifacts.find((a) => a.key === 'promptPlan').state,
    'stale',
    'modelFamily-only brief update must not stale prompt plan',
  );
  assert.equal(
    summary.artifacts.find((a) => a.key === 'workflow').state,
    'generated',
    'modelFamily-only brief update must not stale workflow',
  );
  const briefMtimeBeforeNoop = fs.statSync(path.join(root, 'project_brief.json')).mtimeMs;
  await new Promise((resolve) => setTimeout(resolve, 20));
  await artifacts.saveProjectBrief(root, {
    ...briefBeforeFamily,
    generation: { ...briefBeforeFamily.generation, modelFamily: 'illustrious' },
  });
  assert.equal(
    fs.statSync(path.join(root, 'project_brief.json')).mtimeMs,
    briefMtimeBeforeNoop,
    'no-op brief save must not rewrite project_brief.json',
  );
  const modelsBeforeProvenance = JSON.parse(
    fs.readFileSync(path.join(root, 'models.json'), 'utf8'),
  );
  writeJson(path.join(root, 'models.json'), {
    ...modelsBeforeProvenance,
    catalog: {
      ...modelsBeforeProvenance.catalog,
      generation: 0,
      generatedAt: '2026-09-01T00:00:00Z',
    },
  });
  summary = await scan.scanProject(root);
  assert.notEqual(
    summary.artifacts.find((a) => a.key === 'promptPlan').state,
    'stale',
    'catalog provenance refresh must not stale prompt plan',
  );
  assert.equal(
    summary.artifacts.find((a) => a.key === 'workflow').state,
    'generated',
    'catalog provenance refresh must not stale workflow',
  );
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(root, 'models.json'), 'utf8')).catalog.generation,
    1,
    'catalog provenance may still refresh without invalidating downstream',
  );

  const altered = path.join(root, 'altered-template.json');
  const template = JSON.parse(templateRaw);
  template.extra = { changed: true };
  writeJson(altered, template);
  const meta = JSON.parse(fs.readFileSync(path.join(root, 'project_meta.json'), 'utf8'));
  meta.settings.templatePath = altered;
  writeJson(path.join(root, 'project_meta.json'), meta);
  summary = await scan.scanProject(root);
  assert.equal(summary.artifacts.find((a) => a.key === 'workflow').state, 'stale');
  pf = await preflight.runPreflight(root);
  assert.equal(pf.state, 'BLOCKED', 'stale workflow must block Preflight');
  const artifactSection = pf.sections.find((section) => section.name === 'Artifact整合性');
  assert.ok(artifactSection, 'stale artifact blockers must be represented as a visible section');
  assert.equal(artifactSection.valid, false);
  assert.ok(
    artifactSection.issues.some(
      (issue) => issue.code === 'ARTIFACT_STALE' && issue.path === 'workflow',
    ),
  );

  const draftRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-drafts-'));
  fs.mkdirSync(path.join(draftRoot, '._batch_studio', 'drafts'), { recursive: true });
  fs.mkdirSync(path.join(draftRoot, '._batch_studio', 'history'), { recursive: true });
  fs.writeFileSync(path.join(draftRoot, '._batch_studio', 'drafts', 'story.md'), 'new story\n');
  await artifacts.confirmArtifact(draftRoot, 'story');
  assert.equal(
    fs.existsSync(path.join(draftRoot, '._batch_studio', 'drafts', 'story.md')),
    false,
    'confirmed draft must be cleared',
  );
  const unresolved = {
    ...models(),
    missingRequirements: [{ role: 'pose', requirement: 'pose LoRA', reason: 'not found' }],
  };
  await artifacts.saveDraft(draftRoot, 'models', JSON.stringify(unresolved));
  await assert.rejects(() => artifacts.confirmArtifact(draftRoot, 'models'), /検証エラー/);
  const emptyMissing = { ...models(), missingRequirements: [] };
  const emptyDraft = await artifacts.saveDraft(draftRoot, 'models', JSON.stringify(emptyMissing));
  assert.equal(
    emptyDraft.validation.valid,
    false,
    'draft-only missingRequirements must not enter confirmed schema',
  );
  await assert.rejects(() => artifacts.confirmArtifact(draftRoot, 'models'), /検証エラー/);
  assert.equal(
    validation.validateModels(emptyMissing).valid,
    false,
    'formal models validator must reject missingRequirements',
  );

  console.log('All Batch Studio tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
