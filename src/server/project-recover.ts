import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';
import { loadConfig } from './config.js';
import { FileLease, ProjectRegistry } from './ownership.js';
import { validateProjectStore } from './project-repository.js';
import { identifier } from './http.js';
import { atomicJson } from './storage.js';
try {
  const config = await loadConfig({ dataDir: process.env.BATCH_STUDIO_DATA_DIR ?? '' });
  const id = identifier(process.env.BATCH_STUDIO_PROJECT_ID);
  const operation = process.env.BATCH_STUDIO_OPERATION_ID;
  const server = await FileLease.acquire(
    path.join(config.dataDir, 'server.lock'),
    'server',
    randomUUID(),
  );
  try {
    const registry = new ProjectRegistry(config.dataDir);
    const root = await registry.resolve(
      {
        userId: 'recovery',
        sessionId: 'operator',
        requestId: 'recover',
        projectIds: [id],
        permissions: ['read'],
      },
      id,
    );
    const file = path.join(root, 'web-project.json');
    const bytes = await readFile(file);
    if (bytes.length > 64 * 1024 * 1024) throw Error('Storage limit');
    const e = validateProjectStore(JSON.parse(bytes.toString()), id);
    if (e.project.runs.length) throw Error('Runtime reconciliation required');
    const directory = path.join(root, '.batch-studio-owner-v1');
    let present = true;
    try {
      await stat(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      present = false;
    }
    if (present)
      await FileLease.releaseVerified(directory, 'project:' + id, async (owner) => {
        if (owner.host !== hostname()) return false;
        try {
          process.kill(owner.pid, 0);
          return false;
        } catch (error) {
          return (error as NodeJS.ErrnoException).code === 'ESRCH';
        }
      });
    const lock = await FileLease.acquire(directory, 'project:' + id, randomUUID());
    try {
      if (operation) {
        const pending = e.operations.find(
          (o: { id: string; state: string }) => o.id === operation && o.state === 'reserved',
        );
        if (!pending) throw Error('Pending operation required');
        pending.state = 'done';
        pending.result = null;
        await atomicJson(file, e);
      }
    } finally {
      await lock.release();
    }
    console.log(
      'Project ownership reconciled; pending operations are never automatically replayed.',
    );
  } finally {
    await server.release();
  }
} catch {
  console.error(
    'Project recovery rejected. Stop server, verify dead owner/current Project and explicit operation.',
  );
  process.exitCode = 1;
}
