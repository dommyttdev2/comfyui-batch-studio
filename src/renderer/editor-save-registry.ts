type Flush = () => Promise<void>;
const editors = new Map<string, Set<Flush>>();

export function registerEditorFlush(root: string, flush: Flush) {
  const registered = editors.get(root) ?? new Set<Flush>();
  registered.add(flush);
  editors.set(root, registered);
  return () => {
    registered.delete(flush);
    if (registered.size === 0) editors.delete(root);
  };
}

export async function flushEditorSaves(root: string): Promise<void> {
  await Promise.all([...(editors.get(root) ?? [])].map((flush) => flush()));
}
