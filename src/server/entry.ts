import { loadConfig } from './config.js';
import { startServer } from './server.js';
import { Security } from './security.js';
import { FileLease, Ownership } from './ownership.js';
import path from 'node:path';

try {
  const config = await loadConfig({
    dataDir: process.env.BATCH_STUDIO_DATA_DIR ?? '',
    resourceDir: process.env.BATCH_STUDIO_RESOURCE_DIR,
    host: process.env.BATCH_STUDIO_HOST,
    port: process.env.BATCH_STUDIO_PORT ? Number(process.env.BATCH_STUDIO_PORT) : undefined,
  });
  const security = new Security(config.dataDir);
  await security.initialize();
  const ownership = new Ownership();
  const lease = await FileLease.acquire(
    path.join(config.dataDir, 'server.lock'),
    'server',
    ownership.serverId,
  );
  let runtime;
  try {
    runtime = await startServer(config, security.http());
  } catch (error) {
    await lease.release();
    throw error;
  }
  security.setOrigin(runtime.origin);
  console.log(`Batch Studio server listening at ${runtime.origin}`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      void runtime
        .close()
        .then(() => lease.release())
        .catch(() => {
          process.exitCode = 1;
        });
    });
} catch {
  console.error('Server startup failed. Check configuration, resources and ownership.');
  process.exitCode = 1;
}
