import type {
  CatalogItem,
  ModelCatalog,
  ModelFamily,
  ModelSelectionBase,
  ModelSelectionRole,
  LoraSelection,
} from './types.js';
import { candidateVersions } from './model-selection.js';

type EditableRole = Extract<ModelSelectionRole, 'checkpoint' | 'lora'>;

export function catalogItemForSelection(
  catalog: ModelCatalog,
  selection: ModelSelectionBase,
  role: EditableRole,
  family?: ModelFamily,
): CatalogItem | null {
  const items = catalog.collections.flatMap((collection) =>
    collection.items.filter((item) => item.modelId === selection.modelId),
  );
  return (
    items.find((item) =>
      candidateVersions(item, role, family).some(
        (match) => match.version.versionId === selection.versionId,
      ),
    ) ??
    items.find((item) => candidateVersions(item, role, family).length > 0) ??
    null
  );
}

export function replaceSelectedModelVersion(
  selection: ModelSelectionBase,
  item: CatalogItem,
  role: EditableRole,
  versionId: number,
  fileId?: number,
  family?: ModelFamily,
): ModelSelectionBase {
  if (item.modelId !== selection.modelId) {
    throw new Error('別のモデルのバージョンは指定できません。');
  }
  const match = candidateVersions(item, role, family).find(
    (candidate) => candidate.version.versionId === versionId,
  );
  if (!match) throw new Error('指定したバージョンはこのモデルの候補にありません。');
  const preferredFileId =
    fileId ?? (versionId === selection.versionId ? selection.fileId : undefined);
  const file =
    preferredFileId == null
      ? (match.files.find((candidate) => candidate.primary) ?? match.files[0])
      : match.files.find((candidate) => candidate.id === preferredFileId);
  if (!file) throw new Error('指定したファイルはこのバージョンで使用できません。');

  const version = match.version;
  const next: ModelSelectionBase = {
    ...selection,
    modelName: item.modelName,
    versionId: version.versionId,
    versionName: version.versionName,
    fileId: file.id,
    fileName: file.name,
    modelUrl: `https://civitai.com/models/${item.modelId}?modelVersionId=${version.versionId}`,
    trainedWords:
      version.trainedWords ??
      (version.versionId === item.versionId ? item.trainedWords : undefined) ??
      [],
    reason: 'ユーザーがモデル選定画面でバージョン・ファイルを手動指定',
  };
  if (role === 'lora') {
    const lora = next as LoraSelection;
    delete lora.strengthBaseline;
    const baseline =
      version.strengthBaseline ??
      (version.versionId === item.versionId ? item.strengthBaseline : undefined);
    if (baseline) lora.strengthBaseline = baseline;
  }
  return next;
}
