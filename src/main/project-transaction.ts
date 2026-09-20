import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, cp, lstat, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { exists, readJson, withTemplateStoreLock, writeJsonAtomic } from './fs-utils.js';

type EntryKind = 'file' | 'directory' | 'absent';
type SnapshotEntry = { relative: string; kind: EntryKind; oldSha256: string | null };
type TransactionJournal = {
  schemaVersion: 1;
  id: string;
  operation: string;
  status: 'applying' | 'committed';
  startedAt: string;
  entries: SnapshotEntry[];
  steps: string[];
  newHashes?: Record<string, string | null>;
};
type MutationContext = { root: string; journal?: TransactionJournal };
const transactionContext = new AsyncLocalStorage<MutationContext>();
const INTERNAL = '._batch_studio';
const JOURNAL_NAME = 'project-transaction.json';

export class SimulatedProjectCrashForTest extends Error {}
let testCheckpoint: ((step: string) => Promise<void> | void) | null = null;
export function setProjectTransactionCheckpointForTests(
  callback: ((step: string) => Promise<void> | void) | null,
) {
  testCheckpoint = callback;
}
function journalPath(root: string) {
  return path.join(root, INTERNAL, JOURNAL_NAME);
}
function snapshotDir(root: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('PROJECT_TRANSACTION_RECOVERY_REQUIRED: invalid transaction ID');
  return path.join(root, INTERNAL, 'project-transactions', id);
}
function insideProject(root: string, relative: string) {
  if (!relative || path.isAbsolute(relative)) throw new Error('PROJECT_TRANSACTION_RECOVERY_REQUIRED: invalid relative path');
  const absolute = path.resolve(root, relative),
    base = path.resolve(root);
  if (!absolute.startsWith(base + path.sep) || absolute === journalPath(root))
    throw new Error('PROJECT_TRANSACTION_RECOVERY_REQUIRED: transaction path escapes project');
  return absolute;
}
async function kindOf(file: string): Promise<EntryKind> {
  try {
    const st = await lstat(file);
    if (st.isSymbolicLink()) throw new Error('PROJECT_TRANSACTION_RECOVERY_REQUIRED: symlink in project transaction');
    if (st.isFile()) return 'file';
    if (st.isDirectory()) return 'directory';
    throw new Error('PROJECT_TRANSACTION_RECOVERY_REQUIRED: unsupported project artifact type');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'absent';
    throw error;
  }
}
async function fileHash(file: string) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes as Buffer);
  return hash.digest('hex');
}
function copyPath(root: string, id: string, relative: string) {
  return path.join(snapshotDir(root, id), 'backups', relative);
}
async function plannedPaths(root: string) {
  const paths = new Set([
    'project_meta.json',
    'story.md',
    'models.json',
    'prompt_plan.json',
    path.join(INTERNAL, 'drafts', 'story.md'),
    path.join(INTERNAL, 'drafts', 'models.json'),
    path.join(INTERNAL, 'drafts', 'prompt_plan.json'),
    path.join(INTERNAL, 'draft-sources', 'models.json'),
    path.join(INTERNAL, 'model_prompt_fallbacks.json'),
    ...[
      'story-finalize',
      'story-fix',
      'models',
      'models-fix',
      'prompt-plan',
      'prompt-plan-fix',
    ].map((name) => path.join(INTERNAL, 'grok-responses', name)),
  ]);
  for (const name of await readdir(root).catch(() => []))
    if (/^LoRA_.+\.json$/i.test(name)) paths.add(name);
  const meta = await readJson<any>(path.join(root, 'project_meta.json'));
  const build = meta?.workflowBuild;
  for (const candidate of [
    build?.outputPath,
    build?.apiOutputPath,
    build?.outputs?.ui?.path,
    build?.outputs?.api?.path,
  ]) {
    if (
      typeof candidate === 'string' &&
      path.basename(candidate) === candidate &&
      candidate.endsWith('.json') &&
      candidate !== 'project_meta.json'
    )
      paths.add(candidate);
  }
  return [...paths].sort();
}
async function takeBackup(root: string, id: string): Promise<SnapshotEntry[]> {
  const entries: SnapshotEntry[] = [];
  for (const relative of await plannedPaths(root)) {
    const source = insideProject(root, relative);
    const kind = await kindOf(source);
    const backup = copyPath(root, id, relative);
    let oldSha256: string | null = null;
    if (kind !== 'absent') {
      await mkdir(path.dirname(backup), { recursive: true });
      if (kind === 'directory') await cp(source, backup, { recursive: true, errorOnExist: true });
      else {
        await copyFile(source, backup);
        oldSha256 = await fileHash(backup);
        if (oldSha256 !== (await fileHash(source)))
          throw new Error('PROJECT_TRANSACTION_SOURCE_CHANGED: an artifact changed while preparing the backup');
      }
    }
    entries.push({ relative, kind, oldSha256 });
  }
  return entries;
}
async function validateBackup(root: string, journal: TransactionJournal) {
  for (const entry of journal.entries) {
    insideProject(root, entry.relative);
    const backup = copyPath(root, journal.id, entry.relative);
    if (entry.kind === 'absent') continue;
    if ((await kindOf(backup)) !== entry.kind)
      throw new Error('PROJECT_TRANSACTION_RECOVERY_REQUIRED: transaction backup is missing');
    if (entry.kind === 'file' && (await fileHash(backup)) !== entry.oldSha256)
      throw new Error('PROJECT_TRANSACTION_RECOVERY_REQUIRED: transaction backup hash changed');
  }
}
async function cleanup(root: string, journal: TransactionJournal) {
  // A committed journal must never be rolled back, even if cleanup is interrupted.
  await rm(journalPath(root), { force: true });
  await rm(snapshotDir(root, journal.id), { recursive: true, force: true });
}
async function restore(root: string, journal: TransactionJournal) {
  await validateBackup(root, journal);
  for (const entry of journal.entries) {
    const target = insideProject(root, entry.relative);
    const backup = copyPath(root, journal.id, entry.relative);
    if (entry.kind === 'absent') {
      await rm(target, { recursive: true, force: true });
      continue;
    }
    await mkdir(path.dirname(target), { recursive: true });
    await rm(target, { recursive: true, force: true });
    if (entry.kind === 'directory') await cp(backup, target, { recursive: true });
    else {
      await copyFile(backup, target);
      if ((await fileHash(target)) !== entry.oldSha256)
        throw new Error('PROJECT_TRANSACTION_RECOVERY_REQUIRED: restoring an old artifact failed hash verification');
    }
  }
  // Existing history and generated Local images are intentionally excluded.
  // Archives created by a failed attempt are retained, never purged.
  await cleanup(root, journal);
}
async function recoverUnlocked(root: string) {
  const file = journalPath(root);
  if (!(await exists(file))) return;
  const journal = await readJson<TransactionJournal>(file);
  if (
    !journal ||
    journal.schemaVersion !== 1 ||
    !Array.isArray(journal.entries) ||
    !['applying', 'committed'].includes(journal.status)
  )
    throw new Error('PROJECT_TRANSACTION_RECOVERY_REQUIRED: transaction journal is invalid; no new edits were applied');
  if (journal.status === 'committed') {
    await cleanup(root, journal);
    return;
  }
  try {
    await restore(root, journal);
  } catch (error) {
    throw new Error(
      'PROJECT_TRANSACTION_RECOVERY_REQUIRED: could not restore the previous consistent project generation: ' +
        (error instanceof Error ? error.message : String(error)),
    );
  }
}
export async function withProjectMutationLock<T>(root: string, action: () => Promise<T>) {
  const resolved = path.resolve(root);
  if (transactionContext.getStore()?.root === resolved) return action();
  return withTemplateStoreLock(path.join(resolved, INTERNAL, 'project-mutation.lock'), async () => {
    await recoverUnlocked(resolved);
    return transactionContext.run({ root: resolved }, action);
  });
}
export async function recoverPendingProjectTransaction(root: string) {
  return withProjectMutationLock(root, async () => {
    if (!transactionContext.getStore()?.journal) await recoverUnlocked(path.resolve(root));
  });
}
export async function projectTransactionCheckpoint(step: string) {
  const current = transactionContext.getStore();
  if (!current?.journal) return;
  current.journal.steps.push(step);
  await writeJsonAtomic(journalPath(current.root), current.journal);
  await testCheckpoint?.(step);
}
export async function withProjectTransaction<T>(
  root: string,
  operation: string,
  action: () => Promise<T>,
): Promise<T> {
  const resolved = path.resolve(root);
  if (transactionContext.getStore()?.root === resolved && transactionContext.getStore()?.journal)
    return action();
  return withProjectMutationLock(resolved, async () => {
    const id = randomUUID();
    const directory = snapshotDir(resolved, id);
    let journal: TransactionJournal | null = null;
    try {
      const entries = await takeBackup(resolved, id);
      journal = {
        schemaVersion: 1,
        id,
        operation,
        status: 'applying',
        startedAt: new Date().toISOString(),
        entries,
        steps: [],
      };
      await writeJsonAtomic(journalPath(resolved), journal);
      const value = await transactionContext.run({ root: resolved, journal }, action);
      const newHashes: Record<string, string | null> = {};
      for (const entry of entries) {
        const file = insideProject(resolved, entry.relative);
        newHashes[entry.relative] = (await kindOf(file)) === 'file' ? await fileHash(file) : null;
      }
      journal.newHashes = newHashes;
      journal.status = 'committed';
      await writeJsonAtomic(journalPath(resolved), journal);
      await cleanup(resolved, journal).catch(() => {});
      return value;
    } catch (error) {
      // Simulate power loss in regression tests: leave the durable journal for
      // the next project open, just as abrupt process termination would.
      if (error instanceof SimulatedProjectCrashForTest) throw error;
      if (journal) {
        try {
          await restore(resolved, journal);
        } catch (recoveryError) {
          throw new Error(
            'PROJECT_TRANSACTION_RECOVERY_REQUIRED: operation failed and rollback is pending: ' +
              (recoveryError instanceof Error ? recoveryError.message : String(recoveryError)),
          );
        }
      } else await rm(directory, { recursive: true, force: true });
      throw error;
    }
  });
}
