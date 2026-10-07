import path from 'node:path';
import { fileMatchesRole, versionMatchesFamily } from '../shared/model-selection.js';
import type {
  CatalogItem,
  CatalogStatus,
  CatalogVersion,
  ModelCatalog,
  ModelSelectionRole,
  ModelsArtifact,
  ValidationIssue,
  ValidationResult,
} from '../shared/types.js';
import { exists, readJson } from './fs-utils.js';
import { readProjectMeta } from './project-meta.js';
export async function catalogPathFor(root: string) {
  const global = (process.env.BATCH_STUDIO_CATALOG_PATH ?? '').trim();
  if (global) return global;
  const meta = await readProjectMeta(root);
  return meta?.settings.catalogPath?.trim() || null;
}
export async function loadCatalog(root: string): Promise<ModelCatalog | null> {
  const p = await catalogPathFor(root);
  if (!p) return null;
  return readJson<ModelCatalog>(path.resolve(p));
}
export async function catalogStatus(root: string): Promise<CatalogStatus> {
  const p = await catalogPathFor(root);
  if (!p) return { configured: false, path: null, exists: false, itemCount: 0 };
  const absolute = path.resolve(p);
  if (!(await exists(absolute)))
    return {
      configured: true,
      path: absolute,
      exists: false,
      itemCount: 0,
      error: 'model_catalog.jsonが見つかりません。',
    };
  const c = await readJson<ModelCatalog>(absolute);
  if (!c)
    return {
      configured: true,
      path: absolute,
      exists: true,
      itemCount: 0,
      error: 'model_catalog.jsonを解析できません。',
    };
  const count = (c.collections ?? []).reduce((n, x) => n + (x.items?.length ?? 0), 0);
  return {
    configured: true,
    path: absolute,
    exists: true,
    itemCount: count,
    schemaVersion: c.schemaVersion,
    generation: c.generation,
    generatedAt: c.generatedAt,
  };
}

import { validateModelsWithCatalog } from '../domain/catalog-validation.js';
export async function validateModelsAgainstCatalog(
  root: string,
  models: ModelsArtifact,
  base: ValidationResult,
): Promise<ValidationResult> {
  return validateModelsWithCatalog(await loadCatalog(root), models, base);
}
