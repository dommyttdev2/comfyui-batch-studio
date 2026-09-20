/**
 * Invalidates asynchronous preview/commit/restore work when a newer selection or
 * picker session takes precedence. Tokens are local to one mounted editor.
 */
export class MarketplacePickerGeneration {
  private sessionId: string | null = null;
  private generation = 0;

  invalidate() {
    this.sessionId = null;
    return ++this.generation;
  }

  begin(sessionId: string) {
    if (!sessionId) throw new Error('Picker session ID is required.');
    this.sessionId = sessionId;
    return ++this.generation;
  }

  preview(sessionId: string): number | null {
    if (this.sessionId !== sessionId) return null;
    return ++this.generation;
  }

  commit(sessionId: string): number | null {
    if (this.sessionId !== sessionId) return null;
    this.sessionId = null;
    return ++this.generation;
  }

  cancel(sessionId: string): number | null {
    if (this.sessionId !== sessionId) return null;
    this.sessionId = null;
    return ++this.generation;
  }

  isCurrent(token: number) {
    return this.generation === token;
  }

  isPreviewCurrent(sessionId: string, token: number) {
    return this.sessionId === sessionId && this.isCurrent(token);
  }
}
