import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { DownloadItem, WebContents } from 'electron';
import type { AutoArtifactEvent, GrokTask } from '../shared/types.js';
import { expectedArtifact, importAutoArtifact } from './agent-artifact-import.js';
import { isSafeGrokArtifactLink, observeGrokArtifact } from './grok-artifact-adapter.js';

type Expectation = {
  root: string;
  stage: GrokTask['stage'];
  fileName: string;
  conversation: string | null;
  baseline: Set<string>;
  stable: Map<string, number>;
  attempted: Set<string>;
  processing: boolean;
};

const hash = (raw: string) => createHash('sha256').update(raw).digest('hex');

export class GrokAutoArtifactWatcher {
  private expected: Expectation | null = null;
  private readonly timer: NodeJS.Timeout;
  private disposed = false;
  private readonly handleDownload: (
    event: Electron.Event,
    item: DownloadItem,
    sourceContents: WebContents,
  ) => void;

  constructor(
    private readonly contents: WebContents,
    private readonly notify: (event: AutoArtifactEvent) => void,
  ) {
    this.timer = setInterval(() => {
      void this.sample();
    }, 1500);
    this.timer.unref();
    this.handleDownload = (_event, item, source) => {
      const expected = this.expected;
      if (
        !expected ||
        expected.processing ||
        source.id !== this.contents.id ||
        item.getFilename() !== expected.fileName ||
        !isSafeGrokArtifactLink(item.getURL(), expected.fileName)
      )
        return;
      expected.processing = true;
      const folder = path.join(expected.root, '._batch_studio', 'auto-downloads', randomUUID());
      mkdirSync(folder, { recursive: true });
      const target = path.join(folder, expected.fileName);
      item.setSavePath(target);
      this.emit(expected, 'detected', 'Grokの成果物をダウンロードしています。');
      item.once('done', (_event, state) => {
        void (async () => {
          try {
            if (state !== 'completed') throw new Error('ダウンロードが完了しませんでした。');
            if ((await stat(target)).size > 10_000_000)
              throw new Error('成果物が10MBを超えています。');
            const raw = await readFile(target, 'utf8');
            const result = await importAutoArtifact(
              expected.root,
              'grok',
              expected.stage,
              (expected.conversation ?? this.contents.getURL()) + '/download/' + hash(raw),
              raw,
              this.notify,
            );
            if (result.phase === 'imported' || result.phase === 'duplicate') {
              if (this.expected === expected) this.expected = null;
            }
          } catch (error) {
            this.emit(expected, 'failed', error instanceof Error ? error.message : String(error));
          } finally {
            expected.processing = false;
            await rm(folder, { recursive: true, force: true }).catch(() => {});
          }
        })();
      });
    };
    this.contents.session.on('will-download', this.handleDownload);
  }

  private emit(expected: Expectation, phase: AutoArtifactEvent['phase'], message?: string) {
    this.notify({
      provider: 'grok',
      root: expected.root,
      stage: expected.stage,
      fileName: expected.fileName,
      phase,
      sourceId: expected.conversation ?? 'conversation-pending',
      message,
    });
  }

  async arm(root: string, stage: GrokTask['stage']): Promise<AutoArtifactEvent | null> {
    const fileName = expectedArtifact(stage);
    if (!fileName || this.disposed) return null;
    const expected: Expectation = {
      root,
      stage,
      fileName,
      conversation: null,
      baseline: new Set(),
      stable: new Map(),
      attempted: new Set(),
      processing: false,
    };
    try {
      const previous = await observeGrokArtifact(this.contents, fileName);
      expected.conversation = previous.conversation;
      for (const item of previous.candidates)
        expected.baseline.add(hash(item.kind + '\0' + item.url + '\0' + item.text));
    } catch {
      // The page may still be navigating; scanning resumes on the next tick.
    }
    this.expected = expected;
    const waiting: AutoArtifactEvent = {
      provider: 'grok',
      root,
      stage,
      fileName,
      phase: 'waiting',
      sourceId: expected.conversation ?? 'conversation-pending',
      message: `${fileName} の生成を待っています。`,
    };
    this.notify(waiting);
    return waiting;
  }

  private async sample() {
    const expected = this.expected;
    if (this.disposed || !expected || expected.processing || this.contents.isDestroyed()) return;
    let observation;
    try {
      observation = await observeGrokArtifact(this.contents, expected.fileName);
    } catch {
      return;
    }
    if (this.expected !== expected || !observation.conversation) return;
    if (expected.conversation !== observation.conversation) {
      expected.conversation = observation.conversation;
      // Navigating to an existing conversation must not import old artifacts
      // merely because they were absent from the previously viewed page.
      expected.baseline = new Set(
        observation.candidates.map((candidate) =>
          hash(candidate.kind + '\0' + candidate.url + '\0' + candidate.text),
        ),
      );
      expected.stable.clear();
      expected.attempted.clear();
      return;
    }
    for (const candidate of observation.candidates) {
      if (this.expected !== expected || expected.processing) return;
      const fingerprint = hash(candidate.kind + '\0' + candidate.url + '\0' + candidate.text);
      if (expected.baseline.has(fingerprint) || expected.attempted.has(fingerprint)) continue;
      if (candidate.kind === 'link') {
        if (!isSafeGrokArtifactLink(candidate.url, expected.fileName)) continue;
        expected.attempted.add(fingerprint);
        // Click only a link whose exact href and filename were already verified.
        void this.contents
          .executeJavaScript(
            `(() => {
          const href = ${JSON.stringify(candidate.url)};
          const fileName = ${JSON.stringify(expected.fileName)};
          const anchor = [...document.querySelectorAll('a[href]')].find((item) =>
            item.href === href &&
            ((item.getAttribute('download') || item.getAttribute('aria-label') ||
              item.textContent || '').includes(fileName)));
          if (anchor) anchor.click();
        })()`,
            true,
          )
          .catch(() => {});
        continue;
      }
      const raw = candidate.text.trim();
      if (!raw || raw.length > 10_000_000) continue;
      if (expected.fileName.endsWith('.json')) {
        try {
          const parsed = JSON.parse(raw);
          if (
            !parsed ||
            typeof parsed !== 'object' ||
            Array.isArray(parsed) ||
            parsed.schemaVersion == null
          )
            continue;
        } catch {
          // Ignore a partial JSON stream; never import until JSON is complete.
          continue;
        }
      } else if (!raw.startsWith('#')) continue;
      const stable = (expected.stable.get(fingerprint) ?? 0) + 1;
      expected.stable.set(fingerprint, stable);
      if (stable < 3) continue;
      expected.attempted.add(fingerprint);
      expected.processing = true;
      try {
        const result = await importAutoArtifact(
          expected.root,
          'grok',
          expected.stage,
          expected.conversation + '/code/' + fingerprint,
          raw,
          this.notify,
        );
        if (
          (result.phase === 'imported' || result.phase === 'duplicate') &&
          this.expected === expected
        )
          this.expected = null;
      } finally {
        expected.processing = false;
      }
      return;
    }
  }

  dispose() {
    this.disposed = true;
    this.expected = null;
    clearInterval(this.timer);
    this.contents.session.removeListener('will-download', this.handleDownload);
  }
}
