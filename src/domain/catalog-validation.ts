import type {
  CatalogItem,
  CatalogVersion,
  ModelCatalog,
  ModelSelectionRole,
  ModelsArtifact,
  ValidationIssue,
  ValidationResult,
} from './artifact-types.js';
import { fileMatchesRole, versionMatchesFamily } from './model-selection.js';

function findItem(c: ModelCatalog, modelId: number) {
  for (const collection of c.collections ?? []) {
    const item = collection.items?.find((x) => x.modelId === modelId);
    if (item) return item;
  }
  return null;
}
function versionAndFile(
  item: CatalogItem,
  versionId: number,
  fileId: number,
): { version: CatalogVersion; file: CatalogVersion['files'][number] } | null {
  const version =
    (item.versions ?? []).find((v) => v.versionId === versionId) ??
    (item.versionId === versionId
      ? {
          versionId: item.versionId,
          versionName: item.versionName,
          files: item.files,
          trainedWords: item.trainedWords,
          modelUrl: item.modelUrl,
          thumbnailUrl: item.thumbnailUrl,
          thumbnailWidth: item.thumbnailWidth,
          thumbnailHeight: item.thumbnailHeight,
        }
      : null);
  if (!version) return null;
  const file = (version.files ?? []).find((f) => f.id === fileId);
  return file ? { version, file } : null;
}
export function validateModelsWithCatalog(
  c: ModelCatalog | null,
  m: ModelsArtifact,
  base: ValidationResult,
): ValidationResult {
  const issues: ValidationIssue[] = [...base.issues];
  if (!c) {
    issues.push({
      severity: 'error',
      code: 'CATALOG_MISSING',
      message: 'モデルカタログが設定されていません。',
    });
    return { valid: false, issues };
  }
  if (c.generation !== m.catalog.generation)
    issues.push({
      severity: 'warning',
      code: 'CATALOG_GENERATION_CHANGED',
      message: `カタログgenerationが ${m.catalog.generation} → ${c.generation} に変わっています。選定identityを再検証しました。`,
    });
  const baseSelection =
    m.schemaVersion === 5 && m.modelFamily === 'anima' ? m.diffusionModel : m.checkpoint;
  const selections: Array<{ role: ModelSelectionRole; selection: any }> = [
    ...(baseSelection ? [{ role: 'checkpoint' as const, selection: baseSelection }] : []),
    ...(m.schemaVersion === 2 && m.textEncoder
      ? [{ role: 'text_encoder' as const, selection: m.textEncoder }]
      : []),
    ...(m.schemaVersion === 2 && m.clip ? [{ role: 'clip' as const, selection: m.clip }] : []),
    ...m.loras.map((x) => ({ role: 'lora' as const, selection: x })),
  ];
  for (const { role, selection: s } of selections) {
    const item = findItem(c, s.modelId);
    if (!item) {
      issues.push({
        severity: 'error',
        code: 'MODEL_NOT_FOUND',
        message: `catalogにmodelId=${s.modelId}がありません。`,
        path: s.ref,
      });
      continue;
    }
    const vf = versionAndFile(item, s.versionId, s.fileId);
    if (!vf) {
      issues.push({
        severity: 'error',
        code: 'VERSION_FILE_NOT_FOUND',
        message: `${s.ref} のversion/file identityがcatalogにありません。`,
        path: s.ref,
      });
      continue;
    }
    if (vf.file.name !== s.fileName)
      issues.push({
        severity: 'error',
        code: 'FILE_NAME_MISMATCH',
        message: `${s.ref} のfileNameがcatalogと一致しません。`,
        path: s.ref,
      });
    if (item.modelName !== s.modelName)
      issues.push({
        severity: 'warning',
        code: 'MODEL_NAME_CHANGED',
        message: `${s.ref} のモデル名がcatalog側で変更されています。`,
        path: s.ref,
      });
    if (m.schemaVersion >= 2) {
      if (!fileMatchesRole(item, vf.file, role))
        issues.push({
          severity: 'error',
          code: 'MODEL_ROLE_MISMATCH',
          message: `${s.ref} は ${role} 用のCivitaiモデルではありません。`,
          path: s.ref,
        });
      if (role !== 'lora' && m.modelFamily && !versionMatchesFamily(vf.version, m.modelFamily))
        issues.push({
          severity: 'error',
          code: 'MODEL_FAMILY_MISMATCH',
          message: `${s.ref} のbaseModelが ${m.modelFamily} と一致しません。`,
          path: s.ref,
        });
    }
  }
  return { valid: !issues.some((x) => x.severity === 'error'), issues };
}
