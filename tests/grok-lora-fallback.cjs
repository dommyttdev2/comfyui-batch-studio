const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-grok-lora-fallback-runtime-'));
const tscBin = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(
  process.execPath,
  [tscBin, '-p', path.join(repo, 'tsconfig.electron.json'), '--outDir', runtime],
  { cwd: repo, stdio: 'inherit' },
);

const generatedAt = '2026-09-09T00:00:00.000Z';
const checkpointFile = { id: 10, name: 'checkpoint.safetensors', type: 'Model' };
const checkpoint = {
  modelId: 1,
  modelName: 'Base Checkpoint',
  modelType: 'Checkpoint',
  versionId: 100,
  versionName: 'v1',
  files: [checkpointFile],
  trainedWords: [],
  modelUrl: 'https://civitai.com/models/1',
  versions: [
    {
      versionId: 100,
      versionName: 'v1',
      baseModel: 'Illustrious',
      files: [checkpointFile],
      trainedWords: [],
      modelUrl: 'https://civitai.com/models/1?modelVersionId=100',
    },
  ],
};
const baseModels = {
  schemaVersion: 4,
  modelFamily: 'illustrious',
  catalog: { schemaVersion: 1, generation: 1, generatedAt },
  checkpoint: {
    ref: 'checkpoint.main',
    modelId: 1,
    modelName: 'Base Checkpoint',
    versionId: 100,
    versionName: 'v1',
    fileId: 10,
    fileName: 'checkpoint.safetensors',
    modelUrl: 'https://civitai.com/models/1?modelVersionId=100',
    trainedWords: [],
    reason: 'user selected',
  },
  loras: [],
};

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-grok-lora-fallback-project-'));
  fs.mkdirSync(path.join(root, '._batch_studio', 'drafts'), { recursive: true });
  fs.mkdirSync(path.join(root, '._batch_studio', 'history'), { recursive: true });
  const catalogPath = path.join(root, 'model_catalog.json');
  fs.writeFileSync(
    catalogPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        generation: 1,
        generatedAt,
        collections: [{ id: 1, name: 'Base', items: [checkpoint] }],
      },
      null,
      2,
    ),
  );
  process.env.BATCH_STUDIO_CATALOG_PATH = catalogPath;
  fs.writeFileSync(
    path.join(root, '._batch_studio', 'drafts', 'models.json'),
    JSON.stringify(baseModels, null, 2),
  );
  fs.writeFileSync(path.join(root, 'story.md'), '# Story\n');
  fs.writeFileSync(
    path.join(root, 'project_brief.json'),
    JSON.stringify({ generation: { target_image_count: 10, modelFamily: 'illustrious' } }, null, 2),
  );

  const artifacts = await import(
    pathToFileURL(path.join(runtime, 'main', 'artifact-service.js')).href
  );
  const grok = await import(pathToFileURL(path.join(runtime, 'main', 'grok-context.js')).href);
  const fallback = {
    requirement: 'specific hand pose',
    positiveTags: ['specific_hand_pose', 'detailed_hands'],
    negativeTags: ['bad_hands'],
    reason: 'No suitable LoRA was found and the pose is expressible with prompt tags.',
  };
  const resolved = await artifacts.importGrok(
    root,
    'models',
    JSON.stringify({ schemaVersion: 1, loras: [], promptFallbacks: [fallback] }),
    'models',
  );
  assert.equal(
    resolved.validation.valid,
    true,
    'prompt-only fallback must resolve the LoRA requirement without blocking validation',
  );
  assert.equal(
    resolved.summary.promptFallbacks,
    1,
    'import summary must count resolved prompt fallbacks',
  );
  const draft = JSON.parse(
    fs.readFileSync(path.join(root, '._batch_studio', 'drafts', 'models.json'), 'utf8'),
  );
  assert.deepEqual(
    draft.promptFallbacks,
    [fallback],
    'resolved prompt fallback must stay with the draft until model confirmation',
  );

  await artifacts.confirmArtifact(root, 'models');
  const confirmed = JSON.parse(fs.readFileSync(path.join(root, 'models.json'), 'utf8'));
  assert.equal(
    Object.prototype.hasOwnProperty.call(confirmed, 'promptFallbacks'),
    false,
    'public models.json must keep its strict existing schema',
  );
  const sidecar = JSON.parse(
    fs.readFileSync(path.join(root, '._batch_studio', 'model_prompt_fallbacks.json'), 'utf8'),
  );
  assert.deepEqual(
    sidecar,
    { schemaVersion: 2, promptFallbacks: [fallback] },
    'confirmed prompt fallbacks must persist in the internal sidecar',
  );

  const task = await grok.buildGrokTask(root, 'prompt-plan');
  const fallbackAttachment = task.attachments.find((x) => x.name === 'model_prompt_fallbacks.json');
  assert.equal(
    fallbackAttachment?.exists,
    true,
    'Prompt Plan must receive the persisted prompt fallback sidecar',
  );
  assert.match(
    task.prompt,
    /promptFallbacks/,
    'Prompt Plan instructions must explain how to apply prompt fallbacks',
  );

  fs.writeFileSync(
    path.join(root, '._batch_studio', 'drafts', 'models.json'),
    JSON.stringify(baseModels, null, 2),
  );
  const unresolved = await artifacts.importGrok(
    root,
    'models',
    JSON.stringify({
      schemaVersion: 1,
      loras: [],
      missingRequirements: [
        {
          role: 'lora',
          requirement: 'character identity',
          reason: 'Alternative found on Civitai but it must be added to the Collection first.',
        },
      ],
    }),
    'models',
  );
  assert.equal(
    unresolved.validation.valid,
    false,
    'truly unresolved or catalog-add requirements must remain blocking',
  );
  assert.ok(unresolved.validation.issues.some((x) => x.code === 'MISSING_REQUIREMENTS'));

  const malformed = await artifacts.importGrok(
    root,
    'models',
    JSON.stringify({
      schemaVersion: 1,
      loras: [],
      promptFallbacks: [
        { requirement: 'pose', positiveTags: [], negativeTags: [], reason: 'empty replacement' },
      ],
    }),
    'models',
  );
  assert.equal(
    malformed.validation.valid,
    false,
    'empty prompt replacements must not be accepted as resolved',
  );
  assert.ok(malformed.validation.issues.some((x) => x.code === 'PROMPT_FALLBACKS_FORMAT'));

  console.log('Grok LoRA fallback resolution tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
