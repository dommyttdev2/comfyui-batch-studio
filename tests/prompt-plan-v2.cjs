const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-prompt-v2-runtime-'));
const tscBin = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(
  process.execPath,
  [tscBin, '-p', path.join(repo, 'tsconfig.electron.json'), '--outDir', runtime],
  { cwd: repo, stdio: 'inherit' },
);
const load = (relative) => import(pathToFileURL(path.join(runtime, relative)).href);
const writeJson = (p, value) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(value, null, 2) + '\n');
};

const catalog = { schemaVersion: 1, generation: 1, generatedAt: '2026-09-15T00:00:00Z' };
const model = (ref, fileName, trainedWords, id) => ({
  ref,
  modelId: id,
  modelName: ref,
  versionId: id + 1000,
  versionName: 'v1',
  fileId: id + 2000,
  fileName,
  modelUrl: 'https://example.com/model',
  trainedWords,
  reason: 'test',
});

(async () => {
  const { validatePromptPlan } = await load('main/validation.js');
  const { compilePromptPlanPrompts } = await load('shared/prompt-policy.js');
  const { compileWorkflow } = await load('main/compiler.js');

  const checkpoint = model('checkpoint.main', 'base.safetensors', ['base_trigger'], 1);
  const character = model('lora.character', 'character.safetensors', ['character_trigger'], 2);
  const pose = model('lora.pose', 'pose.safetensors', ['pose_trigger'], 3);
  const models = {
    schemaVersion: 5,
    modelFamily: 'illustrious',
    catalog,
    checkpoint,
    loras: [character, pose],
  };
  const plan = {
    schemaVersion: 2,
    common: {
      positive: {
        subject: ['1girl'],
        identity: ['kitagawa_marin', 'sono_bisque_doll_wa_koi_wo_suru'],
        appearance: ['long_hair', 'pink_eyes'],
      },
      negative: {
        identity: ['another_character'],
      },
    },
    rootLoras: [{ modelRef: 'lora.character', strengthModel: 0.7, strengthClip: 0.7 }],
    branches: [
      {
        id: 'b01',
        label: 'Clothed intro',
        loras: [{ modelRef: 'lora.pose', strengthModel: 0.6, strengthClip: 0.6 }],
        prompt: {
          positive: {
            outfit: ['crop_top', 'miniskirt'],
            environment: ['indoors', 'living_room'],
          },
          negative: {},
        },
        leaves: [
          {
            id: 's1-01-c1',
            name: 'S1-01_C1_intro',
            prompt: {
              positive: {
                expression: ['smile'],
                pose: ['standing'],
                camera: {
                  angle: ['from_below'],
                  framing: ['cowboy_shot'],
                  gaze: ['looking_at_viewer'],
                },
              },
              negative: {},
            },
          },
        ],
      },
    ],
  };

  const validation = validatePromptPlan(plan, models);
  assert.equal(validation.valid, true, JSON.stringify(validation.issues));

  const compiled = compilePromptPlanPrompts(plan, models);
  assert.deepEqual(compiled.common.positiveTags.slice(0, 5), [
    'masterpiece',
    'best_quality',
    'very_aesthetic',
    'absurdres',
    'highly_detailed',
  ]);
  assert.ok(compiled.common.positiveTags.includes('base_trigger'));
  assert.ok(compiled.common.positiveTags.includes('character_trigger'));
  assert.ok(compiled.common.positiveTags.includes('kitagawa_marin'));
  const leaf = compiled.branches[0].leaves[0];
  assert.ok(leaf.positiveTags.includes('pose_trigger'));
  assert.ok(leaf.positiveTags.includes('crop_top'));
  assert.ok(leaf.positiveTags.includes('from_below'));
  assert.ok(leaf.positiveTags.includes('cowboy_shot'));
  assert.ok(!leaf.positiveTags.includes('kitagawa_marin'));

  const conflict = structuredClone(plan);
  conflict.branches[0].leaves[0].prompt.positive.camera.framing = ['cowboy_shot', 'full_body'];
  const conflictValidation = validatePromptPlan(conflict, models);
  assert.equal(conflictValidation.valid, false);
  assert.ok(conflictValidation.issues.some((issue) => issue.code === 'CAMERA_FRAMING_CONFLICT'));

  const dialect = structuredClone(plan);
  dialect.branches[0].leaves[0].prompt.positive.pose = ['hands on hips'];
  const dialectValidation = validatePromptPlan(dialect, models);
  assert.equal(dialectValidation.valid, false);
  assert.ok(dialectValidation.issues.some((issue) => issue.code === 'ILLUSTRIOUS_TAG_DIALECT'));

  const positiveNegative = structuredClone(plan);
  positiveNegative.branches[0].leaves[0].prompt.negative.action = ['standing'];
  const pnValidation = validatePromptPlan(positiveNegative, models);
  assert.equal(pnValidation.valid, false);
  assert.ok(pnValidation.issues.some((issue) => issue.code === 'POSITIVE_NEGATIVE_CONFLICT'));

  const outfitState = structuredClone(plan);
  outfitState.branches[0].leaves[0].prompt.positive.outfit = ['nude'];
  const outfitValidation = validatePromptPlan(outfitState, models);
  const outfitWarning = outfitValidation.issues.find(
    (issue) => issue.code === 'OUTFIT_STATE_CONFLICT',
  );
  assert.ok(outfitWarning, 'outfit state warning must be emitted');
  assert.equal(
    outfitWarning.location,
    'Matrix 1行目 / Branch b01 / Leaf s1-01-c1',
    'leaf validation warning must carry a human-readable location',
  );

  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-prompt-v2-parent-'));
  const root = path.join(parent, 'project');
  fs.mkdirSync(root, { recursive: true });
  writeJson(path.join(root, 'project_brief.json'), {
    schemaVersion: 1,
    project: { id: 'prompt-v2-test', title: 'Prompt v2 test' },
  });
  writeJson(path.join(root, 'project_meta.json'), {
    schemaVersion: 1,
    createdAt: '2026-09-15T00:00:00Z',
    settings: {
      templatePath: path.join(repo, 'templates/illustrious-scene-batch/template.json'),
      manifestPath: path.join(repo, 'templates/illustrious-scene-batch/manifest.json'),
    },
  });
  writeJson(path.join(root, 'models.json'), models);
  writeJson(path.join(root, 'prompt_plan.json'), plan);
  const result = await compileWorkflow(root);
  assert.equal(result.validation.valid, true);
  const workflow = JSON.parse(fs.readFileSync(result.outputPath, 'utf8'));
  const common = workflow.nodes.find(
    (node) => node.type === 'ScenePrompter' && node.title === 'Prompt Plan 共通',
  );
  assert.ok(common);
  assert.equal(common.widgets_values[1], compiled.common.positive);
  assert.equal(common.widgets_values[3], compiled.common.negative);
  const matrix = workflow.nodes.find(
    (node) => node.type === 'SceneMatrix' && String(node.title).startsWith('Prompt - b01 -'),
  );
  assert.ok(matrix);
  const row = JSON.parse(matrix.widgets_values[0]).sets[0];
  assert.equal(row.positive_base, leaf.positive);
  assert.equal(row.negative_base, leaf.negative);

  console.log('Prompt Plan v2 structured prompt tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
