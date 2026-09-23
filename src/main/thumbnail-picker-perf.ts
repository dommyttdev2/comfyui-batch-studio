import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';

export type PickerMetrics = Record<string, number | string | boolean>;
const MAX_BYTES = 8 * 1024 * 1024;
let queue: Promise<void> = Promise.resolve();
let announced = false;

export function pickerPerformanceLogPath(userData: string): string {
  return path.join(userData, 'logs', 'thumbnail-picker-performance.jsonl');
}

export function logThumbnailPickerPerformance(
  userData: string,
  sessionId: string,
  event: string,
  metrics: PickerMetrics = {},
): void {
  // Log timings, counts, formats and hit/miss only; never record image paths or image content.
  const safeMetrics: PickerMetrics = {};
  for (const [key, value] of Object.entries(metrics)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) {
      safeMetrics[key] = Math.round(value * 100) / 100;
    } else if (typeof value === 'boolean') {
      safeMetrics[key] = value;
    } else if (typeof value === 'string' && value.length <= 64) {
      safeMetrics[key] = value;
    }
  }
  const destination = pickerPerformanceLogPath(userData);
  const line = `${JSON.stringify({
    at: new Date().toISOString(),
    sessionId,
    event,
    ...safeMetrics,
  })}\n`;
  queue = queue.then(async () => {
    await mkdir(path.dirname(destination), { recursive: true });
    if (!announced) {
      announced = true;
      console.info(`[ThumbnailPickerPerf] 計測ログ: ${destination}`);
    }
    const info = await stat(destination).catch(() => null);
    if (info && info.size > MAX_BYTES) {
      await rename(destination, `${destination}.old`).catch(() => undefined);
    }
    await appendFile(destination, line, 'utf8');
  }).catch((error: unknown) => {
    console.warn('[ThumbnailPickerPerf] Failed to write performance log:', error);
  });
}
