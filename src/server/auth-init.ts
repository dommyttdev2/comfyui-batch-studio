import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from './config.js';
import { identifier } from './http.js';

// Credentials come from one explicit source; no automatic store/env fallback.
try {
  const token = process.env.BATCH_STUDIO_ADMIN_TOKEN ?? '';
  if (!/^[a-zA-Z0-9_-]{32,128}$/.test(token)) throw new Error('Invalid token.');
  const config = await loadConfig({ dataDir: process.env.BATCH_STUDIO_DATA_DIR ?? '' });
  const projectIds = (process.env.BATCH_STUDIO_PROJECT_IDS ?? '')
    .split(',')
    .filter(Boolean)
    .map(identifier);
  await writeFile(
    path.join(config.dataDir, 'auth.json'),
    JSON.stringify({
      schema: 'web-auth/1',
      principals: [
        {
          userId: 'operator',
          tokenHash: createHash('sha256').update(token).digest('hex'),
          projectIds,
          permissions: ['read', 'edit', 'execute', 'admin'],
        },
      ],
    }) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  console.log('Server authorization initialized.');
} catch {
  console.error(
    'Authorization initialization failed. Check explicit token, dataDir and existing auth file.',
  );
  process.exitCode = 1;
}
