import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { loadConfig } from './config.js';
import { IntegrationSettings } from './integration-settings.js';
import { FileLease } from './ownership.js';
import { SshResources } from './ssh-resources.js';

try {
  const config = await loadConfig({ dataDir: process.env.BATCH_STUDIO_DATA_DIR ?? '' });
  const lock = await FileLease.acquire(
    path.join(config.dataDir, 'server.lock'),
    'server',
    randomUUID(),
  );
  try {
    const settings = new IntegrationSettings(config.dataDir);
    await settings.initialize();
    const ssh = new SshResources(config.dataDir, settings);
    await ssh.initialize();
    await ssh.register({
      id: process.env.BATCH_STUDIO_SSH_ID ?? '',
      root: process.env.BATCH_STUDIO_SSH_ROOT ?? '',
      privateFile: process.env.BATCH_STUDIO_SSH_PRIVATE_FILE ?? '',
      publicFile: process.env.BATCH_STUDIO_SSH_PUBLIC_FILE ?? '',
      user: process.env.BATCH_STUDIO_SSH_USER ?? '',
      directory: process.env.BATCH_STUDIO_SSH_DIRECTORY ?? '',
    });
    console.log('New SSH key resource registered.');
  } finally {
    await lock.release();
  }
} catch {
  console.error(
    'SSH registration failed. Verify explicit new resource, matching keys and private file permissions while server is stopped.',
  );
  process.exitCode = 1;
}
