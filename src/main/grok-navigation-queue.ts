import { canonicalGrokConversationUrl } from './grok-navigation.js';

export type GrokNavigationContents = {
  getURL(): string;
  loadURL(target: string): Promise<unknown>;
};

function navigationKey(target: string) {
  return canonicalGrokConversationUrl(target) ?? target;
}

export function isSameGrokNavigationTarget(current: string, target: string) {
  const targetConversation = canonicalGrokConversationUrl(target);
  if (targetConversation) return canonicalGrokConversationUrl(current) === targetConversation;
  return current === target;
}

export function isNavigationAbortedError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; errno?: unknown; message?: unknown };
  if (candidate.code === -3 || candidate.errno === -3) return true;
  return (
    typeof candidate.message === 'string' &&
    /(?:ERR_ABORTED|\(-3\)\s+loading)/i.test(candidate.message)
  );
}

export class GrokNavigationQueue {
  private tail: Promise<void> = Promise.resolve();
  private readonly pendingTargets = new Map<string, Promise<void>>();

  navigate(contents: GrokNavigationContents, target: string) {
    const key = navigationKey(target);
    const existing = this.pendingTargets.get(key);
    if (existing) return existing;

    const task = this.tail.then(async () => {
      if (isSameGrokNavigationTarget(contents.getURL(), target)) return;
      try {
        await contents.loadURL(target);
      } catch (error) {
        if (
          isNavigationAbortedError(error) &&
          isSameGrokNavigationTarget(contents.getURL(), target)
        )
          return;
        throw error;
      }
    });
    const settled = task.finally(() => {
      if (this.pendingTargets.get(key) === settled) this.pendingTargets.delete(key);
    });
    this.pendingTargets.set(key, settled);
    this.tail = settled.then(
      () => undefined,
      () => undefined,
    );
    return settled;
  }
}

export class LatestGrokContextQueue<T> {
  private generation = 0;
  private tail: Promise<void> = Promise.resolve();
  private readonly pending = new Map<string, Promise<T>>();

  run(key: string, task: (isLatest: () => boolean) => Promise<T>) {
    const existing = this.pending.get(key);
    if (existing) return existing;

    const generation = ++this.generation;
    const isLatest = () => generation === this.generation;
    const result = this.tail.then(() => task(isLatest));
    this.pending.set(key, result);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    void result.then(
      () => {
        if (this.pending.get(key) === result) this.pending.delete(key);
      },
      () => {
        if (this.pending.get(key) === result) this.pending.delete(key);
      },
    );
    return result;
  }
}
