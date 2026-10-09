import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { loadConfig } from './config.js';
import {
  IntegrationSettings,
  providers,
  type IntegrationProvider,
} from './integration-settings.js';
import { FileLease } from './ownership.js';
try {
  const config = await loadConfig({ dataDir: process.env.BATCH_STUDIO_DATA_DIR ?? '' });
  const lock = await FileLease.acquire(
    path.join(config.dataDir, 'server.lock'),
    'server',
    randomUUID(),
  );
  try {
    const source = process.env.BATCH_STUDIO_SECRET_SOURCE;
    if (source !== 'environment' && source !== 'vault')
      throw new Error('Explicit Secret source required.');
    const selected = (process.env.BATCH_STUDIO_INTEGRATION_PROVIDERS ?? '').split(',');
    if (
      !selected.length ||
      selected.some((p) => !providers.includes(p as IntegrationProvider)) ||
      new Set(selected).size !== selected.length
    )
      throw new Error('Explicit providers required.');
    const input: Partial<
      Record<
        IntegrationProvider,
        { account?: string; publicUrl?: string; secrets?: Record<string, string> }
      >
    > = {};
    for (const provider of selected as IntegrationProvider[]) {
      const secrets: Record<string, string> =
        provider === 'r2'
          ? {
              accessKeyId: process.env.BATCH_STUDIO_SECRET_R2_ACCESS_KEY_ID!,
              secretAccessKey: process.env.BATCH_STUDIO_SECRET_R2_SECRET_ACCESS_KEY!,
            }
          : { apiKey: process.env['BATCH_STUDIO_SECRET_' + provider.toUpperCase() + '_API_KEY']! };
      input[provider] = {
        ...(provider === 'r2'
          ? {
              account: process.env.BATCH_STUDIO_R2_ACCOUNT,
              ...(process.env.BATCH_STUDIO_R2_PUBLIC_URL
                ? { publicUrl: process.env.BATCH_STUDIO_R2_PUBLIC_URL }
                : {}),
            }
          : {}),
        ...(source === 'vault' ? { secrets } : {}),
      };
    }
    const settings = new IntegrationSettings(config.dataDir);
    await settings.initialize();
    await settings.register(source, input);
    console.log('New Web integration settings registered.');
  } finally {
    await lock.release();
  }
} catch {
  console.error(
    'Integration registration failed. Stop server and verify explicit source, providers and credentials.',
  );
  process.exitCode = 1;
}
