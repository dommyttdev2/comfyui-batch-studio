import path from 'node:path';
import { loadConfig } from './config.js';
import { FileLease } from './ownership.js';
try {
  const config = await loadConfig({ dataDir: process.env.BATCH_STUDIO_DATA_DIR ?? '' });
  await FileLease.reconcileDeadServer(path.join(config.dataDir, 'server.lock'));
  console.log(
    'Dead server lock reconciled. Job and resource ownership still require reconciliation.',
  );
} catch {
  console.error('Server lock recovery rejected. Owner must be verified dead on this host.');
  process.exitCode = 1;
}
