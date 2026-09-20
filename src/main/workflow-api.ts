import { createHash } from 'node:crypto';
import type {
  ModelsArtifact,
  PromptPlanArtifact,
  ValidationIssue,
  WorkflowManifest,
} from '../shared/types.js';

// Catalog refresh timestamps and generation numbers are not Workflow inputs.
export function hashWorkflowModelInputs(models: ModelsArtifact): string {
  const inputs: Partial<ModelsArtifact> = { ...models };
  delete inputs.catalog;
  return hashCanonicalJson(inputs);
}

export type ApiGraphNode = {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title: string };
};
export type ApiGraph = Record<string, ApiGraphNode>;
export type UiWorkflowNode = {
  id: number;
  type: string;
  title?: string;
  inputs?: Array<{ name: string; link: number | null }>;
  widgets_values?: unknown[];
  [key: string]: unknown;
};
export type UiWorkflowLike = { nodes: UiWorkflowNode[]; links: any[] };

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .map((key) => [key, canonical(object[key])]),
    );
  }
  return value;
}

export function hashCanonicalJson(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)), 'utf8')
    .digest('hex');
}

function widget(node: UiWorkflowNode, index: number, fallback?: unknown) {
  const value = node.widgets_values?.[index];
  return value === undefined ? fallback : value;
}
function requiredWidget(node: UiWorkflowNode, index: number, name: string) {
  const value = widget(node, index);
  if (value === undefined)
    throw new Error(`API contract: ${node.type} node ${node.id} missing widget ${name}`);
  return value;
}

function primitiveInputs(node: UiWorkflowNode): Record<string, unknown> {
  switch (node.type) {
    case 'CheckpointLoaderSimple':
      return { ckpt_name: requiredWidget(node, 0, 'ckpt_name') };
    case 'UNETLoader':
      return {
        unet_name: requiredWidget(node, 0, 'unet_name'),
        weight_dtype: requiredWidget(node, 1, 'weight_dtype'),
      };
    case 'CLIPLoader':
      return {
        clip_name: requiredWidget(node, 0, 'clip_name'),
        type: requiredWidget(node, 1, 'type'),
        device: requiredWidget(node, 2, 'device'),
      };
    case 'VAELoader':
      return { vae_name: requiredWidget(node, 0, 'vae_name') };
    case 'AnimaLoraStack':
      return { lora_stack_data: requiredWidget(node, 0, 'lora_stack_data') };
    case 'SceneMatrix':
      return {
        matrix_json: requiredWidget(node, 0, 'matrix_json'),
        run_handle: widget(node, 1, ''),
      };
    case 'ScenePrompter':
      return {
        prompt_name: widget(node, 0, ''),
        positive_base: widget(node, 1, ''),
        positive_json: widget(node, 2, '{"version":1,"categories":{}}'),
        negative_base: widget(node, 3, ''),
        negative_json: widget(node, 4, '{"version":1,"categories":{}}'),
        category_order: widget(node, 5, ''),
        seed: widget(node, 6, 0),
        randomize: widget(node, 8, false),
        run_handle: widget(node, 9, ''),
        filename_enabled: widget(node, 10, false),
      };
    case 'ScenePromptCounter':
      return { count: widget(node, 0, 1) };
    case 'SceneEmptyLatent':
      return {
        width: widget(node, 0, 512),
        height: widget(node, 1, 512),
        batch_size: widget(node, 2, 1),
      };
    case 'ScenePrompterExpand':
      return {
        current_index: widget(node, 0, 0),
        run_id: widget(node, 1, ''),
        seed_base: widget(node, 2, 0),
        timestamp_dir: widget(node, 3, true),
        prefix: widget(node, 4, ''),
        model_mode: widget(node, 5, 'Illustrious'),
      };
    case 'CLIPTextEncode':
      return {};
    case 'KSampler':
      return {
        steps: widget(node, 2, 20),
        cfg: widget(node, 3, 8),
        sampler_name: widget(node, 4, 'euler'),
        scheduler: widget(node, 5, 'normal'),
        denoise: widget(node, 6, 1),
      };
    case 'VAEDecode':
      return {};
    case 'SceneSaveImage':
      return { path: widget(node, 0, ''), metadata_mode: widget(node, 1, 'ワークフロー全体') };
    case 'EmptySD3LatentImage':
      return {
        width: widget(node, 0, 1024),
        height: widget(node, 1, 1024),
        batch_size: widget(node, 2, 1),
      };
    default:
      throw new Error(
        `API contract: unsupported template node type ${node.type} (node ${node.id})`,
      );
  }
}

export function buildApiGraph(workflow: UiWorkflowLike): ApiGraph {
  const links = new Map<number, any[]>(workflow.links.map((link) => [Number(link[0]), link]));
  const graph: ApiGraph = {};
  for (const node of [...workflow.nodes].sort((a, b) => a.id - b.id)) {
    const inputs = primitiveInputs(node);
    for (const input of node.inputs ?? []) {
      if (input.link == null) continue;
      const link = links.get(input.link);
      if (!link) throw new Error(`API contract: link ${input.link} for node ${node.id} is missing`);
      inputs[input.name] = [String(link[1]), Number(link[2])];
    }
    graph[String(node.id)] = {
      class_type: node.type,
      inputs,
      ...(node.title ? { _meta: { title: node.title } } : {}),
    };
  }
  return graph;
}

export function validateApiGraphStructure(graph: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!graph || typeof graph !== 'object' || Array.isArray(graph))
    return [
      {
        severity: 'error',
        code: 'API_GRAPH_TYPE',
        message: 'Execution API graph rootが不正です。',
      },
    ];
  const object = graph as Record<string, unknown>;
  const ids = new Set(Object.keys(object));
  if (ids.size === 0)
    issues.push({
      severity: 'error',
      code: 'API_GRAPH_EMPTY',
      message: 'Execution API graphが空です。',
    });
  for (const [id, value] of Object.entries(object)) {
    if (!/^\d+$/.test(id))
      issues.push({
        severity: 'error',
        code: 'API_NODE_ID',
        message: `API graph node IDが不正です: ${id}`,
        path: id,
      });
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      issues.push({
        severity: 'error',
        code: 'API_NODE_TYPE',
        message: `API graph node ${id} が不正です。`,
        path: id,
      });
      continue;
    }
    const node = value as Record<string, unknown>;
    if (typeof node.class_type !== 'string' || !node.class_type.trim())
      issues.push({
        severity: 'error',
        code: 'API_CLASS_TYPE',
        message: `API graph node ${id} のclass_typeが不正です。`,
        path: id,
      });
    if (!node.inputs || typeof node.inputs !== 'object' || Array.isArray(node.inputs)) {
      issues.push({
        severity: 'error',
        code: 'API_INPUTS',
        message: `API graph node ${id} のinputsが不正です。`,
        path: id,
      });
      continue;
    }
    for (const [name, input] of Object.entries(node.inputs as Record<string, unknown>)) {
      if (
        Array.isArray(input) &&
        input.length === 2 &&
        typeof input[0] === 'string' &&
        typeof input[1] === 'number' &&
        Number.isInteger(input[1])
      ) {
        if (!ids.has(input[0]))
          issues.push({
            severity: 'error',
            code: 'API_DANGLING_LINK',
            message: `API graph ${id}.${name} の参照先 ${input[0]} が存在しません。`,
            path: `${id}.inputs.${name}`,
          });
      }
    }
  }
  return issues;
}

function roleNode(m: WorkflowManifest, scope: 'common' | 'branch', role: string) {
  const binding = scope === 'common' ? m.common.roles[role] : m.branchPrototype.roles[role];
  if (!binding) throw new Error(`Manifest role missing: ${scope}.${role}`);
  return binding.nodeId;
}
function parseStack(node: ApiGraphNode | undefined) {
  try {
    return JSON.parse(String(node?.inputs.lora_stack_data ?? ''))?.loras ?? null;
  } catch {
    return null;
  }
}
function stackExpected(usages: any[], models: ModelsArtifact) {
  return usages.map((usage) => {
    const model = models.loras.find((item) => item.ref === usage.modelRef);
    return model
      ? {
          enabled: true,
          name: model.fileName,
          strength_model: usage.strengthModel,
          strength_clip: usage.strengthClip,
        }
      : null;
  });
}
function same(value: unknown, expected: unknown) {
  return JSON.stringify(value) === JSON.stringify(expected);
}

export function validateCompiledApiGraph(
  graph: ApiGraph,
  workflow: UiWorkflowLike,
  manifest: WorkflowManifest,
  plan: PromptPlanArtifact,
  models: ModelsArtifact,
  projectId: string,
  branchMaps: Array<Map<number, number>>,
): ValidationIssue[] {
  const issues = validateApiGraphStructure(graph);
  const uiIds = [...workflow.nodes].sort((a, b) => a.id - b.id).map((node) => String(node.id));
  const apiIds = Object.keys(graph).sort((a, b) => Number(a) - Number(b));
  if (!same(apiIds, uiIds))
    issues.push({
      severity: 'error',
      code: 'API_UI_NODE_IDENTITY',
      message: 'UI WorkflowとExecution API graphのnode identityが一致しません。',
    });
  for (const node of workflow.nodes) {
    if (graph[String(node.id)]?.class_type !== node.type)
      issues.push({
        severity: 'error',
        code: 'API_UI_CLASS_TYPE',
        message: `Node ${node.id} のUI/API class_typeが一致しません。`,
        path: String(node.id),
      });
  }
  const family = models.modelFamily === 'anima' ? 'anima' : 'illustrious';
  if (family === 'anima') {
    const raw = models as ModelsArtifact & { diffusionModel?: { fileName: string } };
    const diffusion = raw.diffusionModel ?? raw.checkpoint;
    if (
      graph[String(roleNode(manifest, 'common', 'diffusionModel'))]?.inputs.unet_name !==
      diffusion?.fileName
    )
      issues.push({
        severity: 'error',
        code: 'API_MODEL_MISMATCH',
        message: 'API graphのDiffusion Modelがmodels.jsonと一致しません。',
      });
    if (
      graph[String(roleNode(manifest, 'common', 'textEncoder'))]?.inputs.clip_name !==
      models.textEncoder?.fileName
    )
      issues.push({
        severity: 'error',
        code: 'API_TEXT_ENCODER_MISMATCH',
        message: 'API graphのText Encoderがmodels.jsonと一致しません。',
      });
    if (
      graph[String(roleNode(manifest, 'common', 'vae'))]?.inputs.vae_name !== models.vae?.fileName
    )
      issues.push({
        severity: 'error',
        code: 'API_VAE_MISMATCH',
        message: 'API graphのVAEがmodels.jsonと一致しません。',
      });
  } else if (
    graph[String(roleNode(manifest, 'common', 'checkpoint'))]?.inputs.ckpt_name !==
    models.checkpoint?.fileName
  )
    issues.push({
      severity: 'error',
      code: 'API_MODEL_MISMATCH',
      message: 'API graphのCheckpointがmodels.jsonと一致しません。',
    });
  const rootLora = graph[String(roleNode(manifest, 'common', 'rootLoraStack'))];
  if (!same(parseStack(rootLora), stackExpected(plan.rootLoras, models)))
    issues.push({
      severity: 'error',
      code: 'API_ROOT_LORA_MISMATCH',
      message: 'API graphのRoot LoRAがmodels.json / prompt_plan.jsonと一致しません。',
    });
  if (branchMaps.length !== plan.branches.length)
    issues.push({
      severity: 'error',
      code: 'API_BRANCH_COUNT',
      message: 'API graphのBranch数がPrompt Planと一致しません。',
    });
  branchMaps.forEach((map, index) => {
    const branch = plan.branches[index];
    if (!branch) return;
    const id = (role: string) => map.get(roleNode(manifest, 'branch', role));
    const loraId = id('loraStack'),
      matrixId = id('mainMatrix'),
      expandId = id('expand'),
      saveId = id('save');
    if (loraId == null || matrixId == null || expandId == null || saveId == null) {
      issues.push({
        severity: 'error',
        code: 'API_BRANCH_ROLE_MAPPING',
        message: `${branch.id} のAPI role mappingが不足しています。`,
        path: branch.id,
      });
      return;
    }
    if (!same(parseStack(graph[String(loraId)]), stackExpected(branch.loras, models)))
      issues.push({
        severity: 'error',
        code: 'API_BRANCH_LORA_MISMATCH',
        message: `${branch.id} のAPI LoRA参照が不正です。`,
        path: branch.id,
      });
    if (graph[String(saveId)]?.inputs.path !== `BatchStudio/${projectId}/${branch.id}`)
      issues.push({
        severity: 'error',
        code: 'API_SAVE_PATH_MISMATCH',
        message: `${branch.id} のAPI Save pathが不正です。`,
        path: branch.id,
      });
    if (
      graph[String(expandId)]?.inputs.model_mode !== (family === 'anima' ? 'Anima' : 'Illustrious')
    )
      issues.push({
        severity: 'error',
        code: 'API_MODEL_MODE_MISMATCH',
        message: `${branch.id} のScenePrompterExpand model_modeが不正です。`,
        path: branch.id,
      });
    try {
      const matrix = JSON.parse(String(graph[String(matrixId)]?.inputs.matrix_json ?? ''));
      const sets = Array.isArray(matrix?.sets) ? matrix.sets : [];
      if (sets.length !== branch.leaves.length)
        issues.push({
          severity: 'error',
          code: 'API_MATRIX_COUNT',
          message: `${branch.id} のAPI SceneMatrix行数がLeaf数と一致しません。`,
          path: branch.id,
        });
      branch.leaves.forEach((leaf, leafIndex) => {
        const row = sets[leafIndex];
        if (!row || row.row_id !== leaf.id || row.path_label !== leaf.id || row.name !== leaf.id)
          issues.push({
            severity: 'error',
            code: 'API_LEAF_MATRIX_MAPPING',
            message: `${branch.id}/${leaf.id} のAPI SceneMatrix mappingが不正です。`,
            path: leaf.id,
          });
      });
    } catch {
      issues.push({
        severity: 'error',
        code: 'API_MATRIX_JSON',
        message: `${branch.id} のAPI SceneMatrix JSONを解析できません。`,
        path: branch.id,
      });
    }
  });
  return issues;
}
