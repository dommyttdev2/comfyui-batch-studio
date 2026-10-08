export interface RevisionedEditor {
  saveRevision?: number;
}

export function editorSaveDecision<T extends RevisionedEditor>(
  current: T | null,
  proposed: T,
  nextRevision: () => number,
): T {
  const last = current?.saveRevision ?? 0;
  if (proposed.saveRevision !== undefined && proposed.saveRevision < last) return current!;
  if (proposed.saveRevision === last && current) {
    if (JSON.stringify({ ...proposed, saveRevision: last }) !== JSON.stringify(current))
      throw new Error('EDITOR_SAVE_CONFLICT: State was modified by another editor.');
    return current;
  }
  const revision = proposed.saveRevision ?? nextRevision();
  if (!Number.isSafeInteger(revision) || revision <= last)
    throw new Error('Invalid editor revision.');
  return { ...proposed, saveRevision: revision };
}
