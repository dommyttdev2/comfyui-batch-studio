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
const atomicWrites = new Map<string, Promise<void>>();

function retryableReplaceError(error: unknown) {
  return RETRYABLE_REPLACE_ERRORS.has(String((error as NodeJS.ErrnoException)?.code ?? ''));
}
function retryDelay(attempt: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.min(100 * (attempt + 1), 500)));
}
type AtomicWriteIo = {
  rename: typeof rename;
  copyFile: typeof copyFile;
  writeFile: typeof writeFile;
  readFile: typeof readFile;
  unlink: typeof unlink;
  mkdir: typeof mkdir;
  delay: typeof retryDelay;
};

const nativeIo: AtomicWriteIo = {
  rename,
  copyFile,
  writeFile,
  readFile,
  unlink,
  mkdir,
  delay: retryDelay,
};

async function removeTemp(p: string, io: AtomicWriteIo) {
  try {
    await io.unlink(p);
  } catch {}
}

function protectedJsonPath(file: string) {
  const basename = path.basename(file).toLowerCase();
  if (basename === 'project_meta.json') return true;
  return (
    path.basename(path.dirname(file)).toLowerCase() === 'execution_runs' &&
    (basename === 'current.json' ||
      /^[0-9a-f]{8}-[0-9a-f-]{27}\\.json$/i.test(basename))
  );
}

export class PersistedJsonError extends Error {
  constructor(
    public readonly code: 'PERSISTED_JSON_CORRUPT' | 'PERSISTED_JSON_UNREADABLE',
    public readonly file: string,
    detail: string,
  ) {
    super(
      detail +
        ' (' +
        file +
        '). The original file has not been replaced. A recovery backup may be available at ' +
        file +
        '.bak.',
    );
    this.name = 'PersistedJsonError';
  }
}

async function withAtomicFileLock<T>(file: string, action: () => Promise<T>): Promise<T> {
  const resolved = path.resolve(file);
  const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  const previous = atomicWrites.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  atomicWrites.set(key, tail);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (atomicWrites.get(key) === tail) atomicWrites.delete(key);
  }
}

async function replaceWithRetry(source: string, target: string, io: AtomicWriteIo) {
  for (let attempt = 0; ; attempt++) {
    try {
      await io.rename(source, target);
      return;
    } catch (error) {
      if (!retryableReplaceError(error) || attempt >= ATOMIC_RENAME_RETRIES) throw error;
      await io.delay(attempt);
    }
  }
}

async function readExistingProtectedJson(file: string, io: AtomicWriteIo) {
  try {
    const value = await io.readFile(file, 'utf8');
    try {
      JSON.parse(value);
    } catch {
      throw new PersistedJsonError('PERSISTED_JSON_CORRUPT', file, 'Persisted JSON is malformed');
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    if (error instanceof PersistedJsonError) throw error;
    throw new PersistedJsonError('PERSISTED_JSON_UNREADABLE', file, 'Cannot read persisted JSON');
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
  if (!protectedJsonPath(p)) {
    const value = await readText(p);
    if (value == null) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  const value = await readExistingProtectedJson(p, nativeIo);
  return value === null ? null : (JSON.parse(value) as T);
}

// File replacement must remain atomic. Never copy directly over the existing
// target when Windows denies a rename: a partial copy could destroy the last good JSON.
export async function writeTextAtomic(
  p: string,
  content: string,
  io: AtomicWriteIo = nativeIo,
) {
  return withAtomicFileLock(p, async () => {
    await io.mkdir(path.dirname(p), { recursive: true });
    const protectedJson = protectedJsonPath(p);
    if (protectedJson) {
      try {
        JSON.parse(content);
      } catch {
        throw new PersistedJsonError('PERSISTED_JSON_CORRUPT', p, 'Refusing to write invalid JSON');
      }
    }
    const tmp = path.join(
      path.dirname(p),
      '.' + path.basename(p) + '.' + process.pid + '.' + randomUUID() + '.tmp',
    );
    let backupTemp: string | null = null;
    try {
      await io.writeFile(tmp, content, 'utf8');
      if (protectedJson) {
        const old = await readExistingProtectedJson(p, io);
        if (old !== null) {
          // Persist a validated backup before attempting to replace the primary file.
          backupTemp = tmp + '.backup';
          await io.writeFile(backupTemp, old, 'utf8');
          if ((await io.readFile(backupTemp, 'utf8')) !== old)
            throw new Error('Backup verification failed; refusing to replace existing JSON.');
          await replaceWithRetry(backupTemp, p + '.bak', io);
          backupTemp = null;
        }
      }
      // If all retries fail, leave the existing primary and backup untouched.
      await replaceWithRetry(tmp, p, io);
    } finally {
      await removeTemp(tmp, io);
      if (backupTemp) await removeTemp(backupTemp, io);
    }
  });
}

/** Explicit recovery operation; never silently reset corrupt persisted state. */
export async function restoreJsonFromBackup(p: string, io: AtomicWriteIo = nativeIo) {
  if (!protectedJsonPath(p)) throw new Error('Only protected JSON supports backup restoration.');
  return withAtomicFileLock(p, async () => {
    const backupFile = p + '.bak';
    const content = await readExistingProtectedJson(backupFile, io);
    if (content === null)
      throw new PersistedJsonError('PERSISTED_JSON_UNREADABLE', p, 'No validated backup exists');
    const tmp = path.join(
      path.dirname(p),
      '.' + path.basename(p) + '.' + process.pid + '.' + randomUUID() + '.restore.tmp',
    );
    try {
      await io.writeFile(tmp, content, 'utf8');
      if ((await io.readFile(tmp, 'utf8')) !== content)
        throw new Error('Recovery file verification failed.');
      await replaceWithRetry(tmp, p, io);
    } finally {
      await removeTemp(tmp, io);
    }
  });
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
