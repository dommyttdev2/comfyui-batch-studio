import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from './config.js';
import { roots } from './project-registration.js';
import { FileLease } from './ownership.js';
import { atomicJson } from './storage.js';
try {
  const config = await loadConfig({ dataDir: process.env.BATCH_STUDIO_DATA_DIR ?? '' });
  const raw = process.env.BATCH_STUDIO_PROJECT_ROOT ?? '';
  if (!path.isAbsolute(raw) || raw.startsWith('\\\\'))
    throw new Error('Explicit local root required.');
  const root = await realpath(raw);
  const id = process.env.BATCH_STUDIO_ROOT_ID ?? randomUUID();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error('Invalid root ID.');
  const lock = await FileLease.acquire(
    path.join(config.dataDir, 'server.lock'),
    'server',
    randomUUID(),
  );
  try {
    const list = await roots(config.dataDir);
    if (list.some((r) => r.id === id || r.root === root)) throw new Error('Root exists.');
    list.push({ id, name: process.env.BATCH_STUDIO_ROOT_NAME ?? id, root });
    await atomicJson(path.join(config.dataDir, 'project-roots.json'), {
      schema: 'web-project-roots/1',
      roots: list,
    });
    console.log('Project root registered: ' + id);
  } finally {
    await lock.release();
  }
} catch {
  console.error('Project root registration failed. Stop server and verify explicit root.');
  process.exitCode = 1;
}
