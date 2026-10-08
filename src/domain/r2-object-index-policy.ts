import type { R2Object, R2SearchResult } from './resource-observation-types.js';
const PAGE_SIZE = 250;
const clean = (value: string) => value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
export function searchIndexedObjects(
  entries: R2Object[],
  query: string,
  token?: string | null,
): R2SearchResult {
  const all = entries,
    q = query.trim().normalize('NFKC').toLocaleLowerCase();
  if (!q) return { objects: [], nextToken: null, scanned: all.length };
  const matches = all.filter((o) => o.key.normalize('NFKC').toLocaleLowerCase().includes(q)),
    offset = token?.startsWith('local:') ? Math.max(0, Number(token.slice(6)) || 0) : 0,
    objects = matches.slice(offset, offset + PAGE_SIZE),
    next = offset + objects.length;
  return {
    objects,
    nextToken: next < matches.length ? `local:${next}` : null,
    scanned: all.length,
  };
}
export function resolveIndexedModelKey(
  objects: R2Object[],
  relativePath: string,
  prefix = '',
): string | null {
  const normalizedPrefix = clean(prefix),
    wanted = clean(relativePath);
  if (!wanted) return null;
  const exact = `${normalizedPrefix ? `${normalizedPrefix}/` : ''}${wanted}`;
  if (objects.some((o) => o.key === exact)) return exact;
  const parts = wanted.split('/'),
    category = parts.length > 1 ? parts[0] : '',
    fileName = parts[parts.length - 1];
  const inPrefix = (key: string) =>
    !normalizedPrefix || key === normalizedPrefix || key.startsWith(`${normalizedPrefix}/`);
  const candidates = objects
    .filter((o) => {
      if (!inPrefix(o.key) || o.key.split('/').at(-1) !== fileName) return false;
      if (!category) return true;
      const relative =
        normalizedPrefix && o.key.startsWith(`${normalizedPrefix}/`)
          ? o.key.slice(normalizedPrefix.length + 1)
          : o.key;
      return relative.split('/').slice(0, -1).includes(category);
    })
    .map((o) => o.key);
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1)
    throw new Error(
      `R2_MODEL_OBJECT_AMBIGUOUS: ${fileName} matched multiple objects: ${candidates.join(', ')}`,
    );
  return null;
}
