import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

export interface ThumbnailCachePruneMetrics {
  requests: number;
  runs: number;
  coalesced: number;
  filesScanned: number;
  bytesScanned: number;
  filesDeleted: number;
  bytesDeleted: number;
  deleteFailures: number;
  protectedSkips: number;
  lastDurationMs: number;
  lastBytesAfter: number;
  lastFilesAfter: number;
}

type RootState = {
  timer: NodeJS.Timeout | null;
  running: Promise<void> | null;
  retryAllowed: boolean;
  protect: (file: string) => boolean;
  metrics: ThumbnailCachePruneMetrics;
};

const emptyMetrics = (): ThumbnailCachePruneMetrics => ({
  requests: 0,
  runs: 0,
  coalesced: 0,
  filesScanned: 0,
  bytesScanned: 0,
  filesDeleted: 0,
  bytesDeleted: 0,
  deleteFailures: 0,
  protectedSkips: 0,
  lastDurationMs: 0,
  lastBytesAfter: 0,
  lastFilesAfter: 0,
});

export class ThumbnailCachePruner {
  private readonly states = new Map<string, RootState>();

  constructor(
    private readonly limitBytes: number,
    private readonly idleDelayMs = 250,
    private readonly retryDelayMs = 2_000,
    private readonly removeFile: (file: string) => Promise<void> = (file) =>
      rm(file, { force: true }),
  ) {}

  schedule(root: string, protect: (file: string) => boolean) {
    const state = this.state(root, protect);
    state.metrics.requests++;
    state.retryAllowed = true;
    state.protect = protect;
    if (state.timer || state.running) {
      state.metrics.coalesced++;
      return;
    }
    this.arm(root, state, this.idleDelayMs);
  }

  snapshot(root: string): ThumbnailCachePruneMetrics {
    const state = this.states.get(path.resolve(root));
    return { ...(state?.metrics ?? emptyMetrics()) };
  }

  async pruneNowForTests(root: string, protect: (file: string) => boolean = () => false) {
    const state = this.state(root, protect);
    state.metrics.requests++;
    state.protect = protect;
    await this.run(path.resolve(root), state);
    return this.snapshot(root);
  }

  async waitForIdleForTests(root: string) {
    const state = this.states.get(path.resolve(root));
    if (!state) return;
    while (state.timer || state.running) {
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
        await this.run(path.resolve(root), state);
      } else if (state.running) {
        await state.running;
      }
    }
  }

  private state(root: string, protect: (file: string) => boolean) {
    const key = path.resolve(root);
    let state = this.states.get(key);
    if (!state) {
      state = {
        timer: null,
        running: null,
        retryAllowed: true,
        protect,
        metrics: emptyMetrics(),
      };
      this.states.set(key, state);
    }
    return state;
  }

  private arm(root: string, state: RootState, delay: number) {
    state.timer = setTimeout(() => {
      state.timer = null;
      void this.run(path.resolve(root), state);
    }, delay);
    state.timer.unref?.();
  }

  private async run(root: string, state: RootState) {
    if (state.running) {
      state.metrics.coalesced++;
      return state.running;
    }
    const task = this.execute(root, state);
    state.running = task;
    try {
      await task;
    } finally {
      state.running = null;
    }
  }

  private async execute(root: string, state: RootState) {
    const started = performance.now();
    const files: Array<{ path: string; size: number; mtimeMs: number }> = [];
    for (const variant of ['editor', 'gallery']) {
      const directory = path.join(root, variant);
      const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const file = path.join(directory, entry.name);
        const info = await stat(file).catch(() => null);
        if (info?.isFile()) files.push({ path: file, size: info.size, mtimeMs: info.mtimeMs });
      }
    }

    state.metrics.runs++;
    state.metrics.filesScanned += files.length;
    state.metrics.bytesScanned += files.reduce((sum, file) => sum + file.size, 0);

    let total = files.reduce((sum, file) => sum + file.size, 0);
    let remaining = files.length;
    let failedOrProtected = false;
    for (const file of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
      if (total <= this.limitBytes) break;
      if (state.protect(file.path)) {
        state.metrics.protectedSkips++;
        failedOrProtected = true;
        continue;
      }
      try {
        await this.removeFile(file.path);
        total -= file.size;
        remaining--;
        state.metrics.filesDeleted++;
        state.metrics.bytesDeleted += file.size;
      } catch {
        state.metrics.deleteFailures++;
        failedOrProtected = true;
      }
    }

    state.metrics.lastDurationMs = performance.now() - started;
    state.metrics.lastBytesAfter = total;
    state.metrics.lastFilesAfter = remaining;

    if (total > this.limitBytes && failedOrProtected && state.retryAllowed && !state.timer) {
      state.retryAllowed = false;
      this.arm(root, state, this.retryDelayMs);
    }
  }
}
