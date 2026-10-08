import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { ExternalOperations } from '../dist-server/server/external-operations.js';
import { FileResources } from '../dist-server/server/file-resources.js';
import { IntegrationSettings } from '../dist-server/server/integration-settings.js';
import { JobRegistry } from '../dist-server/server/jobs.js';
import { R2ObjectTransfers } from '../dist-server/server/r2-object-transfers.js';
import { R2Transfers } from '../dist-server/server/r2-transfers.js';
import { Staging } from '../dist-server/server/staging.js';
import { sourceFingerprint, verifiedSourcePart } from '../dist-server/server/transfer-source.js';

const actor = {
  userId: 'operator',
  sessionId: 'session',
  requestId: 'request',
  projectIds: ['A'],
  permissions: ['read', 'edit', 'execute', 'admin'],
};
const binding = { projectId: 'A', expectedRevision: 1, leaseId: 'lease' };
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const md5 = (bytes) => '"' + createHash('md5').update(bytes).digest('hex') + '"';
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
async function setup(options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'web-transfer-'));
  const dir = path.join(root, 'data');
  await mkdir(dir);
  const model = path.join(root, 'model.bin');
  const bytes = Buffer.alloc(options.size ?? 17 * 1024 * 1024, 17);
  await writeFile(model, bytes);
  const settings = new IntegrationSettings(dir, {
    BATCH_STUDIO_SECRET_R2_ACCESS_KEY_ID: 'fixture-id',
    BATCH_STUDIO_SECRET_R2_SECRET_ACCESS_KEY: 'fixture-secret',
  });
  await settings.initialize();
  await settings.register('environment', { r2: { account: 'a'.repeat(32) } });
  const files = new FileResources(dir);
  await files.initialize();
  await files.register({ id: 'model', root, file: model, projectIds: ['A'] });
  const staging = new Staging(dir);
  await staging.initialize();
  const definitions = new Map(),
    external = new Map();
  const jobs = new JobRegistry(dir, definitions, async () => {});
  await jobs.initialize();
  let lease = true;
  const ops = new ExternalOperations(dir, external, async (_actor, b) => {
    if (!lease || b.leaseId !== 'lease' || b.expectedRevision !== 1)
      throw Object.assign(Error(), { code: 'LEASE_REQUIRED' });
  });
  await ops.initialize();
  const objects = new Map(),
    uploads = new Map(),
    calls = [];
  let lost = false;
  const entered = deferred(),
    hold = deferred();
  let invalidations = 0;
  const port = {
    signed: async () => {
      throw Error('unused');
    },
    send: async (name, input) => {
      calls.push({ name, key: input.Key, part: input.PartNumber });
      if (!['HeadObject', 'ListParts', 'GetObject'].includes(name)) {
        const receipts = JSON.parse(
          await readFile(path.join(dir, 'external-operations.json'), 'utf8'),
        ).receipts;
        assert.equal(receipts.at(-1).state, 'running');
        const reservations = JSON.parse(await readFile(path.join(dir, 'jobs.json'), 'utf8'));
        assert.ok(['running', 'cancelling'].includes(reservations.jobs.at(-1).state));
        if (options.objectMode) {
          const r = JSON.parse(
            await readFile(path.join(dir, 'r2-object-transfers.json'), 'utf8'),
          ).records.at(-1);
          assert.equal(r.intent, name);
        } else {
          const transfer = JSON.parse(
            await readFile(path.join(dir, 'r2-transfers.json'), 'utf8'),
          ).records.at(-1);
          assert.ok(transfer.intents.some((i) => i.operation === name && i.state === 'pending'));
        }
      }
      if (name === 'HeadObject') {
        const o = objects.get(input.Key);
        if (!o) throw { $metadata: { httpStatusCode: 404 } };
        return { ContentLength: o.bytes.length, ETag: o.etag, Metadata: o.metadata };
      }
      if (name === 'GetObject') {
        const o = objects.get(input.Key);
        if (!o) throw { $metadata: { httpStatusCode: 404 } };
        if (input.IfMatch !== o.etag) throw { $metadata: { httpStatusCode: 412 } };
        const [start, end] = input.Range.slice(6).split('-').map(Number);
        const b = o.bytes.subarray(start, end + 1);
        if (options.changeSource) {
          o.etag = 'changed';
        }
        return {
          Body: Readable.from([b]),
          ContentLength: b.length,
          ETag: input.IfMatch,
          ContentRange: `bytes ${start}-${end}/${o.bytes.length}`,
        };
      }
      if (name === 'PutObject') {
        if (objects.has(input.Key) && input.IfNoneMatch === '*')
          throw { $metadata: { httpStatusCode: 412 } };
        const o = {
          bytes: Buffer.from(input.Body),
          etag: md5(input.Body),
          metadata: input.Metadata,
        };
        objects.set(input.Key, o);
        return { ETag: o.etag };
      }
      if (name === 'CreateMultipartUpload') {
        const id = randomUUID();
        uploads.set(id, { key: input.Key, metadata: input.Metadata, parts: new Map() });
        return { UploadId: id };
      }
      if (name === 'UploadPart') {
        const u = uploads.get(input.UploadId);
        const b = Buffer.from(input.Body);
        u.parts.set(input.PartNumber, b);
        if (input.Key === 'model.bin' && options.hold) {
          entered.resolve();
          await hold.promise;
        }
        if (input.Key === 'model.bin' && options.losePart && !lost) {
          lost = true;
          throw Error('lost accepted part response');
        }
        return { ETag: md5(b) };
      }
      if (name === 'ListParts') {
        const u = uploads.get(input.UploadId);
        return {
          Parts: [...u.parts].map(([PartNumber, b]) => ({
            PartNumber,
            ETag: md5(b),
            Size: b.length,
          })),
          IsTruncated: false,
        };
      }
      if (name === 'CompleteMultipartUpload') {
        if (objects.has(input.Key) && input.IfNoneMatch === '*' && !options.ignoreConditional)
          throw { $metadata: { httpStatusCode: 412 } };
        const u = uploads.get(input.UploadId);
        const b = Buffer.concat(input.MultipartUpload.Parts.map((p) => u.parts.get(p.PartNumber)));
        objects.set(input.Key, { bytes: b, etag: md5(b), metadata: u.metadata });
        uploads.delete(input.UploadId);
        if (input.Key === 'model.bin' && options.loseComplete && !lost) {
          lost = true;
          throw Error('lost completion response');
        }
        return { ETag: md5(b) };
      }
      if (name === 'AbortMultipartUpload') {
        uploads.delete(input.UploadId);
        return {};
      }
      if (name === 'DeleteObject') {
        const o = objects.get(input.Key);
        if (o && input.IfMatch !== o.etag) throw { $metadata: { httpStatusCode: 412 } };
        objects.delete(input.Key);
        return {};
      }
      throw Error('unexpected ' + name);
    },
  };
  const transfers = new R2Transfers(
    dir,
    settings,
    jobs,
    ops,
    staging,
    files,
    port,
    async () => {
      invalidations++;
    },
    async () => actor,
  );
  await transfers.initialize();
  definitions.set('r2-transfer', transfers.definition);
  external.set('upload-object', transfers.externalDefinition);
  const start = async () => {
    const target = await transfers.createTarget(actor, {
      projectId: 'A',
      sourceKind: 'server-file',
      sourceId: 'model',
      bucket: 'bucket',
      prefix: '',
    });
    const p = await ops.prepare(actor, 'upload-object', target.targetId, binding);
    const receipt = await ops.confirm(actor, 'upload-object', target.targetId, p.confirmationId);
    return { target, receipt };
  };
  const record = async () =>
    JSON.parse(await readFile(path.join(dir, 'r2-transfers.json'), 'utf8')).records.at(-1);
  const action = async (id, action, input = {}) => {
    let result;
    await transfers.route({
      actor,
      input,
      url: new URL('http://test/api/v1/integrations/r2/transfers/' + id + '/' + action),
      request: { method: 'POST' },
      response: {
        writeHead() {},
        end(raw) {
          result = JSON.parse(raw);
        },
      },
    });
    return result;
  };
  return {
    root,
    dir,
    model,
    bytes,
    settings,
    port,
    external,
    transfers,
    ops,
    jobs,
    objects,
    uploads,
    calls,
    start,
    record,
    action,
    entered,
    hold,
    get invalidations() {
      return invalidations;
    },
    setLease: (value) => (lease = value),
    close: async () => {
      hold.resolve();
      await jobs.drain();
      await ops.drain();
      await rm(root, { recursive: true, force: true });
    },
  };
}
test('confirmed multipart reserves receipt/job/intent before IO and verifies full source; bounded parts complete without exposing paths', async () => {
  const f = await setup();
  try {
    const { receipt } = await f.start();
    await f.ops.drain();
    assert.equal(f.ops.read(actor, receipt.id).state, 'succeeded');
    assert.deepEqual(f.objects.get('model.bin').bytes, f.bytes);
    assert.equal((await f.record()).phase, 'complete');
    assert.equal((await f.record()).core.filePath, 'model');
    assert.ok(f.invalidations >= 2);
    assert.equal(f.calls.filter((c) => c.name === 'UploadPart' && c.key === 'model.bin').length, 2);
  } finally {
    await f.close();
  }
});
test('conditional completion unsupported stops before destination writes and keeps source unchanged', async () => {
  const f = await setup({ ignoreConditional: true });
  try {
    const { receipt } = await f.start();
    await f.ops.drain();
    assert.equal(f.ops.read(actor, receipt.id).state, 'failed');
    assert.equal(f.objects.has('model.bin'), false);
    assert.deepEqual(await readFile(f.model), f.bytes);
    assert.equal(
      f.calls.some((c) => c.key === 'model.bin' && c.name === 'CreateMultipartUpload'),
      false,
    );
  } finally {
    await f.close();
  }
});
test('accepted part with lost response stays uncertain; read-only proof plus explicit lease-bound resume reuses verified parts', async () => {
  const f = await setup({ losePart: true });
  try {
    const { receipt } = await f.start();
    await f.ops.drain();
    assert.equal(f.ops.read(actor, receipt.id).state, 'uncertain');
    const r = await f.record();
    assert.equal(r.phase, 'uncertain');
    const before = f.calls.filter((c) => c.key === 'model.bin' && c.name === 'UploadPart').length;
    f.setLease(false);
    await assert.rejects(f.action(r.id, 'resume', { binding }), { code: 'LEASE_REQUIRED' });
    assert.equal(
      f.calls.filter((c) => c.key === 'model.bin' && c.name === 'UploadPart').length,
      before,
    );
    f.setLease(true);
    await f.action(r.id, 'resume', { binding });
    await f.ops.drain();
    assert.equal(f.ops.read(actor, receipt.id).state, 'succeeded');
    assert.equal(
      f.calls.filter((c) => c.key === 'model.bin' && c.name === 'UploadPart').length,
      before,
    );
    assert.deepEqual(f.objects.get('model.bin').bytes, f.bytes);
  } finally {
    await f.close();
  }
});
test('lost completion response is reconciled from receipt-owned object; it never completes twice', async () => {
  const f = await setup({ loseComplete: true });
  try {
    const { receipt } = await f.start();
    await f.ops.drain();
    assert.equal(f.ops.read(actor, receipt.id).state, 'uncertain');
    const reconciled = await f.ops.reconcile(actor, receipt.id);
    assert.equal(reconciled.state, 'succeeded');
    assert.equal(
      f.calls.filter((c) => c.key === 'model.bin' && c.name === 'CompleteMultipartUpload').length,
      1,
    );
  } finally {
    await f.close();
  }
});
test('cancel waits for in-flight parts and aborts only its upload; source remains', async () => {
  const f = await setup({ hold: true });
  try {
    const { receipt } = await f.start();
    await f.entered.promise;
    const r = await f.record();
    await f.jobs.cancel(actor, r.jobId);
    assert.equal(
      f.calls.some((c) => c.key === 'model.bin' && c.name === 'AbortMultipartUpload'),
      false,
    );
    f.hold.resolve();
    await f.ops.drain();
    assert.equal((await f.record()).phase, 'cancelled');
    assert.equal(f.objects.has('model.bin'), false);
    assert.equal(f.uploads.size, 0);
    assert.deepEqual(await readFile(f.model), f.bytes);
    assert.equal(f.ops.read(actor, receipt.id).state, 'failed');
  } finally {
    await f.close();
  }
});
test('source change is rejected before part reuse and aborted hash checks honor cancellation', async () => {
  const f = await setup({ size: 1024 });
  try {
    const fp = await sourceFingerprint(f.model, hash(f.bytes), 512);
    await writeFile(f.model, Buffer.alloc(1024, 18));
    await assert.rejects(verifiedSourcePart(f.model, 0, 512, fp, 1));
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(sourceFingerprint(f.model, hash(f.bytes), 512, controller.signal));
  } finally {
    await f.close();
  }
});
test('upload confirmation requires exact Project binding and rejects global or other Project', async () => {
  const f = await setup({ size: 0 });
  try {
    const t = await f.transfers.createTarget(actor, {
      projectId: 'A',
      sourceKind: 'server-file',
      sourceId: 'model',
      bucket: 'bucket',
      prefix: '',
    });
    await assert.rejects(f.ops.prepare(actor, 'upload-object', t.targetId), {
      code: 'PROJECT_BINDING_REQUIRED',
    });
    assert.equal(f.calls.length, 0);
  } finally {
    await f.close();
  }
});

async function copySetup(options = {}) {
  const f = await setup({ ...options, objectMode: true });
  const copies = new R2ObjectTransfers(f.dir, f.settings, f.jobs, f.port, async () => actor);
  await copies.initialize();
  f.jobs.definitions?.set?.('r2-object-copy', copies.definition);
  const t = {
    projectId: 'A',
    bucket: 'bucket',
    source: 'origin.bin',
    destination: 'model.bin',
    size: f.bytes.length,
    etag: 'origin',
    move: !!options.move,
    fingerprint: f.settings.resolve('r2').fingerprint,
  };
  f.objects.set('origin.bin', { bytes: f.bytes, etag: t.etag, metadata: {} });
  f.external.set('copy-object', {
    scope: () => 'r2-copy',
    inspect: async () => ({ revision: 1, fingerprint: hash(JSON.stringify(t)), summary: t }),
    execute: (a, id, receipt) => copies.execute(a, t, receipt),
    reconcile: async (a, receipt) => {
      await copies.reconcile(a, receipt);
      const r = JSON.parse(
        await readFile(path.join(f.dir, 'r2-object-transfers.json'), 'utf8'),
      ).records.at(-1);
      return { state: r.state === 'complete' ? 'succeeded' : 'uncertain' };
    },
  });
  f.copyStart = async () => {
    const p = await f.ops.prepare(actor, 'copy-object', 'copy', binding);
    return f.ops.confirm(actor, 'copy-object', 'copy', p.confirmationId);
  };
  return f;
}
test('snapshot copy streams bounded conditional ranges and deletes source only after destination proof', async () => {
  const f = await copySetup({ move: true });
  try {
    const receipt = await f.copyStart();
    await f.ops.drain();
    assert.equal(f.ops.read(actor, receipt.id).state, 'succeeded');
    assert.deepEqual(f.objects.get('model.bin').bytes, f.bytes);
    assert.equal(f.objects.has('origin.bin'), false);
    assert.equal(
      f.calls.some((c) => c.name === 'UploadPartCopy'),
      false,
    );
  } finally {
    await f.close();
  }
});
test('snapshot source change between ranges retains source and unfinished multipart without completion', async () => {
  const f = await copySetup({ move: true, changeSource: true });
  try {
    const receipt = await f.copyStart();
    await f.ops.drain();
    assert.equal(f.ops.read(actor, receipt.id).state, 'uncertain');
    assert.equal(f.objects.has('origin.bin'), true);
    assert.equal(f.objects.has('model.bin'), false);
    assert.equal(
      f.calls.some((c) => c.key === 'origin.bin' && c.name === 'DeleteObject'),
      false,
    );
  } finally {
    await f.close();
  }
});

test('pause drains in-flight parts; explicit lease-bound resume completes once', async () => {
  const f = await setup({ hold: true });
  try {
    const { receipt } = await f.start();
    await f.entered.promise;
    const r = await f.record();
    const pausing = f.action(r.id, 'pause');
    f.hold.resolve();
    await pausing;
    assert.equal((await f.record()).phase, 'paused');
    assert.equal(f.objects.has('model.bin'), false);
    await f.action(r.id, 'resume', { binding });
    await f.ops.drain();
    assert.equal(f.ops.read(actor, receipt.id).state, 'succeeded');
    assert.equal(
      f.calls.filter((c) => c.key === 'model.bin' && c.name === 'CompleteMultipartUpload').length,
      1,
    );
  } finally {
    await f.close();
  }
});
test('restart converts unfinished multipart to uncertain and does not automatically make any external request', async () => {
  const f = await setup({ losePart: true });
  try {
    await f.start();
    await f.ops.drain();
    const r = await f.record(),
      calls = f.calls.length;
    const raw = JSON.parse(await readFile(path.join(f.dir, 'r2-transfers.json'), 'utf8'));
    raw.records[0].phase = 'active';
    await writeFile(path.join(f.dir, 'r2-transfers.json'), JSON.stringify(raw), { mode: 0o600 });
    const restarted = new R2Transfers(
      f.dir,
      f.settings,
      f.jobs,
      f.ops,
      new Staging(f.dir),
      new FileResources(f.dir),
      f.port,
      async () => {},
      async () => actor,
    );
    await restarted.initialize();
    assert.equal((await f.record()).phase, 'uncertain');
    assert.equal(f.calls.length, calls);
    await assert.rejects(
      f.transfers.createTarget(
        { ...actor, userId: 'other', projectIds: [] },
        {
          projectId: 'A',
          sourceKind: 'server-file',
          sourceId: 'model',
          bucket: 'bucket',
          prefix: '',
        },
      ),
    );
    assert.equal((await f.record()).id, r.id);
  } finally {
    await f.close();
  }
});
