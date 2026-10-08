import { assessModelAvailability, modelAvailabilityState } from '../domain/availability-policy.js';
import {
  effectiveModelFamily,
  remoteModelRelativePath,
  requiredModelSelections,
} from '../domain/model-placement.js';
import type {
  AvailabilityResult,
  ExecutionTarget,
  ModelAvailabilityRow,
  ModelsArtifact,
  ProjectMeta,
} from '../domain/artifact-types.js';
import type { LoraFileAvailability } from '../domain/resource-observation-types.js';
export interface ModelAvailabilityPorts {
  path: { join(...parts: string[]): string; basename(file: string): string };
  exists(file: string): Promise<boolean>;
  readJson<T>(file: string): Promise<T | null>;
  readProjectMeta(root: string): Promise<ProjectMeta | null>;
  findRecursive(root: string, target: string): Promise<string | null>;
  r2IndexPath(): string;
}
export function createModelAvailabilityObservation(io: ModelAvailabilityPorts) {
  const { path, exists, readJson, readProjectMeta, findRecursive } = io;
  async function indexedR2Names(r2Index: string) {
    const names = new Set<string>();
    if (!r2Index) return names;
    const raw = await readJson<any>(r2Index);
    const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.files) ? raw.files : [];
    for (const x of arr) {
      const name =
        typeof x === 'string'
          ? path.basename(x)
          : typeof x?.name === 'string'
            ? path.basename(x.name)
            : typeof x?.key === 'string'
              ? path.basename(x.key)
              : '';
      if (name) names.add(name);
    }
    return names;
  }

  async function checkLoraFileAvailability(
    root: string,
    fileNames: string[],
    r2Lookup?: ((fileName: string) => Promise<boolean>) | null,
    localModelsRoot?: string | null,
  ): Promise<LoraFileAvailability[]> {
    const meta = await readProjectMeta(root),
      legacyLocalRoot = meta?.settings.comfyModelsRoot?.trim() || '',
      localRoot = (
        localModelsRoot === undefined ? legacyLocalRoot : (localModelsRoot ?? '')
      ).trim();
    const r2Index = io.r2IndexPath().trim() || meta?.settings.r2IndexPath?.trim() || '',
      r2Names = r2Lookup ? new Set<string>() : await indexedR2Names(r2Index),
      localRootExists = Boolean(localRoot && (await exists(localRoot)));
    const unique = [...new Set(fileNames.map((x) => path.basename(x.trim())).filter(Boolean))],
      rows: LoraFileAvailability[] = [];
    for (const fileName of unique) {
      const local = localRootExists ? !!(await findRecursive(localRoot, fileName)) : false,
        r2Found = r2Lookup ? await r2Lookup(fileName) : r2Names.has(fileName);
      rows.push({ fileName, local, r2: r2Found });
    }
    return rows;
  }

  async function checkAvailability(
    root: string,
    r2Lookup?: ((fileName: string) => Promise<boolean>) | null,
    localModelsRoot?: string | null,
  ): Promise<AvailabilityResult> {
    const meta = await readProjectMeta(root),
      executionTarget: ExecutionTarget =
        meta?.settings.executionTarget === 'remote' ? 'remote' : 'local';
    const legacyLocalRoot = meta?.settings.comfyModelsRoot?.trim() || '';
    const localRoot = (
      localModelsRoot === undefined ? legacyLocalRoot : (localModelsRoot ?? '')
    ).trim();
    const draftModels = await readJson<ModelsArtifact>(
      path.join(root, '._batch_studio', 'drafts', 'models.json'),
    );
    const models = draftModels ?? (await readJson<ModelsArtifact>(path.join(root, 'models.json')));
    if (!models)
      return {
        rows: [],
        executionTarget,
        localModelsRoot: localRoot || null,
        validation: {
          valid: false,
          issues: [
            { severity: 'error', code: 'MODELS_MISSING', message: 'models.jsonがありません。' },
          ],
        },
      };
    const r2Index = io.r2IndexPath().trim() || meta?.settings.r2IndexPath?.trim() || '',
      r2Names = r2Lookup ? new Set<string>() : await indexedR2Names(r2Index);
    const localRootExists = Boolean(localRoot && (await exists(localRoot)));
    const family = effectiveModelFamily(models),
      selections = requiredModelSelections(models),
      rows: ModelAvailabilityRow[] = [];
    for (const s of selections) {
      const relative = remoteModelRelativePath(family, s.kind, s.fileName),
        exactLocal = localRootExists ? path.join(localRoot, ...relative.split('/')) : null,
        localPath =
          exactLocal && (await exists(exactLocal))
            ? exactLocal
            : localRootExists
              ? await findRecursive(localRoot, s.fileName)
              : null,
        local = !!localPath,
        r2Found = r2Lookup ? await r2Lookup(relative) : r2Names.has(path.basename(s.fileName));
      rows.push({
        ref: s.ref,
        fileName: s.fileName,
        kind: s.kind,
        local,
        r2: r2Found,
        state: modelAvailabilityState(executionTarget, local, r2Found),
        localPath: localPath ?? undefined,
      });
    }
    return assessModelAvailability(rows, executionTarget, localRoot, localRootExists);
  }

  return { checkLoraFileAvailability, checkAvailability };
}
