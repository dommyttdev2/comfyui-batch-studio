const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-civitai-tests-'));
const tscBin = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(
  process.execPath,
  [tscBin, '-p', path.join(repo, 'tsconfig.electron.json'), '--outDir', runtime],
  { cwd: repo, stdio: 'inherit' },
);

(async () => {
  process.env.CIVIT_API_KEY = 'test-key';
  process.env.CIVITAI_BASE_URL = 'https://civitai.test';
  process.env.CIVITAI_MATURE_BASE_URL = 'https://civitai.test';
  process.env.CIVITAI_MODEL_CACHE_TTL_SECONDS = '3600';
  process.env.CIVITAI_VERSION_CACHE_TTL_SECONDS = '3600';
  process.env.CIVITAI_BASELINE_CACHE_TTL_SECONDS = '3600';
  process.env.CIVITAI_CHECKPOINT_EVIDENCE_CACHE_TTL_SECONDS = '3600';
  process.env.CIVITAI_THUMBNAIL_CACHE_TTL_SECONDS = '3600';
  const mod = await import(pathToFileURL(path.join(runtime, 'main', 'civitai-catalog.js')).href);
  const resource = (postId, weight, versionId = 42) => ({
    postId,
    meta: { civitaiResources: [{ type: 'lora', modelVersionId: versionId, weight }] },
  });
  const items = [
    resource(1, 0.6),
    resource(1, 0.8),
    resource(2, 0.7),
    resource(3, 0.9),
    resource(4, 0.5),
    resource(5, 0.7),
    resource(6, 99, 999),
  ];
  const baseline = mod.calculateStrengthBaseline(items, 42);
  assert.equal(baseline.value, 0.7, 'baseline must be median of per-post medians');
  assert.equal(baseline.provenance.basis, 'observed-usage-derived');
  assert.equal(baseline.provenance.method, 'median-of-post-medians:newest-200');
  assert.equal(baseline.provenance.sampleCount, 5);
  assert.equal(
    mod.calculateStrengthBaseline(items.slice(0, 5), 42),
    null,
    'fewer than five distinct posts must omit baseline',
  );

  assert.deepEqual(
    mod.calculateObservedCheckpointReferences([
      {
        id: 1001,
        meta: {
          civitaiResources: [
            { type: 'checkpoint', modelVersionId: 777 },
            { type: 'CHECKPOINT', modelVersionId: 777 },
          ],
        },
      },
      {
        id: 1002,
        meta: {
          civitaiResources: [
            { type: 'checkpoint', modelVersionId: 777 },
            { type: 'checkpoint', modelVersionId: 888 },
          ],
        },
      },
      {
        meta: { civitaiResources: [{ type: 'checkpoint', modelVersionId: 888 }] },
      },
    ]),
    [
      { modelVersionId: 777, imageCount: 2, evidenceImageIds: [1001, 1002] },
      { modelVersionId: 888, imageCount: 2, evidenceImageIds: [1002] },
    ],
    'checkpoint evidence must count each checkpoint once per image and retain image ids',
  );

  const before = {
    schemaVersion: 1,
    generation: 1,
    generatedAt: 'x',
    collections: [
      {
        id: 1,
        name: 'A',
        items: [
          { modelId: 1, versionId: 11 },
          { modelId: 2, versionId: 21 },
        ],
      },
    ],
  };
  const after = {
    schemaVersion: 1,
    generation: 2,
    generatedAt: 'y',
    collections: [
      {
        id: 1,
        name: 'A',
        items: [
          { modelId: 1, versionId: 12 },
          { modelId: 3, versionId: 31 },
        ],
      },
    ],
  };
  assert.deepEqual(
    mod.calculateMembershipChanges(before, after),
    { added: 1, updated: 1, removed: 1 },
    'membership diff must distinguish add/update/remove',
  );

  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-civitai-sync-'));
  let currentModels = [1, 2];
  let calls = [];
  const json = (value, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  const version = (id, name) => ({
    id,
    name,
    baseModel: 'Illustrious',
    trainedWords: [name.toLowerCase()],
    files: [{ id: id * 10, name: `${name}.safetensors`, primary: true }],
    images: [],
  });
  const modelPayloads = {
    1: {
      id: 1,
      name: 'One',
      type: 'LORA',
      modelVersions: [version(11, 'One v1'), version(12, 'One v2'), version(13, 'One v3')],
    },
    2: { id: 2, name: 'Two', type: 'Checkpoint', modelVersions: [version(21, 'Two v1')] },
  };
  const checkpointPayloads = {
    777: {
      id: 777,
      modelId: 77,
      name: 'illust V3',
      baseModel: 'Illustrious',
      model: { name: "Vixon's Milk Factory", type: 'Checkpoint' },
    },
    888: {
      id: 888,
      modelId: 88,
      name: 'Other v1',
      baseModel: 'Illustrious',
      model: { name: 'Other Checkpoint', type: 'Checkpoint' },
    },
  };
  const collectionItem = (id) => ({
    type: 'model',
    data: {
      id,
      name: id === 1 ? 'One' : 'Two',
      version: id === 1 ? version(11, 'One v1') : version(21, 'Two v1'),
    },
  });
  const usageImages = {
    11: [1, 2, 3, 4, 5].map((postId) => ({
      id: 1100 + postId,
      postId,
      meta: {
        civitaiResources: [
          { type: 'checkpoint', modelVersionId: 777 },
          { type: 'lora', modelVersionId: 11, weight: 0.7 },
        ],
      },
    })),
    12: [1, 2].map((postId) => ({
      id: 1200 + postId,
      postId: 100 + postId,
      meta: {
        civitaiResources: [
          { type: 'checkpoint', modelVersionId: 888 },
          { type: 'lora', modelVersionId: 12, weight: 0.8 },
        ],
      },
    })),
    13: [
      {
        id: 1301,
        postId: 201,
        meta: { civitaiResources: [{ type: 'lora', modelVersionId: 13, weight: 0.6 }] },
      },
    ],
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? String(input) : input.url,
    );
    calls.push(`${url.pathname}${url.search}`);
    if (url.pathname === '/api/trpc/collection.getAllUser')
      return json({
        result: {
          data: {
            json: [{ id: 100, name: 'Models', description: '', read: 'Private', type: 'Model' }],
          },
        },
      });
    if (url.pathname === '/api/trpc/collection.getAllCollectionItems')
      return json({
        result: {
          data: { json: { collectionItems: currentModels.map(collectionItem), nextCursor: null } },
        },
      });
    const modelMatch = url.pathname.match(/^\/api\/v1\/models\/(\d+)$/);
    if (modelMatch) return json(modelPayloads[Number(modelMatch[1])]);
    const versionMatch = url.pathname.match(/^\/api\/v1\/model-versions\/(\d+)$/);
    if (versionMatch) {
      const payload = checkpointPayloads[Number(versionMatch[1])];
      if (payload) return json(payload);
      return json({ error: 'not found' }, 404);
    }
    if (url.pathname === '/api/v1/images') {
      const versionId = Number(url.searchParams.get('modelVersionId'));
      if (usageImages[versionId]) return json({ items: usageImages[versionId] });
    }
    throw new Error(`Unexpected Civitai test request: ${url}`);
  };

  try {
    const first = new mod.CivitaiCatalogService(storage);
    await first.initialize();
    await first.startSync();
    await first.waitForSync();
    const firstStatus = first.status();
    const firstCatalog = first.catalog();
    assert.equal(firstStatus.state, 'ready');
    assert.equal(firstStatus.changes.added, 2);
    assert.equal(firstCatalog.collections[0].items.length, 2);
    assert.equal(fs.existsSync(first.cachePath), true, 'metadata cache must be persisted');
    const firstImageCalls = calls.filter((x) => x.startsWith('/api/v1/images?'));
    assert.equal(
      firstImageCalls.length,
      3,
      'checkpoint evidence must inspect every candidate LoRA version exactly once',
    );
    for (const versionId of [11, 12, 13])
      assert.ok(
        firstImageCalls.some((x) => x.includes(`modelVersionId=${versionId}`)),
        `LoRA version ${versionId} must be inspected`,
      );
    assert.equal(calls.filter((x) => x.startsWith('/api/v1/models/')).length, 2);
    assert.equal(
      calls.filter((x) => x.startsWith('/api/v1/model-versions/')).length,
      2,
      'observed checkpoint identities must be resolved once each',
    );

    const lora = firstCatalog.collections[0].items.find((x) => x.modelId === 1);
    assert.deepEqual(lora.observedCheckpoints, [
      {
        modelVersionId: 777,
        modelId: 77,
        modelName: "Vixon's Milk Factory",
        versionName: 'illust V3',
        baseModel: 'Illustrious',
        modelUrl: 'https://civitai.com/models/77?modelVersionId=777',
        imageCount: 5,
        evidenceImageIds: [1101, 1102, 1103, 1104, 1105],
      },
    ]);
    assert.deepEqual(
      lora.versions.find((x) => x.versionId === 11).observedCheckpoints,
      lora.observedCheckpoints,
      'top-level selected LoRA evidence must mirror the selected version',
    );
    assert.deepEqual(lora.versions.find((x) => x.versionId === 12).observedCheckpoints, [
      {
        modelVersionId: 888,
        modelId: 88,
        modelName: 'Other Checkpoint',
        versionName: 'Other v1',
        baseModel: 'Illustrious',
        modelUrl: 'https://civitai.com/models/88?modelVersionId=888',
        imageCount: 2,
        evidenceImageIds: [1201, 1202],
      },
    ]);
    assert.deepEqual(
      lora.versions.find((x) => x.versionId === 13).observedCheckpoints,
      [],
      'a version without checkpoint metadata must remain unknown instead of fabricating identity',
    );

    currentModels = [1];
    calls = [];
    const second = new mod.CivitaiCatalogService(storage);
    await second.initialize();
    await second.startSync();
    await second.waitForSync();
    const secondStatus = second.status();
    const secondCatalog = second.catalog();
    assert.equal(secondStatus.state, 'ready');
    assert.equal(secondStatus.changes.added, 0);
    assert.equal(secondStatus.changes.updated, 0);
    assert.equal(
      secondStatus.changes.removed,
      1,
      'removing a model from the Civitai collection must remove it from the catalog',
    );
    assert.deepEqual(
      secondCatalog.collections[0].items.map((x) => x.modelId),
      [1],
    );
    assert.equal(
      calls.filter((x) => x.startsWith('/api/trpc/collection.getAllUser')).length,
      1,
      'collection list must be fetched every sync',
    );
    assert.equal(
      calls.filter((x) => x.startsWith('/api/trpc/collection.getAllCollectionItems')).length,
      1,
      'collection membership must be fully fetched every sync',
    );
    assert.equal(
      calls.filter((x) => x.startsWith('/api/v1/models/')).length,
      0,
      'fresh model metadata must be reused from cache',
    );
    assert.equal(
      calls.filter((x) => x.startsWith('/api/v1/images?')).length,
      0,
      'fresh LoRA usage metadata must be reused from cache',
    );
    assert.equal(
      calls.filter((x) => x.startsWith('/api/v1/model-versions/')).length,
      0,
      'fresh checkpoint identity metadata must be reused from cache',
    );
    assert.ok(
      secondStatus.metrics.cacheHits >= 8,
      'model, LoRA usage, checkpoint identity and thumbnail cache hits should be observable',
    );
    assert.equal(secondStatus.metrics.membershipItems, 1);
    assert.equal(secondStatus.metrics.collectionPages, 1);

    await Promise.all(
      Array.from({ length: 25 }, (_, n) =>
        (n % 2 ? first : second).saveTemplate({
          name: 'concurrent-' + n,
          selection: [{ collectionId: 100, modelId: n + 1, versionId: n + 1 }],
        }),
      ),
    );
    const templates = await second.templates();
    assert.equal(templates.length, 25, 'concurrent multi-window saves must not lose updates');
    assert.equal(new Set(templates.map((item) => item.id)).size, 25);
    const victim = templates.find((item) => item.name === 'concurrent-0');
    await Promise.all([
      first.deleteTemplate(victim.id),
      second.saveTemplate({ name: 'saved-while-deleting', selection: [] }),
    ]);
    const finalTemplates = await first.templates();
    assert.equal(finalTemplates.length, 25);
    assert.equal(finalTemplates.some((item) => item.id === victim.id), false);
    assert.equal(finalTemplates.some((item) => item.name === 'saved-while-deleting'), true);
    assert.deepEqual(
      finalTemplates,
      JSON.parse(fs.readFileSync(first.templatesPath, 'utf8')),
      'template state must remain readable after overlapping writes',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('Integrated Civitai catalog tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
