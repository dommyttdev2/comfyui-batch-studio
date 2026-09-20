# JSON persistence and recovery

Protected files: `project_meta.json`, `execution_runs/current.json`, and `execution_runs/<runId>.json`. Other drafts retain their prior best-effort `readJson() -> null` semantics.

## Atomic replacement

Writes prepare a unique temporary file in the destination directory. For protected JSON that already exists, the current primary file must first be readable and valid JSON; a validated copy is staged and atomically renamed to `<file>.bak`. The new primary is installed using a same-directory rename. Transient Windows `EPERM`, `EBUSY` and `EACCES` errors are retried. If replacement remains blocked, the write fails **without copying over or truncating the existing primary**. A full disk (`ENOSPC`) fails without a fallback. Temporary files are removed and the prior primary and last verified backup remain in place.

Writes to the same pathname are serialized within the main process, including the backup stage. The backup contains the **previous valid version** of the file, not necessarily the version currently saved. On the first write of a new protected file, no backup exists until its next successful update. Crash recovery therefore requires the previous version to have existed.

## Reading and recovery

Missing protected files return `null` only for a true `ENOENT` response. Malformed JSON throws `PERSISTED_JSON_CORRUPT` and other access/read errors throw `PERSISTED_JSON_UNREADABLE`. Critical state cannot be overwritten by treating corruption or unreadability as an empty project or Run. These errors include the primary and `.bak` locations.

For recovery, stop the application and copy both the primary and its backup to a safe location. Validate the backup as JSON and determine whether reverting to the **previous version** is acceptable (recent settings or Run progress may be lost). The `restoreJsonFromBackup(file)` helper validates the backup and atomically replaces the primary, failing without a partial overwrite if the file is still locked. If no valid backup exists, restore from a separately retained project backup instead; do not erase the corrupt primary or silently create a new Run. Resume only after checking project and Run metadata consistency.

This protects against partial destination writes; it does not make multi-file operations transactionally atomic. Project-wide multi-file crash consistency is handled separately.
