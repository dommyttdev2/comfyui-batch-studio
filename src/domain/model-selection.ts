import type {
  CatalogFile,
  CatalogItem,
  CatalogVersion,
  ModelFamily,
  ModelSelectionRole,
} from './artifact-types.js';

const norm = (value?: string) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
const loraTypes = new Set(['lora', 'locon', 'dora']);
const primaryWeight = (file: CatalogFile) => {
  const type = norm(file.type);
  return type === 'model' || type === 'prunedmodel';
};
export function modelFamilyLabel(family: ModelFamily) {
  return family === 'anima' ? 'Anima' : 'Illustrious';
}
export function roleLabel(role: ModelSelectionRole) {
  return role === 'checkpoint'
    ? 'Checkpoint'
    : role === 'text_encoder'
      ? 'Text Encoder'
      : role === 'clip'
        ? 'CLIP'
        : 'LoRA';
}
export function selectionRef(role: Exclude<ModelSelectionRole, 'lora'>) {
  return role === 'checkpoint'
    ? 'checkpoint.main'
    : role === 'text_encoder'
      ? 'text_encoder.main'
      : 'clip.main';
}
export function fileMatchesRole(
  item: CatalogItem,
  file: CatalogFile,
  role: ModelSelectionRole,
): boolean {
  const modelType = norm(item.modelType);
  if (role === 'checkpoint') return modelType === 'checkpoint' && primaryWeight(file);
  if (role === 'text_encoder') return modelType === 'textencoder' && primaryWeight(file);
  if (role === 'clip') return modelType === 'clip' && primaryWeight(file);
  return loraTypes.has(modelType) && primaryWeight(file);
}
export function versionMatchesFamily(version: CatalogVersion, family: ModelFamily): boolean {
  if (!version.baseModel?.trim()) return true;
  return norm(version.baseModel) === norm(modelFamilyLabel(family));
}
export function candidateVersions(
  item: CatalogItem,
  role: ModelSelectionRole,
  family?: ModelFamily,
): Array<{ version: CatalogVersion; files: CatalogFile[] }> {
  const versions: CatalogVersion[] = item.versions?.length
    ? item.versions
    : [
        {
          versionId: item.versionId,
          versionName: item.versionName,
          baseModel: item.baseModel,
          files: item.files,
          trainedWords: item.trainedWords,
          modelUrl: item.modelUrl,
          thumbnailUrl: item.thumbnailUrl,
          thumbnailWidth: item.thumbnailWidth,
          thumbnailHeight: item.thumbnailHeight,
        },
      ];
  return versions.flatMap((version) => {
    if (role !== 'lora' && family && !versionMatchesFamily(version, family)) return [];
    const files = version.files.filter((file) => fileMatchesRole(item, file, role));
    return files.length ? [{ version, files }] : [];
  });
}
export function itemMatchesRole(item: CatalogItem, role: ModelSelectionRole, family?: ModelFamily) {
  return candidateVersions(item, role, family).length > 0;
}
