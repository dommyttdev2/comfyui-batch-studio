import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { loadConfig } from './config.js';
import { FileResources } from './file-resources.js';
import { FileLease } from './ownership.js';
try {
  const config = await loadConfig({ dataDir: process.env.BATCH_STUDIO_DATA_DIR ?? '' });
  const lock = await FileLease.acquire(
    path.join(config.dataDir, 'server.lock'),
    'server',
    randomUUID(),
  );
  try {
    const store = new FileResources(config.dataDir);
    await store.initialize();
    await store.register({
      id: process.env.BATCH_STUDIO_FILE_ID ?? '',
      root: process.env.BATCH_STUDIO_FILE_ROOT ?? '',
      file: process.env.BATCH_STUDIO_FILE_PATH ?? '',
      projectIds: (process.env.BATCH_STUDIO_FILE_PROJECTS ?? '').split(','),
    });
    console.log('New server file resource registered.');
  } finally {
    await lock.release();
  }
} catch {
  console.error(
    'File registration failed. Verify explicit file root, resource ID and Project grants while server is stopped.',
  );
  process.exitCode = 1;
}
