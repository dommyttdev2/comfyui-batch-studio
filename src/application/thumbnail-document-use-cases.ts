import type { ThumbnailEditorState } from '../domain/artifact-types.js';
import { BusinessError } from '../domain/contracts.js';
import { removeThumbnailDocument } from '../domain/thumbnail-editor-policy.js';

export interface ThumbnailDocumentPorts {
  exclusive<T>(projectId: string, work: () => Promise<T>): Promise<T>;
  load(projectId: string): Promise<ThumbnailEditorState>;
  write(projectId: string, state: ThumbnailEditorState): Promise<void>;
  deleteOutputs(projectId: string, id: number): Promise<void>;
}

export async function deleteThumbnailDocument(
  ports: ThumbnailDocumentPorts,
  projectId: string,
  command: { id: number; expectedRevision: number; deleteOutputs: boolean },
) {
  return ports.exclusive(projectId, async () => {
    const state = await ports.load(projectId);
    if (
      !Number.isSafeInteger(command.expectedRevision) ||
      command.expectedRevision < 0 ||
      (state.saveRevision ?? 0) !== command.expectedRevision
    )
      throw new BusinessError('REVISION_CONFLICT', 'Thumbnail editor changed before deletion.');
    const next = removeThumbnailDocument(state, command.id);
    next.saveRevision = command.expectedRevision + 1;
    if (!Number.isSafeInteger(next.saveRevision))
      throw new BusinessError('INVALID_INPUT', 'Editor revision exhausted.');
    await ports.write(projectId, next);
    let cleanupWarning: string | undefined;
    if (command.deleteOutputs) {
      try {
        await ports.deleteOutputs(projectId, command.id);
      } catch (error) {
        cleanupWarning = error instanceof Error ? error.message : String(error);
      }
    }
    // Saving fails before deletion; cleanup failures do not undo the saved document.
    // The explicit delete-output command is idempotent and can retry cleanup.
    return { state: next, cleanupWarning };
  });
}
