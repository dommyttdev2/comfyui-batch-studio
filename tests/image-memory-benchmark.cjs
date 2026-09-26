// Run after npm run build:electron. Each case uses a fresh process for peak RSS.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');

async function sample(size) {
  const root = path.resolve(__dirname, '../dist-electron');
  const { resizeLanczosBitmap } = await import(
    pathToFileURL(path.join(root, 'main/image-pipeline-core.js')).href
  );
  const { assertRenderBudget } = await import(
    pathToFileURL(path.join(root, 'shared/image-size-limits.js')).href
  );
  assertRenderBudget(size, size, size, size, size + 1, size);
  const baselineRss = process.memoryUsage().rss;
  const start = performance.now();
  const source = Buffer.alloc(size * size * 4, 127);
  const output = resizeLanczosBitmap(source, size, size, size + 1, size);
  assert.equal(output.length, (size + 1) * size * 4);
  assert.equal(output[0], 127);
  const elapsedMs = performance.now() - start;
  // resourceUsage.maxRSS is KiB on Node-supported Linux/macOS platforms.
  const peakRss = process.resourceUsage().maxRSS * 1024;
  const estimatedBytes = size * size * 20 + size * size * 16 + (size + 1) * size * 24;
  console.log(JSON.stringify({ size, elapsedMs, baselineRss, peakRss, estimatedBytes }));
}

if (process.argv[2]) {
  sample(Number(process.argv[2])).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
  for (const size of [1024, 2048, 3072]) {
    const samples = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      const child = spawnSync(process.execPath, [__filename, String(size)], {
        encoding: 'utf8',
        timeout: 60000,
      });
      assert.equal(child.status, 0, child.stderr);
      samples.push(JSON.parse(child.stdout.trim()));
    }
    const durations = samples.map((item) => item.elapsedMs).sort((a, b) => a - b);
    console.log(
      JSON.stringify({
        scope: 'CPU Lanczos buffers only; excludes Electron decode, IPC and UI',
        size,
        p50Ms: durations[2],
        p95Ms: durations[4],
        peakRssBytes: Math.max(...samples.map((item) => item.peakRss)),
        peakIncrementBytes: Math.max(...samples.map((item) => item.peakRss - item.baselineRss)),
        estimatedBytes: samples[0].estimatedBytes,
      }),
    );
  }
}
