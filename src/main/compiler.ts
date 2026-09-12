import { createHash } from 'node:crypto';
import path from 'node:path';
import type {
  CompileResult,
  ModelFamily,
  ModelsArtifact,
  PromptPlanArtifact,
  ValidationIssue,
  WorkflowManifest,
} from '../shared/types.js';
import { exists, readJson, readText, removeIfExists, writeJsonAtomic } from './fs-utils.js';
import { readProjectMeta, saveWorkflowBuild } from './project-meta.js';
import { validateModels, validatePromptPlan, validateWorkflowManifest } from './validation.js';
import { resolveWorkflowTemplatePaths } from './workflow-template-paths.js';
import { buildApiGraph, hashCanonicalJson, validateCompiledApiGraph } from './workflow-api.js';

type Node = {
  id: number;
  type: string;
  mode?: number;
  pos?: [number, number];
  size?: [number, number];
  title?: string;
  inputs?: Array<{ name: string; type: string; link: number | null }>;
  outputs?: Array<{ name: string; type: string; links: number[] | null }>;
  widgets_values?: unknown[];
  [k: string]: unknown;
};
type Group = { id: number; title: string; bounding?: number[]; [k: string]: unknown };
type Workflow = {
  last_node_id: number;
  last_link_id: number;
  nodes: Node[];
  links: any[];
  groups?: Group[];
  [k: string]: unknown;
};

const emptyJson = '{"version":1,"categories":{}}';
function sha256(s: string) {
  return createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
}
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
function maxId(xs: number[]) {
  return xs.length ? Math.max(...xs) : 0;
}
function roleNode(m: WorkflowManifest, scope: 'common' | 'branch', role: string) {
  const r = scope === 'common' ? m.common.roles[role] : m.branchPrototype.roles[role];
  if (!r) throw new Error(`Manifest role missing: ${scope}.${role}`);
  return r.nodeId;
}
function getNode(w: Workflow, id: number) {
  const n = w.nodes.find((n) => n.id === id);
  if (!n) throw new Error(`Node ${id} not found`);
  return n;
}
function setInputLink(node: Node, slot: number, link: number | null) {
  if (!node.inputs || !node.inputs[slot])
    throw new Error(`Node ${node.id} input slot ${slot} missing`);
  node.inputs[slot].link = link;
}
function addOutputLink(node: Node, slot: number, link: number) {
  if (!node.outputs || !node.outputs[slot])
    throw new Error(`Node ${node.id} output slot ${slot} missing`);
  const arr = node.outputs[slot].links ?? [];
  node.outputs[slot].links = [...arr, link];
}
function addLink(
  w: Workflow,
  origin: number,
  originSlot: number,
  target: number,
  targetSlot: number,
  type: string,
) {
  const id = ++w.last_link_id;
  w.links.push([id, origin, originSlot, target, targetSlot, type]);
  addOutputLink(getNode(w, origin), originSlot, id);
  setInputLink(getNode(w, target), targetSlot, id);
  return id;
}
function displayLabel(s: string) {
  return s
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}
function workflowOutputFileName(root: string) {
  const folder = path.basename(path.dirname(path.resolve(root))).trim();
  if (!folder) throw new Error('プロジェクト作成先フォルダ名を取得できません。');
  return `LoRA_${folder}.json`;
}
function loraStack(usages: any[], models: ModelsArtifact) {
  return JSON.stringify({
    version: 1,
    loras: usages.map((u) => {
      const m = models.loras.find((x) => x.ref === u.modelRef);
      if (!m) throw new Error(`Unknown modelRef ${u.modelRef}`);
      return {
        enabled: true,
        name: m.fileName,
        strength_model: u.strengthModel,
        strength_clip: u.strengthClip,
      };
    }),
  });
}
function sceneMatrix(branch: any) {
  return JSON.stringify({
    version: 1,
    sets: branch.leaves.map((l: any) => ({
      type: 'SCENE_MATRIX_LINE',
      version: 1,
      row_id: l.id,
      node_id: '',
      category: '',
      name: l.id,
      path_label: l.id,
      enabled: true,
      filename_enabled: true,
      positive_base: l.positive,
      positive_json: emptyJson,
      negative_base: l.negative,
      negative_json: emptyJson,
      category_order: '',
      positive_parts: [],
      negative_parts: [],
      display_labels: [],
      display_label_groups: [],
    })),
  });
}
function patchPrompter(node: Node, positive: string, negative: string) {
  const w = Array.isArray(node.widgets_values) ? [...node.widgets_values] : [];
  while (w.length < 11) w.push('');
  w[0] = 'Prompt Plan 共通';
  w[1] = positive;
  w[2] = emptyJson;
  w[3] = negative;
  w[4] = emptyJson;
  node.widgets_values = w;
  node.title = 'Prompt Plan 共通';
}
function familyOf(models: ModelsArtifact): ModelFamily {
  return models.modelFamily === 'anima' ? 'anima' : 'illustrious';
}
function patchBaseModelNodes(w: Workflow, manifest: WorkflowManifest, models: ModelsArtifact) {
  const family = familyOf(models),
    raw = models as ModelsArtifact & { diffusionModel?: { fileName: string } };
  if (family === 'anima') {
    const diffusion = raw.diffusionModel ?? raw.checkpoint;
    if (!diffusion || !models.textEncoder || !models.vae)
      throw new Error('Anima WorkflowにはDiffusion Model / Text Encoder / VAEが必要です。');
    getNode(w, roleNode(manifest, 'common', 'diffusionModel')).widgets_values = [
      diffusion.fileName,
      'default',
    ];
    getNode(w, roleNode(manifest, 'common', 'textEncoder')).widgets_values = [
      models.textEncoder.fileName,
      'stable_diffusion',
      'default',
    ];
    getNode(w, roleNode(manifest, 'common', 'vae')).widgets_values = [models.vae.fileName];
    return;
  }
  if (!models.checkpoint) throw new Error('Illustrious WorkflowにはCheckpointが必要です。');
  getNode(w, roleNode(manifest, 'common', 'checkpoint')).widgets_values = [
    models.checkpoint.fileName,
  ];
}
function validateCompiledWorkflow(
  w: Workflow,
  manifest: WorkflowManifest,
  plan: PromptPlanArtifact,
  projectId: string,
  branchMaps: Array<Map<number, number>>,
): ValidationIssue[] {
  const i: ValidationIssue[] = [];
  const nodeIds = w.nodes.map((n) => n.id),
    linkIds = w.links.map((l) => l[0]),
    groupIds = (w.groups ?? []).map((g) => g.id);
  const nodes = new Map(w.nodes.map((n) => [n.id, n]));
  if (new Set(nodeIds).size !== nodeIds.length)
    i.push({
      severity: 'error',
      code: 'NODE_ID_COLLISION',
      message: '生成WorkflowにNode ID衝突があります。',
    });
  if (new Set(linkIds).size !== linkIds.length)
    i.push({
      severity: 'error',
      code: 'LINK_ID_COLLISION',
      message: '生成WorkflowにLink ID衝突があります。',
    });
  if (new Set(groupIds).size !== groupIds.length)
    i.push({
      severity: 'error',
      code: 'GROUP_ID_COLLISION',
      message: '生成WorkflowにGroup ID衝突があります。',
    });
  for (const l of w.links) {
    const [id, o, os, t, ts] = l;
    if (!nodes.has(o) || !nodes.has(t)) {
      i.push({
        severity: 'error',
        code: 'DANGLING_LINK',
        message: `Link ${id} のNode参照が不正です。`,
      });
      continue;
    }
    const on = nodes.get(o)!,
      tn = nodes.get(t)!;
    if (!on.outputs?.[os] || !tn.inputs?.[ts]) {
      i.push({
        severity: 'error',
        code: 'DANGLING_SLOT',
        message: `Link ${id} のslot参照が不正です。`,
      });
      continue;
    }
    if (!(on.outputs[os].links ?? []).includes(id) || tn.inputs[ts].link !== id)
      i.push({
        severity: 'error',
        code: 'LINK_WIDGET_MISMATCH',
        message: `Link ${id} とNode入出力の参照が一致しません。`,
      });
  }
  if (w.last_node_id !== maxId(nodeIds))
    i.push({
      severity: 'error',
      code: 'LAST_NODE_ID',
      message: 'last_node_idが最大Node IDと一致しません。',
    });
  if (w.last_link_id !== maxId(linkIds))
    i.push({
      severity: 'error',
      code: 'LAST_LINK_ID',
      message: 'last_link_idが最大Link IDと一致しません。',
    });
  if (branchMaps.length !== plan.branches.length)
    i.push({
      severity: 'error',
      code: 'BRANCH_COUNT',
      message: '生成Branch数がPrompt Planと一致しません。',
    });
  branchMaps.forEach((map, index) => {
    const branch = plan.branches[index];
    if (!branch) return;
    const mapped = (role: string) => map.get(roleNode(manifest, 'branch', role));
    const loraId = mapped('loraStack'),
      counterId = mapped('counter'),
      matrixId = mapped('mainMatrix'),
      saveId = mapped('save');
    if (loraId == null || counterId == null || matrixId == null || saveId == null) {
      i.push({
        severity: 'error',
        code: 'BRANCH_ROLE_MAPPING',
        message: `${branch.id} のrole mappingが不足しています。`,
      });
      return;
    }
    const lora = nodes.get(loraId),
      counter = nodes.get(counterId),
      matrix = nodes.get(matrixId),
      save = nodes.get(saveId);
    const expectedLoraMode = branch.loras.length > 0 ? 0 : 4;
    if (lora?.mode !== expectedLoraMode)
      i.push({
        severity: 'error',
        code: 'LORA_STACK_MODE',
        message: `${branch.id} のLoRA Stack modeが不正です。`,
        path: branch.id,
      });
    if (counter?.widgets_values?.[0] !== 1)
      i.push({
        severity: 'error',
        code: 'COUNTER_COUNT',
        message: `${branch.id} のScenePromptCounter.countが1ではありません。`,
        path: branch.id,
      });
    const expectedPath = `BatchStudio/${projectId}/${branch.id}`;
    if (save?.widgets_values?.[0] !== expectedPath)
      i.push({
        severity: 'error',
        code: 'SAVE_PATH_MISMATCH',
        message: `${branch.id} のSave pathが不正です。`,
        path: branch.id,
      });
    try {
      const parsed = JSON.parse(String(matrix?.widgets_values?.[0] ?? ''));
      const sets = Array.isArray(parsed?.sets) ? parsed.sets : [];
      if (sets.length !== branch.leaves.length)
        i.push({
          severity: 'error',
          code: 'MATRIX_COUNT',
          message: `${branch.id} のMatrix行数がLeaf数と一致しません。`,
          path: branch.id,
        });
      branch.leaves.forEach((leaf, li) => {
        const row = sets[li];
        if (
          !row ||
          row.row_id !== leaf.id ||
          row.path_label !== leaf.id ||
          row.name !== leaf.id ||
          row.filename_enabled !== true
        )
          i.push({
            severity: 'error',
            code: 'LEAF_MATRIX_MAPPING',
            message: `${branch.id}/${leaf.id} のMatrix mappingが不正です。`,
            path: leaf.id,
          });
      });
    } catch {
      i.push({
        severity: 'error',
        code: 'MATRIX_JSON',
        message: `${branch.id} のMatrix JSONを解析できません。`,
        path: branch.id,
      });
    }
  });
  return i;
}

export async function compileWorkflow(root: string): Promise<CompileResult> {
  const issues: ValidationIssue[] = [];
  const models = await readJson<ModelsArtifact>(path.join(root, 'models.json'));
  const plan = await readJson<PromptPlanArtifact>(path.join(root, 'prompt_plan.json'));
  if (!models || !plan) throw new Error('models.json と prompt_plan.json の確定版が必要です。');
  const mv = validateModels(models);
  const pv = validatePromptPlan(plan, models);
  if (!mv.valid || !pv.valid)
    throw new Error(
      [...mv.issues, ...pv.issues]
        .filter((x) => x.severity === 'error')
        .map((x) => x.message)
        .join('\n'),
    );
  const meta = await readProjectMeta(root);
  const projectId = await projectIdFromBrief(root);
  const family = familyOf(models);
  const { templatePath, manifestPath } = resolveWorkflowTemplatePaths(meta?.settings, family);
  if (!(await exists(templatePath)) || !(await exists(manifestPath)))
    throw new Error('Workflow Template / Manifest が見つかりません。');
  const raw = await readText(templatePath);
  const manifest = await readJson<WorkflowManifest>(manifestPath);
  if (!raw || !manifest) throw new Error('Template / Manifest を解析できません。');
  const manifestValidation = validateWorkflowManifest(manifest);
  if (!manifestValidation.valid)
    throw new Error(
      manifestValidation.issues
        .filter((x) => x.severity === 'error')
        .map((x) => x.message)
        .join('\n'),
    );
  if (sha256(raw) !== manifest.template.sha256) throw new Error('Template SHA-256 mismatch');
  const w = JSON.parse(raw) as Workflow;
  const proto = new Set(manifest.branchPrototype.nodeIds);
  for (const [role, binding] of Object.entries(manifest.common.roles)) {
    getNode(w, binding.nodeId);
    if (proto.has(binding.nodeId)) throw new Error(`Common role ownership error: ${role}`);
  }
  for (const role of Object.keys(manifest.branchPrototype.roles)) {
    const nodeId = roleNode(manifest, 'branch', role);
    if (!proto.has(nodeId)) throw new Error(`Branch role ownership error: ${role}`);
    getNode(w, nodeId);
  }
  const workflowGroupIds = new Set((w.groups ?? []).map((g) => g.id));
  for (const id of manifest.branchPrototype.groupIds)
    if (!workflowGroupIds.has(id)) throw new Error(`Prototype group ${id} not found`);
  const internalLinks = w.links.filter((l) => proto.has(l[1]) && proto.has(l[3]));
  const cross = w.links.filter((l) => proto.has(l[1]) !== proto.has(l[3]));
  const crossSignature = (l: any[]) => `${l[1]}:${l[2]}>${l[3]}:${l[4]}`;
  const declaredSignatures = manifest.branchPrototype.boundaries.map(
    (b) =>
      `${roleNode(manifest, 'common', b.source.role)}:${b.source.slot}>${roleNode(manifest, 'branch', b.target.role)}:${b.target.slot}`,
  );
  if (new Set(declaredSignatures).size !== declaredSignatures.length)
    throw new Error('Manifest contains duplicate boundary mappings');
  const actualSignatures = cross.map(crossSignature);
  if (new Set(actualSignatures).size !== actualSignatures.length)
    throw new Error('Template contains duplicate cross-boundary links');
  if (
    actualSignatures.length !== declaredSignatures.length ||
    actualSignatures.some((sig) => !declaredSignatures.includes(sig)) ||
    declaredSignatures.some((sig) => !actualSignatures.includes(sig))
  )
    throw new Error('Manifest boundaries do not exactly match template cross-boundary links');
  const branchNodes = manifest.branchPrototype.nodeIds.map((id) => getNode(w, id));
  const branchGroups = (w.groups ?? []).filter((g) =>
    manifest.branchPrototype.groupIds.includes(g.id),
  );
  patchBaseModelNodes(w, manifest, models);
  const rootNode = getNode(w, roleNode(manifest, 'common', 'rootLoraStack'));
  rootNode.widgets_values = [loraStack(plan.rootLoras, models), null, null];
  patchPrompter(
    getNode(w, roleNode(manifest, 'common', 'planCommonPrompt')),
    plan.common.positive,
    plan.common.negative,
  );
  const baseNodeMax = maxId(w.nodes.map((n) => n.id)),
    baseGroupMax = maxId((w.groups ?? []).map((g) => g.id));
  let nextNode = baseNodeMax,
    nextGroup = baseGroupMax;
  const configure = (
    nodeMap: Map<number, number>,
    groupMap: Map<number, number>,
    branch: any,
    index: number,
  ) => {
    const id = (role: string) => nodeMap.get(roleNode(manifest, 'branch', role))!;
    const label = displayLabel(branch.label);
    const count = branch.leaves.length;
    const lora = getNode(w, id('loraStack'));
    lora.widgets_values = [loraStack(branch.loras, models), null, null];
    lora.mode = branch.loras.length > 0 ? 0 : 4;
    lora.title = `LoRA - ${branch.id} - ${label}`;
    const matrix = getNode(w, id('mainMatrix'));
    matrix.widgets_values = [sceneMatrix(branch), ''];
    matrix.title = `Prompt - ${branch.id} - ${label} (${count})`;
    const counter = getNode(w, id('counter'));
    counter.widgets_values = [1];
    counter.title = '1 image per leaf';
    const expand = getNode(w, id('expand'));
    const ew = Array.isArray(expand.widgets_values) ? [...expand.widgets_values] : [];
    while (ew.length < 6) ew.push('');
    ew[5] = family === 'anima' ? 'Anima' : 'Illustrious';
    expand.widgets_values = ew;
    if (family === 'anima' && manifest.branchPrototype.roles.animaLatent) {
      const source = getNode(w, id('latent')).widgets_values ?? [896, 1344, 1];
      const animaLatent = getNode(w, id('animaLatent'));
      animaLatent.widgets_values = [source[0] ?? 896, source[1] ?? 1344, source[2] ?? 1];
    }
    const save = getNode(w, id('save'));
    const sw = Array.isArray(save.widgets_values) ? [...save.widgets_values] : [];
    while (sw.length < 2) sw.push('');
    sw[0] = `BatchStudio/${projectId}/${branch.id}`;
    save.widgets_values = sw;
    save.title = `Save - ${branch.id} - ${label} (${count})`;
    for (const [old, newId] of groupMap) {
      const g = (w.groups ?? []).find((x) => x.id === newId);
      if (g && old === manifest.branchPrototype.groupIds[0])
        g.title = `Gen - ${branch.id} - ${label} (${count})`;
    }
  };
  const identity = new Map(manifest.branchPrototype.nodeIds.map((id) => [id, id]));
  const gidIdentity = new Map(manifest.branchPrototype.groupIds.map((id) => [id, id]));
  const branchMaps: Array<Map<number, number>> = [identity];
  configure(identity, gidIdentity, plan.branches[0], 0);
  for (let bi = 1; bi < plan.branches.length; bi++) {
    const offset = manifest.branchPrototype.layout.offset;
    const nmap = new Map<number, number>();
    for (const original of branchNodes) {
      const n = clone(original);
      const newId = ++nextNode;
      nmap.set(original.id, newId);
      n.id = newId;
      if (Array.isArray(n.pos)) n.pos = [n.pos[0] + offset.x * bi, n.pos[1] + offset.y * bi];
      for (const input of n.inputs ?? []) input.link = null;
      for (const output of n.outputs ?? []) output.links = null;
      w.nodes.push(n);
    }
    const gmap = new Map<number, number>();
    for (const original of branchGroups) {
      const g = clone(original);
      const newId = ++nextGroup;
      gmap.set(original.id, newId);
      g.id = newId;
      if (Array.isArray(g.bounding)) {
        g.bounding = [...g.bounding];
        g.bounding[0] += offset.x * bi;
        g.bounding[1] += offset.y * bi;
      }
      (w.groups ??= []).push(g);
    }
    for (const l of internalLinks) {
      const [, o, os, t, ts, type] = l;
      addLink(w, nmap.get(o)!, os, nmap.get(t)!, ts, type);
    }
    for (const b of manifest.branchPrototype.boundaries) {
      const sourceId = roleNode(manifest, 'common', b.source.role);
      const targetId = nmap.get(roleNode(manifest, 'branch', b.target.role))!;
      const originalCross = cross.find(
        (l) =>
          l[1] === sourceId &&
          l[2] === b.source.slot &&
          l[3] === roleNode(manifest, 'branch', b.target.role) &&
          l[4] === b.target.slot,
      );
      if (!originalCross) throw new Error(`Boundary ${b.id} does not match template link`);
      addLink(w, sourceId, b.source.slot, targetId, b.target.slot, originalCross[5]);
    }
    branchMaps.push(nmap);
    configure(nmap, gmap, plan.branches[bi], bi);
  }
  w.last_node_id = maxId(w.nodes.map((n) => n.id));
  w.last_link_id = maxId(w.links.map((l) => l[0]));
  issues.push(...validateCompiledWorkflow(w, manifest, plan, projectId, branchMaps));
  const apiGraph = buildApiGraph(w);
  issues.push(
    ...validateCompiledApiGraph(apiGraph, w, manifest, plan, models, projectId, branchMaps),
  );
  if (issues.some((x) => x.severity === 'error'))
    throw new Error(
      'Compiled workflow validation failed:\n' +
        issues
          .filter((x) => x.severity === 'error')
          .map((x) => x.message)
          .join('\n'),
    );
  const outputPath = path.join(root, workflowOutputFileName(root));
  const apiOutputPath = outputPath.replace(/\.json$/i, '.api.json');
  await writeJsonAtomic(outputPath, w);
  await writeJsonAtomic(apiOutputPath, apiGraph);
  const legacyOutputPath = path.join(root, `LoRA_${projectId}.json`);
  if (path.resolve(legacyOutputPath) !== path.resolve(outputPath))
    await removeIfExists(legacyOutputPath);
  const imageCount = plan.branches.reduce((n, b) => n + b.leaves.length, 0);
  const uiSha256 = hashCanonicalJson(w),
    apiSha256 = hashCanonicalJson(apiGraph),
    workflowIdentity = hashCanonicalJson({ uiSha256, apiSha256 });
  await saveWorkflowBuild(root, {
    compilerVersion: '2.1.0',
    generatedAt: new Date().toISOString(),
    template: {
      id: manifest.template.id,
      version: manifest.template.version,
      sha256: manifest.template.sha256,
    },
    manifest: {
      schemaVersion: manifest.schemaVersion,
      version: manifest.manifestVersion,
      sha256: sha256(JSON.stringify(manifest)),
    },
    branchCount: plan.branches.length,
    imageCount,
    outputPath: path.basename(outputPath),
    apiOutputPath: path.basename(apiOutputPath),
    outputs: {
      ui: { path: path.basename(outputPath), sha256: uiSha256 },
      api: { path: path.basename(apiOutputPath), sha256: apiSha256 },
    },
    workflowIdentity,
  });
  return {
    outputPath,
    apiOutputPath,
    branchCount: plan.branches.length,
    imageCount,
    nodeCount: w.nodes.length,
    linkCount: w.links.length,
    uiSha256,
    apiSha256,
    workflowIdentity,
    validation: { valid: !issues.some((i) => i.severity === 'error'), issues },
  };
}
async function projectIdFromBrief(root: string) {
  const b = await readJson<any>(path.join(root, 'project_brief.json'));
  if (!b?.project?.id) throw new Error('project.idがありません。');
  return b.project.id as string;
}
