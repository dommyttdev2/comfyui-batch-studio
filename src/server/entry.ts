import { loadConfig } from './config.js';
import { startServer } from './server.js';
import { JobRegistry } from './jobs.js';
import { EventBroker, attachEvents } from './events.js';
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
  let jobs: JobRegistry;
  const broker = new EventBroker(config.dataDir, (actor) => jobs.list(actor));
  jobs = new JobRegistry(config.dataDir, new Map(), broker.append);
  let runtime;
  try {
    await broker.initialize();
    await jobs.initialize();
    runtime = await startServer(config, { ...security.http(), route: jobs.route });
  } catch (error) {
    await lease.release();
    throw error;
  }
  security.setOrigin(runtime.origin);
  const events = attachEvents(runtime.server, config, security, broker);
  console.log(`Batch Studio server listening at ${runtime.origin}`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      void events
        .close()
        .then(() => runtime.close())
        .then(() => jobs.drain())
        .then(() => broker.drain())
        .then(() => lease.release())
        .catch(() => {
          process.exitCode = 1;
        });
    });
} catch {
  console.error('Server startup failed. Check configuration, resources and ownership.');
  process.exitCode = 1;
}
