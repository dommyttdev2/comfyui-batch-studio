import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../dist-server/server/config.js';
import { startServer } from '../dist-server/server/server.js';

test('bootstrap resolves resources outside cwd and exposes no paths or secrets', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'batch-server-'));
  const cwd = process.cwd();
  let runtime;
  try {
    process.chdir(dir);
    const config = await loadConfig({ dataDir: dir, port: 0 });
    runtime = await startServer(config);
    const response = await fetch(runtime.origin + '/api/v1/health');
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.apiVersion, '1');
    assert.match(body.buildId, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(body).includes(dir), false);
    assert.equal((await fetch(runtime.origin + '/api/v1/projects')).status, 409);
    await assert.rejects(loadConfig({ dataDir: dir, host: '0.0.0.0' }));
    await assert.rejects(loadConfig({ dataDir: 'relative' }));
    await assert.rejects(loadConfig({ dataDir: dir, port: -1 }));
    await assert.rejects(loadConfig({ dataDir: dir, resourceDir: dir }));
  } finally {
    process.chdir(cwd);
    await runtime?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
