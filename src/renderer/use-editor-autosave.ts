import { useCallback, useEffect, useRef, useState } from 'react';
import type { MarketplaceImageEditorState, ThumbnailEditorState } from '../shared/types';

export type EditorSaveStatus = 'saved' | 'editing' | 'saving' | 'error';
type Editable = ThumbnailEditorState | MarketplaceImageEditorState;
type Submission<T extends Editable> = { root: string; state: T };

// A single monotonic clock also orders earlier debounced saves against a picker
// commit and new editor mounts in this window. Main enforces revisions across
// multiple windows and serializes physical writes per Project/Editor.
const revisions = new Map<string, number>();
function revisionFor(root: string, kind: 'thumbnail' | 'marketplace', prior: number) {
  const key = kind + '\0' + root;
  const revision = Math.max(Date.now() * 1000, (revisions.get(key) ?? 0) + 1, prior + 1);
  revisions.set(key, revision);
  return revision;
}
function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function useEditorAutosave<T extends Editable>(
  root: string,
  kind: 'thumbnail' | 'marketplace',
  state: T | null,
  ready: boolean,
  blocked: boolean,
  delayMs: number,
) {
  const [saveStatus, setSaveStatus] = useState<EditorSaveStatus>('saved');
  const [saveError, setSaveError] = useState('');
  const hydrated = useRef(false);
  const pending = useRef<Submission<T> | null>(null);
  const timer = useRef<number | null>(null);
  const lastSnapshot = useRef<T | null>(null);
  const issuedRevision = useRef(0);

  const dispatch = useCallback(
    async ({ root: target, state: payload }: Submission<T>): Promise<T> => {
      const revision = payload.saveRevision ?? 0;
      setSaveStatus('saving');
      setSaveError('');
      try {
        const result = (kind === 'thumbnail'
          ? await window.batchStudio.thumbnail.save(target, payload as ThumbnailEditorState)
          : await window.batchStudio.marketplace.save(
              target,
              payload as MarketplaceImageEditorState,
            )) as T;
        if (result.saveRevision !== revision)
          throw new Error('EDITOR_SAVE_STALE: より新しい編集状態が保存済みです。再読み込みしてから編集してください。');
        if (issuedRevision.current === revision) {
          setSaveStatus('saved');
          setSaveError('');
        }
        return result;
      } catch (error) {
        if (issuedRevision.current === revision) {
          setSaveStatus('error');
          setSaveError(messageOf(error));
        }
        throw error;
      }
    },
    [kind],
  );

  const flush = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const request = pending.current;
    pending.current = null;
    if (request) void dispatch(request).catch(() => undefined);
  }, [dispatch]);

  // This effect owns the debounce. Re-render cancels the old timer and keeps
  // only the newest edit. Unmount independently flushes that edit immediately.
  useEffect(() => {
    if (!ready || !state || blocked) return;
    if (!hydrated.current) {
      hydrated.current = true;
      return;
    }
    const revision = revisionFor(root, kind, state.saveRevision ?? 0);
    issuedRevision.current = revision;
    const next = { ...state, saveRevision: revision } as T;
    pending.current = { root, state: next };
    lastSnapshot.current = next;
    setSaveStatus('editing');
    setSaveError('');
    timer.current = window.setTimeout(flush, delayMs);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
  }, [blocked, delayMs, flush, kind, ready, root, state]);

  useEffect(() => {
    return () => flush();
  }, [flush, root]);

  useEffect(() => {
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, [flush]);

  const saveNow = useCallback(
    (value: T): Promise<T> => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
      pending.current = null;
      const revision = revisionFor(root, kind, value.saveRevision ?? 0);
      issuedRevision.current = revision;
      const next = { ...value, saveRevision: revision } as T;
      lastSnapshot.current = next;
      return dispatch({ root, state: next });
    },
    [dispatch, kind, root],
  );

  const retrySave = useCallback(() => {
    if (!lastSnapshot.current) return;
    void saveNow(lastSnapshot.current).catch(() => undefined);
  }, [saveNow]);

  return { saveStatus, saveError, saveNow, retrySave };
}
