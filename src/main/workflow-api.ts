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
  _meta?: { title: string; batchStudio?: { contract: number; branchId: string; leafId: string } };
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
    case 'LoraLoader':
      return {
        lora_name: requiredWidget(node, 0, 'lora_name'),
        strength_model: widget(node, 1, 1),
        strength_clip: widget(node, 2, 1),
      };
    case 'CLIPTextEncode':
      return { text: widget(node, 0, '') };
    case 'KSampler':
      return {
        seed: widget(node, 0, 0),
        steps: widget(node, 2, 20),
        cfg: widget(node, 3, 8),
        sampler_name: widget(node, 4, 'euler'),
        scheduler: widget(node, 5, 'normal'),
        denoise: widget(node, 6, 1),
      };
    case 'VAEDecode':
      return {};
    case 'SaveImage':
      return { filename_prefix: widget(node, 0, '') };
    case 'EmptyLatentImage':
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
