const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-workflow-family-runtime-'));
const tscBin = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(
  process.execPath,
  [tscBin, '-p', path.join(repo, 'tsconfig.electron.json'), '--outDir', runtime],
  { cwd: repo, stdio: 'inherit' },
);
fs.cpSync(path.join(repo, 'templates'), path.join(runtime, 'templates'), { recursive: true });
const load = (relative) => import(pathToFileURL(path.join(runtime, 'main', relative)).href);
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const catalog = { schemaVersion: 1, generation: 1, generatedAt: '2026-09-09T00:00:00Z' };
const base = (ref, fileName) => ({
  ref,
  modelId: 1,
  modelName: 'Base model',
  versionId: 2,
  versionName: 'v1',
  fileId: 3,
  fileName,
  modelUrl: 'https://example.com/model',
  trainedWords: [],
  reason: 'test',
});
const plan = {
  schemaVersion: 1,
  common: { positive: 'masterpiece', negative: 'lowres' },
  rootLoras: [],
  branches: [
    {
      id: 'branch-a',
      label: 'A',
      loras: [],
      leaves: [
        { id: 'leaf-a', name: 'Leaf A', positive: '1girl, looking_at_viewer', negative: 'lowres' },
      ],
    },
  ],
};

async function project(family) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), `batch-studio-${family}-parent-`));
  const root = path.join(parent, 'project');
  fs.mkdirSync(root, { recursive: true });
  writeJson(path.join(root, 'project_brief.json'), {
    schemaVersion: 1,
    project: { id: `${family}-project`, title: family },
    subject: { copyrightedCharacter: false, characterName: '', series: '' },
    audience: 'test',
    request: 'test',
    exclusions: '',
    assumptions: { adultCharacters: true, consensual: true },
    generation: { target_image_count: 1, modelFamily: family },
    references: [],
  });
  writeJson(path.join(root, 'project_meta.json'), {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    settings: {},
  });
  writeJson(path.join(root, 'prompt_plan.json'), plan);
  if (family === 'anima')
    writeJson(path.join(root, 'models.json'), {
      schemaVersion: 5,
      modelFamily: 'anima',
      catalog,
      diffusionModel: base('diffusion_model.main', 'anima.safetensors'),
      textEncoder: {
        ref: 'text_encoder.main',
        fileName: 'qwen_3_06b_base.safetensors',
        reason: 'test',
      },
      vae: { ref: 'vae.main', fileName: 'qwen_image_vae.safetensors', reason: 'test' },
      loras: [],
    });
  else
    writeJson(path.join(root, 'models.json'), {
      schemaVersion: 5,
      modelFamily: 'illustrious',
      catalog,
      checkpoint: base('checkpoint.main', 'illustrious.safetensors'),
      loras: [],
    });
  return root;
}

(async () => {
  const { compileWorkflow } = await load('compiler.js');
  const illustriousRoot = await project('illustrious');
  const illustriousResult = await compileWorkflow(illustriousRoot);
  const illustrious = JSON.parse(fs.readFileSync(illustriousResult.outputPath, 'utf8'));
  assert.equal(illustrious.nodes.find((n) => n.id === 1)?.type, 'CheckpointLoaderSimple');
  assert.deepEqual(illustrious.nodes.find((n) => n.id === 1)?.widgets_values, [
    'illustrious.safetensors',
  ]);
  assert.equal(
    illustrious.nodes.some((n) => n.type === 'UNETLoader'),
    false,
  );
  assert.equal(
    illustrious.nodes.find((n) => n.type === 'ScenePrompterExpand')?.widgets_values?.[5],
    'Illustrious',
  );

  const animaRoot = await project('anima');
  const animaResult = await compileWorkflow(animaRoot);
  const anima = JSON.parse(fs.readFileSync(animaResult.outputPath, 'utf8'));
  const unet = anima.nodes.find((n) => n.type === 'UNETLoader');
  const clip = anima.nodes.find((n) => n.type === 'CLIPLoader');
  const vae = anima.nodes.find((n) => n.type === 'VAELoader');
  const latent = anima.nodes.find((n) => n.type === 'EmptySD3LatentImage');
  const sampler = anima.nodes.find((n) => n.type === 'KSampler');
  const expand = anima.nodes.find((n) => n.type === 'ScenePrompterExpand');
  assert.deepEqual(unet?.widgets_values, ['anima.safetensors', 'default']);
  assert.deepEqual(clip?.widgets_values, [
    'qwen_3_06b_base.safetensors',
    'stable_diffusion',
    'default',
  ]);
  assert.deepEqual(vae?.widgets_values, ['qwen_image_vae.safetensors']);
  assert.deepEqual(latent?.widgets_values, [896, 1344, 1]);
  assert.equal(expand?.widgets_values?.[5], 'Anima');
  assert.equal(
    anima.nodes.some((n) => n.type === 'CheckpointLoaderSimple'),
    false,
  );
  const latentLink = anima.links.find((l) => l[0] === sampler?.inputs?.[3]?.link);
  assert.equal(
    latentLink?.[1],
    latent?.id,
    'Anima KSampler latent must come from EmptySD3LatentImage',
  );
  assert.notEqual(
    latentLink?.[1],
    expand?.id,
    'Anima must not feed ScenePrompterExpand 4-channel latent into KSampler',
  );

  console.log('Illustrious/Anima workflow template selection tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
