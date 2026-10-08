import { loadConfig } from './config.js';
import { createServerRuntime } from './runtime.js';
try {
  const config = await loadConfig({
    dataDir: process.env.BATCH_STUDIO_DATA_DIR ?? '',
    resourceDir: process.env.BATCH_STUDIO_RESOURCE_DIR,
    host: process.env.BATCH_STUDIO_HOST,
    port: process.env.BATCH_STUDIO_PORT ? Number(process.env.BATCH_STUDIO_PORT) : undefined,
  });
  const runtime = await createServerRuntime(config);
  console.log(`Batch Studio server listening at ${runtime.origin}`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      void runtime.close().catch(() => {
        console.error('Server shutdown requires reconciliation.');
        process.exitCode = 1;
      });
    });
} catch {
  console.error('Server startup failed. Check configuration, resources and ownership.');
  process.exitCode = 1;
}
