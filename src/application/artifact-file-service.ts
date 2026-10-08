import type {
  ArtifactKey,
  ArtifactReadResult,
  ImportResult,
  MissingRequirement,
  ModelsArtifact,
  ProjectBriefInput,
  PromptPlanArtifact,
  ValidationResult,
  ModelCatalog,
} from '../domain/artifact-types.js';
import {
  mergeLoraImport,
  missing,
  promptFallbacks,
  promptFallbacksValid,
  rejectedModelsImport,
  splitModelDraft,
  validateLoraImportPayload,
  validateModelDraft,
} from '../domain/model-draft-policy.js';

import {
  parseModels,
  parsePromptPlan,
  validateModels,
  validateProjectBrief,
  validatePromptPlan,
} from '../domain/artifact-validation.js';
import { validateModelsWithCatalog } from '../domain/catalog-validation.js';
import { modelGenerationInputsChanged } from '../domain/model-impact.js';
export interface ArtifactFilePorts {
  path: { join(...parts: string[]): string };
  readJson<T>(file: string): Promise<T | null>;
  readText(file: string): Promise<string | null>;
  exists(file: string): Promise<boolean>;
  backupIfExists(file: string, history: string): Promise<unknown>;
  removeIfExists(file: string): Promise<void>;
  writeTextAtomic(file: string, content: string): Promise<void>;
  writeJsonAtomic(file: string, value: unknown): Promise<void>;
  mkdir(directory: string): Promise<void>;
  readdir(directory: string): Promise<string[]>;
  loadCatalog(root: string): Promise<ModelCatalog | null>;
  resetModelDownstream(root: string, options: { clearModelFixHistory: boolean }): Promise<unknown>;
  initializeProjectMeta(root: string, settings: { artifactOutputPath?: string }): Promise<unknown>;
  projectTransactionCheckpoint(name: string): Promise<void>;
  withProjectTransaction<T>(root: string, operation: string, action: () => Promise<T>): Promise<T>;
  artifactRoot(): string;
  now(): string;
  nextId(): string;
}
export function createArtifactFileService(io: ArtifactFilePorts) {
  const {
    path,
    readJson,
    readText,
    exists,
    backupIfExists,
    removeIfExists,
    writeTextAtomic,
    writeJsonAtomic,
    mkdir,
    readdir,
    loadCatalog,
    resetModelDownstream,
    initializeProjectMeta,
    projectTransactionCheckpoint,
    withProjectTransaction,
  } = io;
  const validateModelsAgainstCatalog = async (
    root: string,
    models: ModelsArtifact,
    base: ValidationResult,
  ) => validateModelsWithCatalog(await loadCatalog(root), models, base);
  const FILES: Partial<Record<ArtifactKey, string>> = {
    projectBrief: 'project_brief.json',
    story: 'story.md',
    models: 'models.json',
    promptPlan: 'prompt_plan.json',
  };
  const DRAFTS: Partial<Record<ArtifactKey, string>> = {
    story: 'story.md',
    models: 'models.json',
    promptPlan: 'prompt_plan.json',
  };
  type GrokImportKey = 'story' | 'models' | 'promptPlan';
  type GrokResponseStage =
    | 'story-finalize'
    | 'story-fix'
    | 'models'
    | 'models-fix'
    | 'prompt-plan'
    | 'prompt-plan-fix';
  type ModelsDraftSource = { schemaVersion: 1; stage: 'models' | 'models-fix' };
  const internalDir = (root: string) => path.join(root, '._batch_studio');
  function draftPath(root: string, key: ArtifactKey) {
    const n = DRAFTS[key];
    if (!n) throw new Error(`No draft mapping for ${key}`);
    return path.join(internalDir(root), 'drafts', n);
  }
  function confirmedPath(root: string, key: ArtifactKey) {
    const n = FILES[key];
    if (!n) throw new Error(`No artifact mapping for ${key}`);
    return path.join(root, n);
  }
  function promptFallbacksPath(root: string) {
    return path.join(internalDir(root), 'model_prompt_fallbacks.json');
  }
  function modelsDraftSourcePath(root: string) {
    return path.join(internalDir(root), 'draft-sources', 'models.json');
  }
  async function readModelsDraftSource(root: string): Promise<ModelsDraftSource | null> {
    const value = await readJson<ModelsDraftSource>(modelsDraftSourcePath(root));
    return value?.schemaVersion === 1 && (value.stage === 'models' || value.stage === 'models-fix')
      ? value
      : null;
  }
  function fence(raw: string, lang?: string) {
    const spec = lang ?? '[a-zA-Z0-9_-]*';
    const m = raw.match(new RegExp('```' + spec + '\\s*\\n([\\s\\S]*?)```', 'i'));
    return m?.[1]?.trim() ?? null;
  }
  function jsonCandidate(raw: string) {
    const f = fence(raw, 'json');
    if (f) return f;
    const a = raw.indexOf('{'),
      b = raw.lastIndexOf('}');
    return a >= 0 && b > a ? raw.slice(a, b + 1).trim() : raw.trim();
  }
  function promptPlanJsonParseMessage(content: string): string {
    const candidate = content.trim();
    if (!candidate) return 'prompt_plan.jsonが空です。完成したJSON全文を再生成してください。';
    if (!candidate.startsWith('{'))
      return 'prompt_plan.jsonの先頭がJSONオブジェクトではありません。説明文や部分的な回答ではなく、完成したJSON全文が必要です。';
    if (!candidate.endsWith('}'))
      return 'prompt_plan.jsonの末尾が閉じられていません。生成結果が途中で切れている可能性があります。既存の計画を修正する場合は、全文再生成ではなく「Prompt Planを部分修正（差分）」を利用してください。';
    return 'prompt_plan.jsonのJSON構文が不正です。修正前に失敗した回答を確認してください。';
  }
  function storyCandidate(raw: string) {
    return fence(raw, 'markdown') ?? fence(raw, 'md') ?? fence(raw) ?? raw.trim();
  }
  function grokResponseStage(key: GrokImportKey, isFix: boolean): GrokResponseStage {
    if (key === 'story') return isFix ? 'story-fix' : 'story-finalize';
    if (key === 'models') return isFix ? 'models-fix' : 'models';
    return isFix ? 'prompt-plan-fix' : 'prompt-plan';
  }
  function stageMatchesKey(key: GrokImportKey, stage: GrokResponseStage) {
    if (key === 'story') return stage === 'story-finalize' || stage === 'story-fix';
    if (key === 'models') return stage === 'models' || stage === 'models-fix';
    return stage === 'prompt-plan' || stage === 'prompt-plan-fix';
  }
  async function saveRawGrokResponse(
    root: string,
    key: GrokImportKey,
    raw: string,
    stageOverride?: GrokResponseStage,
    provider: 'grok' | 'codex' = 'grok',
  ) {
    const isFix = await exists(confirmedPath(root, key)),
      inferred = grokResponseStage(key, isFix),
      stage = stageOverride ?? inferred;
    if (!stageMatchesKey(key, stage))
      throw new Error(`Invalid Grok response stage for ${key}: ${stage}`);
    const stamp = io.now().replace(/[:.]/g, '-');
    const file = path.join(
      internalDir(root),
      provider === 'codex' ? 'codex-responses' : 'grok-responses',
      stage,
      `${stamp}-${io.nextId()}.txt`,
    );
    await writeTextAtomic(file, raw);
    return { file, stage };
  }
  async function validateContent(
    root: string,
    key: ArtifactKey,
    content: string,
  ): Promise<ValidationResult> {
    if (key === 'story')
      return {
        valid: !!content.trim(),
        issues: content.trim()
          ? []
          : [{ severity: 'error', code: 'STORY_EMPTY', message: 'ストーリーが空です。' }],
      };
    if (key === 'models') {
      const p = parseModels(content);
      if (!p)
        return {
          valid: false,
          issues: [
            {
              severity: 'error',
              code: 'MODELS_PARSE',
              message: 'models.jsonをJSONとして解析できません。',
            },
          ],
        };
      const schemaCandidate = splitModelDraft(p).models,
        base = validateModelDraft(p);
      return base.valid ? validateModelsAgainstCatalog(root, schemaCandidate, base) : base;
    }
    if (key === 'promptPlan') {
      const p = parsePromptPlan(content);
      if (!p)
        return {
          valid: false,
          issues: [
            {
              severity: 'error',
              code: 'PLAN_PARSE',
              message: promptPlanJsonParseMessage(content),
            },
          ],
        };
      const mt = await readText(path.join(root, 'models.json'));
      return validatePromptPlan(p, mt ? parseModels(mt) : null);
    }
    if (key === 'projectBrief') {
      try {
        return validateProjectBrief(JSON.parse(content) as ProjectBriefInput);
      } catch {
        return {
          valid: false,
          issues: [
            {
              severity: 'error',
              code: 'BRIEF_PARSE',
              message: 'project_brief.jsonを解析できません。',
            },
          ],
        };
      }
    }
    return { valid: true, issues: [] };
  }
  async function refreshModelsCatalogProvenance(
    root: string,
    source: 'confirmed' | 'draft',
    file: string,
    content: string,
  ) {
    if (source === 'confirmed' && (await exists(draftPath(root, 'models')))) return content;
    const parsed: any = parseModels(content);
    if (!parsed) return content;
    const schemaCandidate = JSON.parse(JSON.stringify(parsed));
    delete schemaCandidate.missingRequirements;
    delete schemaCandidate.promptFallbacks;
    const base = validateModels(schemaCandidate);
    if (!base.valid) return content;
    const checked = await validateModelsAgainstCatalog(root, schemaCandidate, base);
    if (!checked.valid) return content;
    const catalog = await loadCatalog(root);
    if (!catalog) return content;
    const current = parsed.catalog;
    if (
      current?.schemaVersion === catalog.schemaVersion &&
      current?.generation === catalog.generation &&
      current?.generatedAt === catalog.generatedAt
    )
      return content;
    parsed.catalog = {
      schemaVersion: catalog.schemaVersion,
      generation: catalog.generation,
      generatedAt: catalog.generatedAt,
    };
    const updated = JSON.stringify(parsed, null, 2) + '\n';
    await writeTextAtomic(file, updated);
    return updated;
  }
  async function readArtifact(
    root: string,
    key: ArtifactKey,
    source: 'confirmed' | 'draft',
  ): Promise<ArtifactReadResult> {
    if (!FILES[key] && source === 'confirmed')
      return {
        key,
        source,
        content: null,
        exists: false,
        validation: {
          valid: false,
          issues: [{ severity: 'error', code: 'MISSING', message: '対象Artifactではありません。' }],
        },
      };
    if (!DRAFTS[key] && source === 'draft')
      return {
        key,
        source,
        content: null,
        exists: false,
        validation: {
          valid: false,
          issues: [{ severity: 'error', code: 'MISSING', message: '下書き対象ではありません。' }],
        },
      };
    const file = source === 'confirmed' ? confirmedPath(root, key) : draftPath(root, key);
    let content = await readText(file);
    if (key === 'models' && content != null)
      content = await refreshModelsCatalogProvenance(root, source, file, content);
    return {
      key,
      source,
      content,
      exists: content != null,
      validation:
        content == null
          ? {
              valid: false,
              issues: [{ severity: 'error', code: 'MISSING', message: 'ファイルがありません。' }],
            }
          : await validateContent(root, key, content),
    };
  }
  async function saveDraft(root: string, key: 'story' | 'models' | 'promptPlan', content: string) {
    if (key === 'models') await removeIfExists(modelsDraftSourcePath(root));
    await writeTextAtomic(draftPath(root, key), content.endsWith('\n') ? content : content + '\n');
    return readArtifact(root, key, 'draft');
  }
  async function importGrok(
    root: string,
    key: 'story' | 'models' | 'promptPlan',
    raw: string,
    stageOverride?: GrokResponseStage,
    options: { automatic?: boolean; provider?: 'grok' | 'codex' } = {},
  ): Promise<ImportResult> {
    const response = await saveRawGrokResponse(root, key, raw, stageOverride, options.provider);
    let extracted = key === 'story' ? storyCandidate(raw) : jsonCandidate(raw),
      miss: MissingRequirement[] = [];
    if (key === 'models') {
      let payload: any;
      try {
        payload = JSON.parse(extracted);
      } catch {
        return rejectedModelsImport(
          extracted,
          'MODELS_PARSE',
          'GrokのLoRA選定ファイルをJSONとして解析できません。',
        );
      }
      miss = missing(payload);
      const rejected = validateLoraImportPayload(payload, extracted);
      if (rejected) return rejected;
      const baseText =
        (await readText(draftPath(root, 'models'))) ??
        (await readText(confirmedPath(root, 'models')));
      const base = baseText ? parseModels(baseText) : null;
      if (!base || ![2, 3, 4, 5].includes(base.schemaVersion))
        return rejectedModelsImport(
          extracted,
          'BASE_MODELS_REQUIRED',
          '先にModel系統とユーザー選択モデルを保存してください。',
          miss,
        );
      const merged = mergeLoraImport(base, payload, false);
      extracted = JSON.stringify(merged, null, 2);
    }
    // A failed LoRA re-selection must not replace the current models draft,
    // including when the return file is imported manually.
    // Other manual artifacts retain their existing editable-draft flow.
    if (options.automatic || key === 'models') {
      const checked = await validateContent(root, key, extracted);
      if (!checked.valid || miss.length)
        return {
          extracted,
          rawResponsePath: response.file,
          validation: checked.valid
            ? {
                valid: false,
                issues: [
                  ...checked.issues,
                  {
                    severity: 'error',
                    code: 'MISSING_REQUIREMENTS',
                    message: `未解決の不足モデルが${miss.length}件あります。`,
                  },
                ],
              }
            : checked,
          summary: {},
          missingRequirements: miss,
        };
    }
    const saved = await saveDraft(root, key, extracted);
    if (key === 'models' && (response.stage === 'models' || response.stage === 'models-fix'))
      await writeJsonAtomic(modelsDraftSourcePath(root), {
        schemaVersion: 1,
        stage: response.stage,
      } satisfies ModelsDraftSource);
    const issues = [...saved.validation.issues];
    if (miss.length && !issues.some((x) => x.code === 'MISSING_REQUIREMENTS'))
      issues.push({
        severity: 'error',
        code: 'MISSING_REQUIREMENTS',
        message: `未解決の不足モデルが${miss.length}件あります。`,
      });
    const validation = { valid: !issues.some((x) => x.severity === 'error'), issues };
    const summary: Record<string, string | number | boolean | null> = {};
    if (key === 'models') {
      const p: any = parseModels(saved.content ?? extracted);
      if (p) {
        summary.loras = p.loras.length;
        summary.promptFallbacks = promptFallbacks(p).length;
      }
    }
    if (key === 'promptPlan') {
      const p = parsePromptPlan(extracted);
      if (p) {
        summary.branches = p.branches.length;
        summary.items = p.branches.reduce((n, b) => n + b.leaves.length, 0);
        summary.images = summary.items;
      }
    }
    return {
      extracted: saved.content ?? extracted,
      validation,
      summary,
      missingRequirements: miss,
    };
  }
  async function confirmArtifact(root: string, key: 'story' | 'models' | 'promptPlan') {
    return key === 'models'
      ? withProjectTransaction(root, 'confirm-models', () => confirmArtifactUnlocked(root, key))
      : confirmArtifactUnlocked(root, key);
  }
  async function confirmArtifactUnlocked(root: string, key: 'story' | 'models' | 'promptPlan') {
    const d = await readArtifact(root, key, 'draft');
    if (!d.exists || !d.content) throw new Error('確定する下書きがありません。');
    if (!d.validation.valid) throw new Error('検証エラーがあるため確定できません。');
    const target = confirmedPath(root, key);
    const previousText = key === 'models' ? await readText(target) : null;
    const previousModels = previousText ? parseModels(previousText) : null;
    const previousFallbacks =
      key === 'models' ? promptFallbacks(await readJson<any>(promptFallbacksPath(root))) : [];
    const source = key === 'models' ? await readModelsDraftSource(root) : null;
    await backupIfExists(target, path.join(internalDir(root), 'history', key));
    let downstreamReset = false;
    if (key === 'models') {
      const raw = JSON.parse(d.content) as any;
      const fallbacks = promptFallbacks(raw);
      delete raw.promptFallbacks;
      delete raw.missingRequirements;
      const nextModels = raw as ModelsArtifact;
      downstreamReset =
        previousText != null &&
        (!previousModels ||
          modelGenerationInputsChanged(previousModels, previousFallbacks, nextModels, fallbacks));
      await writeJsonAtomic(target, nextModels);
      await projectTransactionCheckpoint('models:confirmed');
      if (fallbacks.length)
        await writeJsonAtomic(promptFallbacksPath(root), {
          schemaVersion: 2,
          promptFallbacks: fallbacks,
        });
      else await removeIfExists(promptFallbacksPath(root));
      await projectTransactionCheckpoint('models:fallbacks-updated');
      if (downstreamReset)
        await resetModelDownstream(root, { clearModelFixHistory: source?.stage !== 'models-fix' });
    } else await writeTextAtomic(target, d.content);
    await removeIfExists(draftPath(root, key));
    if (key === 'models') await removeIfExists(modelsDraftSourcePath(root));
    return { downstreamReset };
  }
  async function createProject(parent: string, brief: ProjectBriefInput) {
    const v = validateProjectBrief(brief);
    if (!v.valid) throw new Error(v.issues.map((i) => i.message).join('\n'));
    const root = path.join(parent, brief.project.id);
    if (await exists(root)) {
      const es = await readdir(root);
      if (es.length) throw new Error('同名のプロジェクトフォルダーが既に存在します。');
    }
    const artifactRoot = io.artifactRoot().trim(),
      artifactOutputPath = artifactRoot ? path.join(artifactRoot, brief.project.id) : null;
    await mkdir(path.join(root, '._batch_studio', 'drafts'));
    await mkdir(path.join(root, '._batch_studio', 'history'));
    if (artifactOutputPath) await mkdir(artifactOutputPath);
    await writeJsonAtomic(path.join(root, 'project_brief.json'), { schemaVersion: 1, ...brief });
    await initializeProjectMeta(root, artifactOutputPath ? { artifactOutputPath } : {});
    return root;
  }
  async function savePromptPlan(root: string, plan: PromptPlanArtifact) {
    return saveDraft(root, 'promptPlan', JSON.stringify(plan, null, 2));
  }
  async function beginEditArtifact(root: string, key: 'story' | 'models' | 'promptPlan') {
    const currentDraft = await readArtifact(root, key, 'draft');
    if (currentDraft.exists) return currentDraft;
    const confirmed = await readArtifact(root, key, 'confirmed');
    if (!confirmed.exists || confirmed.content == null) return currentDraft;
    return saveDraft(root, key, confirmed.content);
  }
  async function saveProjectBrief(root: string, brief: ProjectBriefInput) {
    const v = validateProjectBrief(brief);
    if (!v.valid) throw new Error(v.issues.map((i) => i.message).join('\n'));
    const target = path.join(root, 'project_brief.json'),
      next = { schemaVersion: 1, ...brief },
      current = await readText(target);
    let currentId: string | null = null,
      currentValue: any = null;
    if (current) {
      try {
        currentValue = JSON.parse(current);
        currentId = currentValue?.project?.id ?? null;
      } catch {}
    }
    if (currentId && currentId !== brief.project.id)
      throw new Error('既存プロジェクトのproject.idは変更できません。');
    if (currentValue && JSON.stringify(currentValue) === JSON.stringify(next)) return;
    await backupIfExists(target, path.join(internalDir(root), 'history', 'projectBrief'));
    await writeJsonAtomic(target, next);
  }

  return {
    internalDir,
    draftPath,
    confirmedPath,
    readArtifact,
    saveDraft,
    importGrok,
    confirmArtifact,
    createProject,
    savePromptPlan,
    beginEditArtifact,
    saveProjectBrief,
  };
}
