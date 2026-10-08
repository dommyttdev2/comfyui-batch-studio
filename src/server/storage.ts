import { randomUUID } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

export async function atomicJson(file: string, value: unknown): Promise<void> {
  const temp = path.join(path.dirname(file), '.' + randomUUID() + '.tmp');
  const handle = await open(temp, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(value) + '\n');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    // Windows readers can briefly deny replace. Retry the same fsynced atomic
    // rename only; never unlink the committed file or repeat external effects.
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(temp, file);
        break;
      } catch (error) {
        if (
          process.platform !== 'win32' ||
          !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '') ||
          attempt >= 5
        )
          throw error;
        await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
      }
    }
    if (process.platform !== 'win32') {
      const directory = await open(path.dirname(file), 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}
// Serializes read-modify-write transactions. Cross-process ownership is a separate lock.
export class SerialQueue {
  private pending: Promise<unknown> = Promise.resolve();
  run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.pending.then(work);
    this.pending = result.catch(() => {});
    return result;
  }
  async drain(): Promise<void> {
    await this.pending;
  }
}
