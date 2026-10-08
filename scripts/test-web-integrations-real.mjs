// Explicit new Web settings only. This command performs read-only external acceptance;
// charged Vast actions and R2 writes require their separately confirmed targets.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmod, copyFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../dist-server/server/config.js';
import { createServerRuntime } from '../dist-server/server/runtime.js';
import { token } from '../tests/server-fixtures.mjs';
import { projectFixture } from '../tests/server-project-fixtures.mjs';

const source = process.env.WEB_INTEGRATIONS_SOURCE_DIR;
if (!source || !path.isAbsolute(source))
  throw Error('Explicit WEB_INTEGRATIONS_SOURCE_DIR required.');
const file = path.join(source, 'integrations.json');
const info = await lstat(file);
if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024)
  throw Error('Invalid explicit Web settings resource.');
const f = await projectFixture();
await f.repo.close();
let runtime,
  passed = false;
try {
  await copyFile(file, path.join(f.dir, 'integrations.json'));
  await chmod(path.join(f.dir, 'integrations.json'), 0o600);
  const config = await loadConfig({ dataDir: f.dir, port: 0 });
  runtime = await createServerRuntime(config);
  const base = {
    'content-type': 'application/json',
    'x-batch-api-version': '1',
    'x-batch-build-id': config.buildId,
    origin: runtime.origin,
    'x-request-id': randomUUID(),
  };
  const login = await fetch(runtime.origin + '/api/v1/session', {
    method: 'POST',
    headers: { ...base, authorization: 'Bearer ' + token },
    body: '{}',
  });
  assert.equal(login.status, 200);
  const session = await login.json();
  const headers = {
    ...base,
    cookie: login.headers.get('set-cookie').split(';')[0],
    'x-csrf-token': session.csrfToken,
  };
  const call = async (route, input) => {
    const r = await fetch(runtime.origin + '/api/v1' + route, {
      headers: { ...headers, 'x-request-id': randomUUID(), 'idempotency-key': randomUUID() },
      ...(input === undefined ? {} : { method: 'POST', body: JSON.stringify(input) }),
      signal: AbortSignal.timeout(60000),
    });
    const body = await r.json();
    if (!r.ok) throw Error(route.split('?')[0] + ': ' + (body.error?.code ?? 'REJECTED'));
    return body;
  };
  for (const provider of ['civitai', 'r2', 'vast'])
    assert.equal(
      (await call('/integrations/' + provider + '/status')).state,
      'ready',
      provider + ' unavailable',
    );
  const sync = await call('/integrations/civitai/sync', { projectId: f.id });
  let catalogJob;
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    catalogJob = (await call('/jobs/' + sync.job.id)).job;
    if (['succeeded', 'failed', 'cancelled', 'uncertain'].includes(catalogJob.state)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.equal(catalogJob?.state, 'succeeded', 'Actual catalog sync did not succeed');
  const catalog = await call('/integrations/civitai/catalog');
  assert.ok(catalog.catalog?.collections?.length > 0, 'Actual catalog has no collections');
  const search = await call('/integrations/civitai/search?query=');
  assert.ok(search.items.length > 0, 'Actual catalog has no selectable models');
  const item = search.items[0];
  await call('/integrations/civitai/models/' + item.modelId);
  await call('/integrations/civitai/versions/' + item.versionId);
  console.log('civitai: actual authenticated catalog sync/search/model/version PASS');
  const buckets = await call('/integrations/r2/buckets');
  const bucket = process.env.WEB_INTEGRATIONS_R2_BUCKET;
  if (!bucket)
    throw Error('Explicit WEB_INTEGRATIONS_R2_BUCKET required for R2 resource acceptance');
  assert.ok(
    buckets.buckets.some((b) => b.name === bucket),
    'Configured R2 bucket unavailable',
  );
  const page = await call('/integrations/r2/list?' + new URLSearchParams({ bucket, prefix: '' }));
  if (page.objects.length) {
    const object = page.objects[0];
    const metadata = await call(
      '/integrations/r2/metadata?' + new URLSearchParams({ bucket, key: object.key }),
    );
    assert.equal(metadata.metadata.size, object.size);
    assert.equal(metadata.metadata.etag, object.etag);
  }
  console.log('r2: actual authenticated bucket/list/fresh metadata PASS');
  const instances = await call('/integrations/vast/instances');
  assert.ok(Array.isArray(instances.instances));
  const template = await call('/integrations/vast/template');
  assert.ok(template.template.hashId);
  const offers = await call('/integrations/vast/search', {
    storageGb: 100,
    minTflops: 0,
    gpuCount: 1,
    minReliability: 0.98,
    excludedCountries: [],
  });
  assert.ok(Array.isArray(offers.offers));
  console.log(
    'vast: actual authenticated instances/template/offers PASS; no paid lifecycle operation performed',
  );
  passed = true;
  console.log(
    'Read-only service acceptance complete. Project model/resource and confirmed transfer/SSH acceptance remain separate gates.',
  );
} finally {
  if (runtime) await runtime.close('stop');
  if (passed) await f.close();
  else console.error('Acceptance stopped; durable records retained at ' + f.dir);
}
