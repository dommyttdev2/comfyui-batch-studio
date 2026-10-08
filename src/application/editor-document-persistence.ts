import { editorSaveDecision, type RevisionedEditor } from '../domain/editor-save-policy.js';

export interface EditorPersistencePorts<T> {
  exclusive<R>(work: () => Promise<R>): Promise<R>;
  read(): Promise<T | null>;
  write(value: T): Promise<void>;
  assertCurrent(value: unknown): asserts value is T;
  normalize(value: unknown): T | Promise<T>;
  revision(last: number): number;
}

export async function saveEditorDocument<T extends RevisionedEditor>(
  ports: EditorPersistencePorts<T>,
  value: unknown,
) {
  const proposed = await ports.normalize(value);
  return ports.exclusive(async () => {
    const current = await ports.read();
    if (current !== null) ports.assertCurrent(current);
    const decision = editorSaveDecision(current, proposed, () =>
      ports.revision(current?.saveRevision ?? 0),
    );
    if (decision !== current) await ports.write(decision);
    return ports.normalize(decision);
  });
}
