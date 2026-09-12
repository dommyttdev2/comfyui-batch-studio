import { randomUUID } from 'node:crypto';
import {
  access,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
  copyFile,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';

const RETRYABLE_REPLACE_ERRORS = new Set(['EPERM', 'EBUSY', 'EACCES']);
const ATOMIC_RENAME_RETRIES = 4;
const WINDOWS_COPY_RETRIES = 20;

function retryableReplaceError(error: unknown) {
  return RETRYABLE_REPLACE_ERRORS.has(String((error as NodeJS.ErrnoException)?.code ?? ''));
}
function retryDelay(attempt: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.min(100 * (attempt + 1), 500)));
}
async function removeTemp(p: string) {
  try {
    await unlink(p);
  } catch {}
}
async function copyOverWithRetry(source: string, target: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      await copyFile(source, target);
      return;
    } catch (error) {
      if (!retryableReplaceError(error) || attempt >= WINDOWS_COPY_RETRIES) throw error;
      await retryDelay(attempt);
    }
  }
}

export async function exists(p: string) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}
export async function readText(p: string) {
  try {
    return await readFile(p, 'utf8');
  } catch {
    return null;
  }
}
export async function readJson<T>(p: string): Promise<T | null> {
  const t = await readText(p);
  if (t == null) return null;
  try {
    return JSON.parse(t) as T;
  } catch {
    return null;
  }
}
export async function writeTextAtomic(p: string, content: string) {
  await mkdir(path.dirname(p), { recursive: true });
  const tmp = path.join(path.dirname(p), `.${path.basename(p)}.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(tmp, content, 'utf8');
  let moved = false;
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(tmp, p);
        moved = true;
        return;
      } catch (error) {
        if (!retryableReplaceError(error)) throw error;
        if (attempt < ATOMIC_RENAME_RETRIES) {
          await retryDelay(attempt);
          continue;
        }
        if (process.platform !== 'win32') throw error;
        await copyOverWithRetry(tmp, p);
        return;
      }
    }
  } finally {
    if (!moved) await removeTemp(tmp);
  }
}
export async function writeJsonAtomic(p: string, v: unknown) {
  await writeTextAtomic(p, JSON.stringify(v, null, 2) + '\n');
}
export async function backupIfExists(source: string, historyDir: string) {
  if (!(await exists(source))) return null;
  await mkdir(historyDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dst = path.join(historyDir, `${stamp}-${path.basename(source)}`);
  await copyFile(source, dst);
  return dst;
}
export async function fileSize(p: string) {
  try {
    return (await stat(p)).size;
  } catch {
    return null;
  }
}

export async function removeIfExists(p: string) {
  try {
    await unlink(p);
  } catch (e: any) {
    if (e?.code !== 'ENOENT') throw e;
  }
}
