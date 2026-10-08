import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../dist-server/server/config.js';
import { Security } from '../dist-server/server/security.js';
import { startServer } from '../dist-server/server/server.js';

export const token = 'fixture-credential-abcdefghijklmnopqrstuvwxyz123456';
export async function writeAuth(dir, projects = ['A', 'B']) {
  await writeFile(
    path.join(dir, 'auth.json'),
    JSON.stringify({
      schema: 'web-auth/1',
      principals: [
        {
          userId: 'operator',
          tokenHash: createHash('sha256').update(token).digest('hex'),
          projectIds: projects,
          permissions: ['read', 'edit', 'execute', 'admin'],
        },
      ],
    }),
    { mode: 0o600 },
  );
}
export async function fixture(options = {}, clock = Date.now) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'batch-p2-'));
  await writeAuth(dir);
  const config = await loadConfig({ dataDir: dir, port: 0 });
  const security = new Security(dir, clock, 60_000);
  await security.initialize();
  const runtime = await startServer(config, { ...security.http(), ...options });
  security.setOrigin(runtime.origin);
  const baseHeaders = {
    'x-batch-api-version': '1',
    'x-batch-build-id': config.buildId,
    'x-request-id': 'fixture-request',
    'content-type': 'application/json',
    origin: runtime.origin,
  };
  const login = await fetch(runtime.origin + '/api/v1/session', {
    method: 'POST',
    headers: { ...baseHeaders, authorization: `Bearer ${token}` },
    body: '{}',
  });
  if (login.status !== 200) throw new Error('Fixture login failed: ' + (await login.text()));
  const body = await login.json();
  const headers = {
    ...baseHeaders,
    cookie: login.headers.get('set-cookie').split(';')[0],
    'x-csrf-token': body.csrfToken,
  };
  return {
    dir,
    config,
    security,
    runtime,
    headers,
    baseHeaders,
    close: async () => {
      await runtime.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
