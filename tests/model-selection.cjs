const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-model-selection-runtime-'));
const tscBin = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
const modelStageUi = fs.readFileSync(path.join(repo, 'src/renderer/GrokStages.tsx'), 'utf8');
const explorerUi = fs.readFileSync(path.join(repo, 'src/renderer/CivitExplorerStage.tsx'), 'utf8');
const modelPickerUi = fs.readFileSync(path.join(repo, 'src/renderer/ModelPicker.tsx'), 'utf8');
const loraHistoryUi = fs.readFileSync(path.join(repo, 'src/renderer/GrokLoraHistory.tsx'), 'utf8');
const selectedCardsUi = fs.readFileSync(
  path.join(repo, 'src/renderer/SelectedModelCards.tsx'),
  'utf8',
);
assert.match(
  modelStageUi,
  /<SelectedModelCards/,
  'model stage must expose editable current selections',
);
assert.match(
  selectedCardsUi,
  /変更を下書きへ保存/,
  'manual selection must have an explicit save action',
);
assert.match(
  selectedCardsUi,
  /civit-model-card/,
  'manual selection must reuse Civit Explorer cards',
);
assert.match(
  modelStageUi,
  /artifact\.saveDraft\(/,
  'manual version updates must persist models draft',
);
assert.match(
  modelStageUi,
  /artifact\.confirm\(/,
  'manual changes must still require models confirmation',
);
assert.match(
  modelStageUi,
  /Civitai モデルカタログを更新/,
  'model selection must expose a Civitai catalog sync action',
);
assert.match(
  modelStageUi,
  /catalog\.sync\(\)/,
  'model selection sync must reuse the existing catalog sync API',
);
assert.match(
  modelStageUi,
  /catalog\.integratedStatus\(\)/,
  'model selection must poll the existing integrated sync status',
);
assert.match(
  modelStageUi,
  /catalog\.snapshot\(\)/,
  'model selection must refresh the catalog snapshot after sync',
);
assert.match(
  modelStageUi,
  /catalog\.status\(project\.rootPath\)/,
  'model selection must refresh the registered model count after sync',
);
assert.match(
  modelStageUi,
  /syncStatus\?\.state\s*===\s*['"]running['"]/,
  'model selection must expose sync progress while the catalog is updating',
);
assert.match(
  modelStageUi,
  /!syncStatus\.apiKeyConfigured/,
  'catalog sync must be disabled when the Civitai API key is not configured',
);
assert.match(
  explorerUi,
  /MODEL \/ BASE MODEL \/ FILE \/ TRIGGER/,
  'Civit Explorer must expose Base Model as searchable metadata',
);
assert.match(
  explorerUi,
  /<span>Base Model<\/span>\s*<b>\{baseModel\s*\?\?\s*['"]—['"]\}<\/b>/,
  'Civit Explorer must show the selected version Base Model',
);
assert.match(
  modelPickerUi,
  /placeholder="モデル名・Version・Base Model・File名を検索"/,
  'Civitai model picker search must include Base Model',
);
assert.match(
  modelPickerUi,
  /model-picker-static-field">\s*<span>Base Model<\/span>/,
  'Civitai model picker must show Base Model independently from Version',
);
assert.match(
  modelStageUi,
  /Base Model:\s*\{baseModel\s*\?\?\s*['"]—['"]\}/,
  'selected Checkpoint summary must show Base Model',
);
assert.match(
  loraHistoryUi,
  /Base Model:\s*\{catalogMatch\?\.baseModel\s*\?\?\s*['"]—['"]\}/,
  'Grok LoRA history must show Base Model',
);
execFileSync(
  process.execPath,
  [tscBin, '-p', path.join(repo, 'tsconfig.electron.json'), '--outDir', runtime],
  { cwd: repo, stdio: 'inherit' },
);
const load = (relative) => import(pathToFileURL(path.join(runtime, relative)).href);
const file = (id, type = 'Model') => ({ id, name: `file-${id}.safetensors`, type });
const item = (modelId, modelType, baseModel = 'Anima', files = [file(modelId * 10)]) => ({
  modelId,
  modelName: `${modelType}-${modelId}`,
  modelType,
  versionId: modelId * 100,
  versionName: 'v1',
  files,
  versions: [{ versionId: modelId * 100, versionName: 'v1', baseModel, files }],
});
const selection = (ref, n) => ({
  ref,
  modelId: n,
  modelName: `m${n}`,
  versionId: n * 10,
  versionName: 'v1',
  fileId: n * 100,
  fileName: `m${n}.safetensors`,
  modelUrl: `https://civitai.com/models/${n}`,
  trainedWords: [],
  reason: 'user selected',
});
const modelFile = (ref, fileName) => ({ ref, fileName, reason: 'user selected' });
(async () => {
  const [
    { candidateVersions, itemMatchesRole },
    { catalogItemForSelection, replaceSelectedModelVersion },
    { validateModels },
    { readArtifact },
  ] = await Promise.all([
    load('shared/model-selection.js'),
    load('shared/model-version-change.js'),
    load('main/validation.js'),
    load('main/artifact-service.js'),
  ]);
  const checkpoint = item(1, 'Checkpoint'),
    textEncoder = item(2, 'TextEncoder'),
    clip = item(3, 'CLIP'),
    lora = item(4, 'LORA'),
    other = item(5, 'Other'),
    training = item(6, 'LORA', 'Anima', [file(60, 'Training Data')]);
  assert.equal(itemMatchesRole(checkpoint, 'checkpoint', 'anima'), true);
  assert.equal(itemMatchesRole(checkpoint, 'lora', 'anima'), false);
  assert.equal(itemMatchesRole(textEncoder, 'text_encoder', 'anima'), true);
  assert.equal(
    itemMatchesRole(clip, 'clip', 'anima'),
    true,
    'legacy v2 catalog role matching remains supported',
  );
  assert.equal(itemMatchesRole(lora, 'lora'), true);
  assert.equal(itemMatchesRole(lora, 'checkpoint', 'anima'), false);
  assert.equal(itemMatchesRole(other, 'checkpoint', 'anima'), false);
  assert.equal(
    itemMatchesRole(training, 'lora'),
    false,
    'training data must not leak into LoRA candidates',
  );
  assert.equal(
    candidateVersions(item(7, 'Checkpoint', 'Illustrious'), 'checkpoint', 'anima').length,
    0,
    'wrong model family must be hidden',
  );
  const legacyCheckpoint = {
    modelId: 8,
    modelName: 'Legacy Checkpoint',
    modelType: 'Checkpoint',
    versionId: 800,
    versionName: 'legacy',
    baseModel: 'Illustrious',
    files: [file(80)],
  };
  const legacyMatches = candidateVersions(legacyCheckpoint, 'checkpoint', 'illustrious');
  assert.equal(
    legacyMatches.length,
    1,
    'legacy catalog entries without versions must remain selectable',
  );
  assert.equal(
    legacyMatches[0].version.baseModel,
    'Illustrious',
    'legacy item Base Model must be copied into the synthetic version',
  );
  assert.equal(
    candidateVersions(legacyCheckpoint, 'checkpoint', 'anima').length,
    0,
    'legacy item Base Model must still participate in family filtering',
  );
  const oldFile = { id: 91, name: 'old.safetensors', type: 'Model' };
  const newFile = { id: 92, name: 'new.safetensors', type: 'Model', primary: true };
  const alternateFile = { id: 93, name: 'alternate.safetensors', type: 'Model' };
  const versionedItem = {
    modelId: 9,
    modelName: 'Versioned LoRA',
    modelType: 'LORA',
    versionId: 901,
    versionName: 'old',
    files: [oldFile],
    trainedWords: ['old trigger'],
    strengthBaseline: { value: 0.3, provenance: { source: 'civitai', basis: 'creator-declared' } },
    versions: [
      { versionId: 901, versionName: 'old', files: [oldFile], trainedWords: ['old trigger'] },
      {
        versionId: 902,
        versionName: 'new',
        baseModel: 'Illustrious',
        files: [newFile, alternateFile],
        trainedWords: ['new trigger'],
        strengthBaseline: {
          value: 0.8,
          provenance: { source: 'civitai', basis: 'creator-declared' },
        },
      },
      {
        versionId: 903,
        versionName: 'no model weights',
        files: [{ id: 94, name: 'training.zip', type: 'Training Data' }],
      },
    ],
  };
  const original = {
    ref: 'lora.character',
    modelId: 9,
    modelName: 'Versioned LoRA',
    versionId: 901,
    versionName: 'old',
    fileId: 91,
    fileName: 'old.safetensors',
    modelUrl: 'https://civitai.com/models/9?modelVersionId=901',
    trainedWords: ['old trigger'],
    reason: 'Grok selected',
    strengthBaseline: versionedItem.strengthBaseline,
  };
  const editableCatalog = {
    collections: [{ id: 1, name: 'Test', items: [versionedItem] }],
  };
  assert.equal(
    catalogItemForSelection(editableCatalog, original, 'lora'),
    versionedItem,
    'selected model must resolve by its model identity',
  );
  const changedVersion = replaceSelectedModelVersion(original, versionedItem, 'lora', 902);
  assert.equal(changedVersion.ref, original.ref, 'manual changes must preserve LoRA ref');
  assert.equal(changedVersion.modelId, original.modelId);
  assert.equal(changedVersion.versionId, 902);
  assert.equal(changedVersion.versionName, 'new');
  assert.equal(changedVersion.fileId, 92, 'version change should pick its primary model weight');
  assert.equal(changedVersion.fileName, 'new.safetensors');
  assert.deepEqual(changedVersion.trainedWords, ['new trigger']);
  assert.equal(changedVersion.strengthBaseline.value, 0.8);
  assert.equal(changedVersion.modelUrl, 'https://civitai.com/models/9?modelVersionId=902');
  assert.equal(original.versionId, 901, 'original selection must not be mutated');
  const changedFile = replaceSelectedModelVersion(original, versionedItem, 'lora', 902, 93);
  assert.equal(changedFile.fileName, 'alternate.safetensors');
  assert.throws(
    () => replaceSelectedModelVersion(original, versionedItem, 'lora', 902, 91),
    /指定したファイル/,
    'file from previous version must not be reused',
  );
  assert.throws(
    () => replaceSelectedModelVersion(original, versionedItem, 'lora', 903),
    /指定したバージョン/,
    'version without model weights must not be selectable',
  );
  assert.throws(
    () => replaceSelectedModelVersion(original, versionedItem, 'lora', 999),
    /指定したバージョン/,
  );
  assert.throws(
    () => replaceSelectedModelVersion(original, { ...versionedItem, modelId: 10 }, 'lora', 902),
    /別のモデル/,
  );
  const noBaseline = replaceSelectedModelVersion(changedVersion, versionedItem, 'lora', 901, 91);
  assert.equal(noBaseline.strengthBaseline?.value, 0.3);
  assert.deepEqual(noBaseline.trainedWords, ['old trigger']);
  const checkpointItem = {
    ...versionedItem,
    modelType: 'Checkpoint',
    versions: [
      {
        versionId: 902,
        versionName: 'new',
        baseModel: 'Illustrious',
        files: [newFile],
      },
    ],
  };
  assert.throws(
    () =>
      replaceSelectedModelVersion(original, checkpointItem, 'checkpoint', 902, undefined, 'anima'),
    /指定したバージョン/,
    'base model version changes must respect selected model family',
  );

  const catalog = { schemaVersion: 1, generation: 1, generatedAt: '2026-09-09T00:00:00Z' };
  const legacyV2 = {
    schemaVersion: 2,
    modelFamily: 'anima',
    catalog,
    checkpoint: selection('checkpoint.main', 1),
    textEncoder: selection('text_encoder.main', 2),
    clip: selection('clip.main', 3),
    loras: [],
  };
  assert.equal(validateModels(legacyV2).valid, true, 'schema v2 remains readable');
  const legacyV3 = {
    schemaVersion: 3,
    modelFamily: 'anima',
    catalog,
    checkpoint: selection('checkpoint.main', 1),
    textEncoder: modelFile('text_encoder.main', 't5.safetensors'),
    clip: modelFile('clip.main', 'clip_l.safetensors'),
    loras: [],
  };
  assert.equal(validateModels(legacyV3).valid, true, 'schema v3 remains readable for migration');
  const illustrious = {
    schemaVersion: 4,
    modelFamily: 'illustrious',
    catalog,
    checkpoint: selection('checkpoint.main', 1),
    loras: [],
  };
  assert.equal(validateModels(illustrious).valid, true);
  const animaMissing = {
    schemaVersion: 4,
    modelFamily: 'anima',
    catalog,
    checkpoint: selection('checkpoint.main', 1),
    loras: [],
  };
  let validation = validateModels(animaMissing);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((x) => x.code === 'ANIMA_TEXT_ENCODER_REQUIRED'));
  assert.ok(validation.issues.some((x) => x.code === 'ANIMA_VAE_REQUIRED'));
  const anima = {
    ...animaMissing,
    textEncoder: modelFile('text_encoder.main', 'vendor/t5xxl.safetensors'),
    vae: modelFile('vae.main', 'ae.safetensors'),
  };
  assert.equal(validateModels(anima).valid, true);
  validation = validateModels({
    ...anima,
    textEncoder: modelFile('text_encoder.main', '../escape.safetensors'),
  });
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((x) => x.code === 'MODEL_FILE_PATH'));
  validation = validateModels({ ...anima, vae: modelFile('vae.main', '../escape.safetensors') });
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((x) => x.code === 'MODEL_FILE_PATH'));
  validation = validateModels({ ...illustrious, vae: modelFile('vae.main', 'ae.safetensors') });
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((x) => x.code === 'ILLUSTRIOUS_EXTRA_ENCODERS'));

  const catalogRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-catalog-provenance-'));
  const catalogPath = path.join(catalogRoot, 'model_catalog.json');
  const checkpointFile = { id: 1010, name: 'checkpoint.safetensors', type: 'Model' };
  const loraFile = { id: 2020, name: 'lora.safetensors', type: 'Model' };
  const currentCatalog = {
    schemaVersion: 1,
    generation: 3,
    generatedAt: '2026-09-09T12:00:00Z',
    collections: [
      {
        id: 1,
        name: 'Tests',
        items: [
          {
            modelId: 101,
            modelName: 'Checkpoint 101',
            modelType: 'Checkpoint',
            versionId: 1001,
            versionName: 'v1',
            files: [checkpointFile],
            versions: [
              {
                versionId: 1001,
                versionName: 'v1',
                baseModel: 'Illustrious',
                files: [checkpointFile],
              },
            ],
          },
          {
            modelId: 202,
            modelName: 'LoRA 202',
            modelType: 'LoRA',
            versionId: 2002,
            versionName: 'v1',
            files: [loraFile],
            versions: [
              { versionId: 2002, versionName: 'v1', baseModel: 'Illustrious', files: [loraFile] },
            ],
          },
        ],
      },
    ],
  };
  fs.writeFileSync(catalogPath, JSON.stringify(currentCatalog, null, 2));
  process.env.BATCH_STUDIO_CATALOG_PATH = catalogPath;
  const selectedCheckpoint = {
    ref: 'checkpoint.main',
    modelId: 101,
    modelName: 'Checkpoint 101',
    versionId: 1001,
    versionName: 'v1',
    fileId: 1010,
    fileName: 'checkpoint.safetensors',
    modelUrl: 'https://civitai.com/models/101',
    trainedWords: [],
    reason: 'selected',
  };
  const selectedLora = {
    ref: 'lora.test',
    modelId: 202,
    modelName: 'LoRA 202',
    versionId: 2002,
    versionName: 'v1',
    fileId: 2020,
    fileName: 'lora.safetensors',
    modelUrl: 'https://civitai.com/models/202',
    trainedWords: [],
    reason: 'selected',
  };
  const staleModels = {
    schemaVersion: 4,
    modelFamily: 'illustrious',
    catalog: { schemaVersion: 1, generation: 2, generatedAt: '2026-09-09T11:00:00Z' },
    checkpoint: selectedCheckpoint,
    loras: [selectedLora],
  };
  const writeProject = (payload, { draft = false } = {}) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-model-provenance-project-'));
    fs.mkdirSync(path.join(root, '._batch_studio', 'drafts'), { recursive: true });
    fs.writeFileSync(
      draft
        ? path.join(root, '._batch_studio', 'drafts', 'models.json')
        : path.join(root, 'models.json'),
      JSON.stringify(payload, null, 2),
    );
    return root;
  };
  const validRoot = writeProject(staleModels);
  const refreshed = await readArtifact(validRoot, 'models', 'confirmed');
  assert.equal(
    refreshed.validation.valid,
    true,
    'valid stale identities must remain valid after provenance refresh',
  );
  assert.equal(
    JSON.parse(refreshed.content).catalog.generation,
    3,
    'successful identity revalidation must advance catalog generation',
  );
  assert.equal(
    JSON.parse(refreshed.content).catalog.generatedAt,
    currentCatalog.generatedAt,
    'catalog generatedAt must follow the current catalog',
  );
  assert.equal(
    refreshed.validation.issues.some((x) => x.code === 'CATALOG_GENERATION_CHANGED'),
    false,
    'successful provenance refresh must remove the recurring generation warning',
  );
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(validRoot, 'models.json'), 'utf8')).catalog.generation,
    3,
    'refreshed provenance must be persisted',
  );

  const invalidRoot = writeProject({ ...staleModels, loras: [{ ...selectedLora, fileId: 9999 }] });
  const invalidRead = await readArtifact(invalidRoot, 'models', 'confirmed');
  assert.equal(invalidRead.validation.valid, false, 'identity mismatch must remain invalid');
  assert.ok(
    invalidRead.validation.issues.some((x) => x.code === 'VERSION_FILE_NOT_FOUND'),
    'identity mismatch must still be reported',
  );
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(invalidRoot, 'models.json'), 'utf8')).catalog.generation,
    2,
    'failed identity revalidation must not advance provenance',
  );

  const draftRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-model-provenance-draft-'));
  fs.mkdirSync(path.join(draftRoot, '._batch_studio', 'drafts'), { recursive: true });
  fs.writeFileSync(path.join(draftRoot, 'models.json'), JSON.stringify(staleModels, null, 2));
  const draftPayload = {
    ...staleModels,
    promptFallbacks: [
      {
        requirement: 'test requirement',
        positive: 'test tag',
        negative: '',
        reason: 'prompt is sufficient',
      },
    ],
  };
  fs.writeFileSync(
    path.join(draftRoot, '._batch_studio', 'drafts', 'models.json'),
    JSON.stringify(draftPayload, null, 2),
  );
  await readArtifact(draftRoot, 'models', 'confirmed');
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(draftRoot, 'models.json'), 'utf8')).catalog.generation,
    2,
    'confirmed provenance must stay untouched while a draft exists',
  );
  const refreshedDraft = await readArtifact(draftRoot, 'models', 'draft');
  const refreshedDraftPayload = JSON.parse(refreshedDraft.content);
  assert.equal(
    refreshedDraftPayload.catalog.generation,
    3,
    'draft provenance must be refreshed when a draft exists',
  );
  assert.deepEqual(
    refreshedDraftPayload.promptFallbacks,
    draftPayload.promptFallbacks,
    'draft-only prompt fallback fields must survive provenance refresh',
  );
  const grokStagesSource = fs.readFileSync(path.join(repo, 'src/renderer/GrokStages.tsx'), 'utf8');
  const grokContextSource = fs.readFileSync(path.join(repo, 'src/main/grok-context.ts'), 'utf8');
  assert.doesNotMatch(
    grokStagesSource,
    /project\.saveBrief\(project\.rootPath/,
    'model selection must not rewrite project_brief.json when saving model family',
  );
  assert.match(
    grokContextSource,
    /family\s*=\s*modelData\?\.modelFamily\s+as\s+ModelFamily\s*\|\s*undefined/,
    'prompt-plan dialect must derive model family from models.json',
  );
  console.log('Model family, Base Model display, and catalog provenance refresh tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
