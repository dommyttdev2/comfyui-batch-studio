export type PickerSelectionPhase =
  | 'idle'
  | 'preview-loading'
  | 'preview-ready'
  | 'committing'
  | 'committed';

type Pending = {
  path: string;
  resolve: () => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
};

export class PickerSelectionGate {
  constructor(private readonly timeoutMs = 30000) {}
  phase: PickerSelectionPhase = 'idle';
  private path = '';
  private preview: Pending | null = null;
  private commit: Pending | null = null;

  beginPreview(path: string): Promise<void> {
    if (this.phase === 'committing' || this.phase === 'committed')
      throw new Error('画像の確定処理中です。');
    if (this.preview) {
      if (this.preview.timer) clearTimeout(this.preview.timer);
      this.preview.reject(new Error('新しい画像が選択されました。'));
    }
    this.preview = null;
    this.path = path;
    this.phase = 'preview-loading';
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.previewResult(path, false, 'プレビューの応答がありません。再選択してください。'),
        this.timeoutMs,
      );
      this.preview = { path, resolve, reject, timer };
    });
  }

  previewResult(path: string, ok: boolean, message?: string): boolean {
    const pending = this.preview;
    if (!pending || pending.path !== path || this.phase !== 'preview-loading') return false;
    if (pending.timer) clearTimeout(pending.timer);
    this.preview = null;
    this.phase = ok ? 'preview-ready' : 'idle';
    if (ok) pending.resolve();
    else pending.reject(new Error(message || '画像のプレビューに失敗しました。'));
    return true;
  }

  beginCommit(path: string): Promise<void> {
    if (this.phase !== 'preview-ready' || this.path !== path)
      throw new Error('プレビューの描画完了後に同じ画像をもう一度選択してください。');
    this.phase = 'committing';
    return new Promise((resolve, reject) => {
      this.commit = { path, resolve, reject };
    });
  }

  commitResult(path: string, ok: boolean, message?: string): boolean {
    const pending = this.commit;
    if (!pending || pending.path !== path || this.phase !== 'committing') return false;
    if (pending.timer) clearTimeout(pending.timer);
    this.commit = null;
    this.phase = ok ? 'committed' : 'preview-ready';
    if (ok) pending.resolve();
    else pending.reject(new Error(message || '画像の確定に失敗しました。'));
    return true;
  }

  cancel() {
    if (this.preview?.timer) clearTimeout(this.preview.timer);
    if (this.commit?.timer) clearTimeout(this.commit.timer);
    this.preview?.reject(new Error('画像選択をキャンセルしました。'));
    this.commit?.reject(new Error('画像選択をキャンセルしました。'));
    this.preview = null;
    this.commit = null;
    this.phase = 'idle';
    this.path = '';
  }
}
