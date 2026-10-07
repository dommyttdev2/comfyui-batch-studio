import type { ExecutionRun, ModelsArtifact, PromptPlanArtifact } from './artifact-types.js';
import { compilePromptPlanPrompts } from './prompt-policy.js';
import type { ApiGraph } from './workflow-graph.js';

export const standardNodeTypes = new Set([
  'CheckpointLoaderSimple',
  'UNETLoader',
  'CLIPLoader',
  'VAELoader',
  'LoraLoader',
  'CLIPTextEncode',
  'EmptyLatentImage',
  'EmptySD3LatentImage',
  'KSampler',
  'VAEDecode',
  'SaveImage',
]);
export interface ImageTask {
  branchId: string;
  leafId: string;
  saveNodeId: string;
  graph: ApiGraph;
}
export interface GenerationDefaults {
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler_name: string;
  scheduler: string;
  denoise: number;
}

export function buildImageGraph(
  models: ModelsArtifact,
  plan: PromptPlanArtifact,
  projectId: string,
  defaults: GenerationDefaults,
): ApiGraph {
  const graph: ApiGraph = {};
  let next = 0;
  const add = (class_type: string, inputs: Record<string, unknown>, title: string) => {
    const id = String(++next);
    graph[id] = { class_type, inputs, _meta: { title } };
    return id;
  };
  const link = (id: string, slot = 0) => [id, slot];
  let model: unknown[], clip: unknown[], vae: unknown[];
  const anima = models.modelFamily === 'anima';
  if (anima) {
    if (!models.diffusionModel || !models.textEncoder || !models.vae)
      throw new Error('Anima requires diffusionModel, textEncoder and VAE.');
    model = link(
      add(
        'UNETLoader',
        { unet_name: models.diffusionModel.fileName, weight_dtype: 'default' },
        'Diffusion Model',
      ),
    );
    clip = link(
      add(
        'CLIPLoader',
        { clip_name: models.textEncoder.fileName, type: 'stable_diffusion', device: 'default' },
        'Text Encoder',
      ),
    );
    vae = link(add('VAELoader', { vae_name: models.vae.fileName }, 'VAE'));
  } else {
    if (!models.checkpoint) throw new Error('Checkpoint is required.');
    const id = add(
      'CheckpointLoaderSimple',
      { ckpt_name: models.checkpoint.fileName },
      'Checkpoint',
    );
    model = link(id);
    clip = link(id, 1);
    vae = link(id, 2);
  }
  const stack = (
    usages: PromptPlanArtifact['rootLoras'],
    initialModel: unknown[],
    initialClip: unknown[],
    title: string,
  ) => {
    let m = initialModel,
      c = initialClip;
    for (const usage of usages) {
      const asset = models.loras.find((item) => item.ref === usage.modelRef);
      if (!asset) throw new Error(`Unknown LoRA ${usage.modelRef}`);
      const id = add(
        'LoraLoader',
        {
          model: m,
          clip: c,
          lora_name: asset.fileName,
          strength_model: usage.strengthModel,
          strength_clip: usage.strengthClip,
        },
        title,
      );
      m = link(id);
      c = link(id, 1);
    }
    return { model: m, clip: c };
  };
  const root = stack(plan.rootLoras, model, clip, 'Root LoRA');
  const prompts = compilePromptPlanPrompts(plan, models);
  for (const branch of plan.branches) {
    const loaded = stack(branch.loras, root.model, root.clip, `LoRA - ${branch.id}`);
    const compiled = prompts.branches.find((item) => item.id === branch.id)!;
    for (const leaf of compiled.leaves) {
      const join = (a: string, b: string) => [a, b].filter(Boolean).join(', ');
      const positive = add(
        'CLIPTextEncode',
        { clip: loaded.clip, text: join(prompts.common.positive, leaf.positive) },
        `Positive - ${branch.id}/${leaf.id}`,
      );
      const negative = add(
        'CLIPTextEncode',
        { clip: loaded.clip, text: join(prompts.common.negative, leaf.negative) },
        `Negative - ${branch.id}/${leaf.id}`,
      );
      const latent = add(
        anima ? 'EmptySD3LatentImage' : 'EmptyLatentImage',
        { width: defaults.width, height: defaults.height, batch_size: 1 },
        'Latent',
      );
      const sampler = add(
        'KSampler',
        {
          model: loaded.model,
          positive: link(positive),
          negative: link(negative),
          latent_image: link(latent),
          seed: 0,
          steps: defaults.steps,
          cfg: defaults.cfg,
          sampler_name: defaults.sampler_name,
          scheduler: defaults.scheduler,
          denoise: defaults.denoise,
        },
        `Sampler - ${branch.id}/${leaf.id}`,
      );
      const decode = add('VAEDecode', { samples: link(sampler), vae }, 'VAE Decode');
      const save = add(
        'SaveImage',
        {
          images: link(decode),
          filename_prefix: `BatchStudio/${projectId}/${encodeURIComponent(branch.id)}/${encodeURIComponent(leaf.id)}`,
        },
        `Save - ${branch.id}/${leaf.id}`,
      );
      graph[save]._meta!.batchStudio = { contract: 1, branchId: branch.id, leafId: leaf.id };
    }
  }
  return graph;
}

export function enumerateImageTasks(
  graph: ApiGraph,
  run: Pick<ExecutionRun, 'snapshot'>,
): ImageTask[] {
  if (Object.values(graph).some((node) => !standardNodeTypes.has(node.class_type)))
    throw new Error(
      'STANDARD_WORKFLOW_REQUIRED: Workflowを再生成し、新Runを作成してください。旧Workflowは実行できません。',
    );
  const outputs = Object.entries(graph).filter(([, node]) => node.class_type === 'SaveImage');
  const tasks: ImageTask[] = [];
  for (const branch of run.snapshot.plan.branches)
    for (const leafId of branch.leafIds) {
      const matches = outputs.filter(
        ([, node]) =>
          node._meta?.batchStudio?.contract === 1 &&
          node._meta.batchStudio.branchId === branch.branchId &&
          node._meta.batchStudio.leafId === leafId,
      );
      if (matches.length !== 1)
        throw new Error(`IMAGE_TASK_BINDING_INVALID: ${branch.branchId}/${leafId}`);
      const saveNodeId = matches[0][0],
        keep = new Set<string>();
      const visit = (id: string, active = new Set<string>()) => {
        if (active.has(id)) throw new Error('IMAGE_TASK_GRAPH_CYCLE');
        if (keep.has(id)) return;
        if (!graph[id]) throw new Error('IMAGE_TASK_GRAPH_MISSING_NODE');
        active.add(id);
        for (const value of Object.values(graph[id].inputs))
          if (Array.isArray(value) && typeof value[0] === 'string') visit(value[0], active);
        active.delete(id);
        keep.add(id);
      };
      visit(saveNodeId);
      const nodes = [...keep].map((id) => graph[id]);
      const latents = nodes.filter((node) =>
        ['EmptyLatentImage', 'EmptySD3LatentImage'].includes(node.class_type),
      );
      if (
        nodes.filter((node) => node.class_type === 'SaveImage').length !== 1 ||
        nodes.filter((node) => node.class_type === 'KSampler').length !== 1 ||
        latents.length !== 1 ||
        latents[0].inputs.batch_size !== 1
      )
        throw new Error('IMAGE_TASK_SINGLE_IMAGE_REQUIRED');
      tasks.push({
        branchId: branch.branchId,
        leafId,
        saveNodeId,
        graph: Object.fromEntries(
          [...keep].map((id) => [id, JSON.parse(JSON.stringify(graph[id])) as ApiGraph[string]]),
        ),
      });
    }
  if (tasks.length !== outputs.length) throw new Error('IMAGE_TASK_OUTPUT_COUNT_INVALID');
  return tasks;
}

// A graph and its editor representation always originate from the same inputs.
export function graphToWorkflow(graph: ApiGraph) {
  const types: Record<
    string,
    { outputs: string[]; widgets: string[]; sockets: Record<string, string> }
  > = {
    CheckpointLoaderSimple: {
      outputs: ['MODEL', 'CLIP', 'VAE'],
      widgets: ['ckpt_name'],
      sockets: {},
    },
    UNETLoader: { outputs: ['MODEL'], widgets: ['unet_name', 'weight_dtype'], sockets: {} },
    CLIPLoader: { outputs: ['CLIP'], widgets: ['clip_name', 'type', 'device'], sockets: {} },
    VAELoader: { outputs: ['VAE'], widgets: ['vae_name'], sockets: {} },
    LoraLoader: {
      outputs: ['MODEL', 'CLIP'],
      widgets: ['lora_name', 'strength_model', 'strength_clip'],
      sockets: { model: 'MODEL', clip: 'CLIP' },
    },
    CLIPTextEncode: { outputs: ['CONDITIONING'], widgets: ['text'], sockets: { clip: 'CLIP' } },
    EmptyLatentImage: {
      outputs: ['LATENT'],
      widgets: ['width', 'height', 'batch_size'],
      sockets: {},
    },
    EmptySD3LatentImage: {
      outputs: ['LATENT'],
      widgets: ['width', 'height', 'batch_size'],
      sockets: {},
    },
    KSampler: {
      outputs: ['LATENT'],
      widgets: ['seed', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise'],
      sockets: {
        model: 'MODEL',
        positive: 'CONDITIONING',
        negative: 'CONDITIONING',
        latent_image: 'LATENT',
      },
    },
    VAEDecode: { outputs: ['IMAGE'], widgets: [], sockets: { samples: 'LATENT', vae: 'VAE' } },
    SaveImage: { outputs: [], widgets: ['filename_prefix'], sockets: { images: 'IMAGE' } },
  };
  const links: any[][] = [];
  const nodes = Object.entries(graph).map(([id, node], index) => {
    const spec = types[node.class_type];
    if (!spec) throw new Error('Unsupported standard node');
    const inputs = Object.entries(spec.sockets).map(([name, type], slot) => {
      const source = node.inputs[name] as [string, number];
      const link = links.length + 1;
      links.push([link, Number(source[0]), source[1], Number(id), slot, type]);
      return { name, type, link };
    });
    const widgets = spec.widgets.map((name) => node.inputs[name]);
    if (node.class_type === 'KSampler') widgets.splice(1, 0, 'fixed');
    return {
      id: Number(id),
      type: node.class_type,
      title: node._meta?.title,
      pos: [(index % 6) * 360, Math.floor(index / 6) * 380],
      size: [320, 300],
      flags: {},
      order: index,
      mode: 0,
      inputs,
      outputs: spec.outputs.map((type, slot) => ({
        name: type,
        type,
        slot_index: slot,
        links: [] as number[],
      })),
      properties: { 'Node name for S&R': node.class_type },
      widgets_values: widgets,
    };
  });
  for (const link of links)
    nodes.find((node) => node.id === link[1])!.outputs[link[2]].links.push(link[0]);
  return {
    last_node_id: Math.max(...nodes.map((node) => node.id)),
    last_link_id: links.length,
    nodes,
    links,
    groups: [],
    version: 0.4,
  };
}
