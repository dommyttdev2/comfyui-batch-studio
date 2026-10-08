import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeAuth } from './server-fixtures.mjs';
import { loadConfig } from '../dist-server/server/config.js';
import { createServerRuntime } from '../dist-server/server/runtime.js';
test('independent Web bundle is served on the API origin with CSP and strict resource paths', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'web-static-'));
  await writeAuth(dir);
  const config = await loadConfig({ dataDir: dir, port: 0 });
  const runtime = await createServerRuntime(config);
  try {
    const res = await fetch(runtime.origin);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    const html = await res.text();
    const asset = html.match(/src="([^"]+\.js)"/)[1];
    const js = await fetch(runtime.origin + asset);
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type'), /javascript/);
    assert.equal((await fetch(runtime.origin + '/assets/forbidden.txt')).status, 404);
    const health = await (await fetch(runtime.origin + '/api/v1/health')).json();
    assert.match(health.webBuildId, /^[a-f0-9]{64}$/);
  } finally {
    await runtime.close();
    await rm(dir, { recursive: true, force: true });
  }
});
