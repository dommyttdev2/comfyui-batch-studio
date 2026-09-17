const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-rate-limit-tests-'));
const tscBin = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(
  process.execPath,
  [tscBin, '-p', path.join(repo, 'tsconfig.electron.json'), '--outDir', runtime],
  { cwd: repo, stdio: 'inherit' },
);

(async () => {
  process.env.CIVITAI_BASE_URL = 'https://civitai.test';
  process.env.CIVITAI_MATURE_BASE_URL = 'https://civitai.test';
  process.env.CIVITAI_REQUEST_INTERVAL_MS = '1';
  process.env.CIVITAI_COLLECTION_REQUEST_INTERVAL_MS = '20';
  process.env.CIVITAI_MIN_RETRY_MS = '1';
  process.env.CIVITAI_MAX_RETRIES = '2';
  const mod = await import(
    pathToFileURL(path.join(runtime, 'main', 'civitai-request-policy.js')).href
  );
  assert.equal(mod.parseRetryAfter('2', 1000), 2000);
  assert.equal(mod.parseRetryAfter('Thu, 01 Jan 1970 00:00:03 GMT', 1000), 2000);

  const original = globalThis.fetch;
  try {
    let calls = 0;
    const fakeFetch = async () => {
      calls++;
      if (calls === 1) return new Response('{}', { status: 429, headers: { 'Retry-After': '0' } });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    const policy = new mod.CivitaiRequestPolicy(fakeFetch);
    policy.install();
    const response = await globalThis.fetch('https://civitai.test/api/v1/models/1');
    assert.equal(response.status, 200, '429 must be absorbed and retried');
    assert.equal(calls, 2, 'the exact request must resume after one rate-limit response');
    let metrics = policy.status().metrics;
    assert.equal(metrics.requests, 2);
    assert.equal(metrics.retries, 1);
    assert.equal(metrics.responses429, 1);
    assert.equal(metrics.requestsByEndpoint['/api/v1/models/:id'], 2);
    assert.equal(metrics.currentIntervalMs, 1, '429 must not increase the normal request interval');
    assert.equal(metrics.collectionIntervalMs, 20, 'collection pacing must have its own interval');
    assert.equal(
      policy.status().waiting,
      false,
      'successful retry must clear temporary rate-limit waiting state',
    );

    policy.resetMetrics();
    metrics = policy.status().metrics;
    assert.equal(metrics.requests, 0);
    assert.equal(
      metrics.currentIntervalMs,
      1,
      'a new sync must start at the configured fixed request interval',
    );
    assert.equal(metrics.collectionIntervalMs, 20);

    calls = 0;
    const always429 = new mod.CivitaiRequestPolicy(async () => {
      calls++;
      return new Response('{}', { status: 429, headers: { 'Retry-After': '0' } });
    });
    always429.install();
    const limited = await globalThis.fetch('https://civitai.test/api/v1/models/2');
    assert.equal(limited.status, 429, '429 retries must be bounded');
    assert.equal(calls, 3, 'maxRetries=2 must produce at most three attempts');
    assert.equal(always429.status().metrics.retries, 2);
    assert.equal(always429.status().metrics.responses429, 3);
    assert.equal(
      always429.status().metrics.currentIntervalMs,
      1,
      'repeated 429 responses must not permanently throttle normal pacing',
    );

    calls = 0;
    const recover5xx = new mod.CivitaiRequestPolicy(async () => {
      calls++;
      return calls === 1
        ? new Response('{}', { status: 503 })
        : new Response('{}', { status: 200 });
    });
    recover5xx.install();
    const recovered = await globalThis.fetch('https://civitai.test/api/v1/models/3');
    assert.equal(recovered.status, 200, 'transient 5xx must be retried');
    assert.equal(calls, 2);
    assert.equal(recover5xx.status().metrics.responses5xx, 1);
    assert.equal(recover5xx.status().metrics.retries, 1);

    const collectionStarts = [];
    const collectionPacing = new mod.CivitaiRequestPolicy(async (input) => {
      collectionStarts.push({ url: String(input), at: Date.now() });
      return new Response('{}', { status: 200 });
    });
    collectionPacing.install();
    await Promise.all([
      globalThis.fetch('https://civitai.test/api/trpc/collection.getAllUser?input=1'),
      globalThis.fetch('https://civitai.test/api/trpc/collection.getAllCollectionItems?input=2'),
      globalThis.fetch('https://civitai.test/api/trpc/collection.getAllCollectionItems?input=3'),
    ]);
    assert.equal(collectionStarts.length, 3);
    for (let i = 1; i < collectionStarts.length; i++) {
      assert.ok(
        collectionStarts[i].at - collectionStarts[i - 1].at >= 15,
        'collection tRPC requests must be paced by the collection-specific interval',
      );
    }
    const collectionMetrics = collectionPacing.status().metrics;
    assert.equal(collectionMetrics.currentIntervalMs, 1);
    assert.equal(collectionMetrics.collectionIntervalMs, 20);
    assert.equal(collectionMetrics.requestsByEndpoint['/api/trpc/collection.getAllUser'], 1);
    assert.equal(
      collectionMetrics.requestsByEndpoint['/api/trpc/collection.getAllCollectionItems'],
      2,
    );

    calls = 0;
    const aborting = new mod.CivitaiRequestPolicy(async (_input, init) => {
      calls++;
      const signal = init?.signal;
      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    aborting.install();
    const controller = new AbortController();
    const pending = globalThis.fetch('https://civitai.test/api/v1/models/4', {
      signal: controller.signal,
    });
    controller.abort(new Error('caller abort'));
    await assert.rejects(
      () => pending,
      /caller abort/,
      'caller AbortSignal must propagate through the request policy',
    );
    assert.equal(calls, 1, 'caller cancellation must not be retried');
  } finally {
    globalThis.fetch = original;
  }
  console.log('Civitai rate-limit resume tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
