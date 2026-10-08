import type {
  CatalogSelectionTemplate,
  CatalogSelectionTemplateInput,
  R2BatchDownloadTemplate,
} from './integration-types.js';
import {
  normalizeBatchTemplateName,
  normalizeBatchTemplateObjects,
  MAX_BATCH_TEMPLATES_PER_BUCKET,
} from './r2-storage-policy.js';
export interface R2TemplateInput {
  id?: string;
  name: string;
  bucket: string;
  objects: Array<{ key: string; name: string; size?: number }>;
}
export function saveR2Template(
  templates: readonly R2BatchDownloadTemplate[],
  input: R2TemplateInput,
  now: string,
  nextId: () => string,
) {
  const name = normalizeBatchTemplateName(input.name),
    bucket = String(input.bucket ?? '').trim(),
    objects = normalizeBatchTemplateObjects(input.objects);
  if (!bucket) throw new Error('バケットを指定してください。');
  const i = input.id ? templates.findIndex((x) => x.id === input.id) : -1;
  if (input.id && i < 0) throw new Error('テンプレートが見つかりません。');
  if (
    templates.some(
      (x, index) =>
        index !== i &&
        x.bucket === bucket &&
        x.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    )
  )
    throw new Error('同名のテンプレートがすでに存在します。');
  if (
    i < 0 &&
    templates.filter((x) => x.bucket === bucket).length >= MAX_BATCH_TEMPLATES_PER_BUCKET
  )
    throw new Error('1つのバケットに保存できるテンプレートは100件までです。');
  if (i >= 0 && templates[i].bucket !== bucket)
    throw new Error('テンプレートのバケットが一致しません。');
  const value: R2BatchDownloadTemplate = {
    id: input.id || nextId(),
    name,
    bucket,
    createdAt: i >= 0 ? templates[i].createdAt : now,
    updatedAt: now,
    objects,
  };
  const next = [...templates];
  if (i >= 0) next[i] = value;
  else next.push(value);
  return next;
}
export function saveCatalogSelectionTemplate(
  templates: readonly CatalogSelectionTemplate[],
  input: CatalogSelectionTemplateInput,
  now: string,
  nextId: () => string,
) {
  const name = input.name.trim();
  if (!name) throw new Error('テンプレート名を入力してください。');
  const existing = input.id ? templates.find((x) => x.id === input.id) : null;
  const value: CatalogSelectionTemplate = {
    id: existing?.id ?? nextId(),
    name: name.slice(0, 60),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    selection: input.selection,
  };
  return [...templates.filter((x) => x.id !== value.id), value].sort((a, b) =>
    a.name.localeCompare(b.name, 'ja'),
  );
}
export function deleteSavedTemplate<T extends { id: string }>(
  templates: readonly T[],
  id: string,
): T[] {
  return templates.filter((x) => x.id !== id);
}
