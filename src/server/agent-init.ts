import { randomUUID } from 'node:crypto';
import { access, unlink } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from './config.js';
import { FileLease } from './ownership.js';
import { atomicJson } from './storage.js';
import { loadAgentRegistration } from './agent-registration.js';
try {
  const config = await loadConfig({ dataDir: process.env.BATCH_STUDIO_DATA_DIR ?? '' });
  const file = path.join(config.dataDir, 'agent-runtime.json');
  const lock = await FileLease.acquire(
    path.join(config.dataDir, 'server.lock'),
    'server',
    randomUUID(),
  );
  try {
    let exists = false;
    try {
      await access(file);
      exists = true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    if (exists) throw new Error('Agent registration exists.');
    const providers: Record<string, unknown> = {};
    for (const provider of ['codex', 'grok']) {
      const credential = process.env['BATCH_STUDIO_' + provider.toUpperCase() + '_CREDENTIAL'];
      if (credential)
        providers[provider] = { credential, version: provider === 'codex' ? '0.155.1' : '1.0.46' };
    }
    if (!Object.keys(providers).length) throw new Error('Explicit provider credential required.');
    await atomicJson(file, {
      schema: 'web-agent-runtime/1',
      docker: process.env.BATCH_STUDIO_AGENT_DOCKER,
      image: process.env.BATCH_STUDIO_AGENT_IMAGE,
      directory: process.env.BATCH_STUDIO_AGENT_DIR,
      context: process.env.BATCH_STUDIO_AGENT_CONTEXT,
      providers,
    });
    try {
      await loadAgentRegistration(config.dataDir);
    } catch (e) {
      await unlink(file);
      throw e;
    }
    console.log('Isolated CLI runtime registered.');
  } finally {
    await lock.release();
  }
} catch {
  console.error(
    'CLI registration failed. Stop server and verify explicit image, directory, context and credential files.',
  );
  process.exitCode = 1;
}
