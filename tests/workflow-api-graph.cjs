const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-api-graph-runtime-'));
const tscBin = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(
  process.execPath,
  [tscBin, '-p', path.join(repo, 'tsconfig.electron.json'), '--outDir', runtime],
  { cwd: repo, stdio: 'inherit' },
);
fs.cpSync(path.join(repo, 'templates'), path.join(runtime, 'templates'), { recursive: true });
const load = (relative) => import(pathToFileURL(path.join(runtime, 'main', relative)).href);
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const catalog = { schemaVersion: 1, generation: 1, generatedAt: '2026-09-11T00:00:00Z' };
const catalogModel = (ref, fileName) => ({
  ref,
  modelId: 1,
  modelName: 'Model',
  versionId: 2,
  versionName: 'v1',
  fileId: 3,
  fileName,
  modelUrl: 'https://example.com/model',
  trainedWords: [],
  reason: 'test',
});
const lora = {
  ref: 'lora.character',
  modelId: 10,
  modelName: 'Character',
  versionId: 20,
  versionName: 'v1',
  fileId: 30,
  fileName: 'character.safetensors',
  modelUrl: 'https://example.com/lora',
  trainedWords: ['character'],
  reason: 'test',
};
const plan = {
  schemaVersion: 1,
  common: { positive: 'masterpiece', negative: 'lowres' },
  rootLoras: [{ modelRef: 'lora.character', strengthModel: 0.6, strengthClip: 0.6 }],
  branches: [
    {
      id: 'branch-a',
      label: 'A',
      loras: [{ modelRef: 'lora.character', strengthModel: 0.7, strengthClip: 0.8 }],
      leaves: [
        {
          id: 'leaf-a1',
          name: '表示名A1',
          positive: '1girl, looking_at_viewer',
          negative: 'lowres',
        },
        { id: 'leaf-a2', name: '表示名A2', positive: '1girl, smile', negative: 'bad anatomy' },
      ],
    },
    {
      id: 'branch-b',
      label: 'B',
      loras: [],
      leaves: [{ id: 'leaf-b1', name: '表示名B1', positive: '1girl, standing', negative: 'text' }],
    },
  ],
};

async function makeProject(family) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), `batch-studio-api-${family}-`));
  const root = path.join(parent, 'project');
  fs.mkdirSync(root, { recursive: true });
  writeJson(path.join(root, 'project_brief.json'), {
    schemaVersion: 1,
    project: { id: `${family}-api-project`, title: family },
    subject: { copyrightedCharacter: false, characterName: '', series: '' },
    audience: 'test',
    request: 'test',
    exclusions: '',
    assumptions: { adultCharacters: true, consensual: true },
    generation: { target_image_count: 3, modelFamily: family },
    references: [],
  });
  writeJson(path.join(root, 'project_meta.json'), {
    schemaVersion: 1,
    createdAt: '2026-09-11T00:00:00.000Z',
    settings: {},
  });
  writeJson(path.join(root, 'prompt_plan.json'), plan);
  if (family === 'anima')
    writeJson(path.join(root, 'models.json'), {
      schemaVersion: 5,
      modelFamily: 'anima',
      catalog,
      diffusionModel: catalogModel('diffusion_model.main', 'anima.safetensors'),
      textEncoder: { ref: 'text_encoder.main', fileName: 'qwen.safetensors', reason: 'test' },
      vae: { ref: 'vae.main', fileName: 'anima-vae.safetensors', reason: 'test' },
      loras: [lora],
    });
  else
    writeJson(path.join(root, 'models.json'), {
      schemaVersion: 5,
      modelFamily: 'illustrious',
      catalog,
      checkpoint: catalogModel('checkpoint.main', 'illustrious.safetensors'),
      loras: [lora],
    });
  return root;
}

function byTitle(graph, prefix) {
  return Object.values(graph).find((node) => String(node?._meta?.title || '').startsWith(prefix));
}

(async () => {
  const { compileWorkflow } = await load('compiler.js');
  const { hashCanonicalJson, validateApiGraphStructure } = await load('workflow-api.js');

  for (const family of ['illustrious', 'anima']) {
    const root = await makeProject(family);
    const first = await compileWorkflow(root);
    assert.ok(fs.existsSync(first.outputPath), 'UI workflow must exist');
    assert.ok(fs.existsSync(first.apiOutputPath), 'Execution API graph must exist');
    assert.match(path.basename(first.apiOutputPath), /\.api\.json$/);

    const ui = JSON.parse(fs.readFileSync(first.outputPath, 'utf8'));
    const apiText = fs.readFileSync(first.apiOutputPath, 'utf8');
    const api = JSON.parse(apiText);
    assert.deepEqual(validateApiGraphStructure(api), []);
    assert.equal(first.uiSha256, hashCanonicalJson(ui));
    assert.equal(first.apiSha256, hashCanonicalJson(api));
    assert.equal(
      first.workflowIdentity,
      hashCanonicalJson({ uiSha256: first.uiSha256, apiSha256: first.apiSha256 }),
    );

    const uiIds = ui.nodes.map((node) => String(node.id)).sort((a, b) => Number(a) - Number(b));
    const apiIds = Object.keys(api).sort((a, b) => Number(a) - Number(b));
    assert.deepEqual(apiIds, uiIds, 'UI/API node identity must match');
    for (const node of ui.nodes) assert.equal(api[String(node.id)].class_type, node.type);

    if (family === 'illustrious') {
      const checkpoint = Object.values(api).find(
        (node) => node.class_type === 'CheckpointLoaderSimple',
      );
      assert.equal(checkpoint.inputs.ckpt_name, 'illustrious.safetensors');
      assert.equal(
        Object.values(api).some((node) => node.class_type === 'UNETLoader'),
        false,
      );
    } else {
      const unet = Object.values(api).find((node) => node.class_type === 'UNETLoader');
      const clip = Object.values(api).find((node) => node.class_type === 'CLIPLoader');
      const vae = Object.values(api).find((node) => node.class_type === 'VAELoader');
      assert.equal(unet.inputs.unet_name, 'anima.safetensors');
      assert.equal(clip.inputs.clip_name, 'qwen.safetensors');
      assert.equal(vae.inputs.vae_name, 'anima-vae.safetensors');
      assert.equal(
        Object.values(api).some((node) => node.class_type === 'CheckpointLoaderSimple'),
        false,
      );
    }

    const rootStack = Object.values(api).find(
      (node) => node.class_type === 'AnimaLoraStack' && node._meta?.title === 'Root LoRA Stack',
    );
    assert.equal(
      JSON.parse(rootStack.inputs.lora_stack_data).loras[0].name,
      'character.safetensors',
    );
    const branchA = byTitle(api, 'LoRA - branch-a -');
    const branchB = byTitle(api, 'LoRA - branch-b -');
    assert.equal(JSON.parse(branchA.inputs.lora_stack_data).loras.length, 1);
    assert.equal(JSON.parse(branchB.inputs.lora_stack_data).loras.length, 0);

    const matrixA = byTitle(api, 'Prompt - branch-a -');
    const rows = JSON.parse(matrixA.inputs.matrix_json).sets;
    assert.deepEqual(
      rows.map((row) => [row.row_id, row.path_label, row.name]),
      [
        ['leaf-a1', 'leaf-a1', 'leaf-a1'],
        ['leaf-a2', 'leaf-a2', 'leaf-a2'],
      ],
    );
    assert.equal(
      byTitle(api, 'Save - branch-a -').inputs.path,
      `BatchStudio/${family}-api-project/branch-a`,
    );
    assert.equal(
      byTitle(api, 'Save - branch-b -').inputs.path,
      `BatchStudio/${family}-api-project/branch-b`,
    );
    for (const expand of Object.values(api).filter(
      (node) => node.class_type === 'ScenePrompterExpand',
    ))
      assert.equal(expand.inputs.model_mode, family === 'anima' ? 'Anima' : 'Illustrious');

    const meta = JSON.parse(fs.readFileSync(path.join(root, 'project_meta.json'), 'utf8'));
    assert.equal(meta.workflowBuild.apiOutputPath, path.basename(first.apiOutputPath));
    assert.equal(meta.workflowBuild.outputs.ui.sha256, first.uiSha256);
    assert.equal(meta.workflowBuild.outputs.api.sha256, first.apiSha256);
    assert.equal(meta.workflowBuild.workflowIdentity, first.workflowIdentity);

    const second = await compileWorkflow(root);
    assert.equal(
      fs.readFileSync(second.apiOutputPath, 'utf8'),
      apiText,
      'same inputs must produce byte-identical API graph',
    );
    assert.equal(second.uiSha256, first.uiSha256);
    assert.equal(second.apiSha256, first.apiSha256);
    assert.equal(second.workflowIdentity, first.workflowIdentity);
  }

  console.log('Execution API graph determinism tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
