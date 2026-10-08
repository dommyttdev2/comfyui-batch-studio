import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { JobRegistry } from '../dist-server/server/jobs.js';
import { fields } from '../dist-server/server/http.js';
import { fixture } from './server-fixtures.mjs';

const actor = {
  userId: 'operator',
  sessionId: 'session',
  requestId: 'request',
  projectIds: ['A', 'B'],
  permissions: ['read', 'execute', 'admin'],
};
const scope = { stage: 'story', provider: 'codex', turnId: 'turn' };
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
async function poll(fn) {
  const end = Date.now() + 3000;
  while (!fn()) {
    if (Date.now() > end) throw new Error('Job wait timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

test('durable atomic reservation, input identity and Project isolation survive reconnect/restart', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'batch-job-'));
  const held = deferred();
  let starts = 0;
  let released = 0;
  let reconciliations = 0;
  const definitions = new Map([
    [
      'probe',
      {
        validate: (input) => fields(input, ['value']),
        reserve: async () => ({
          release: async () => {
            released++;
          },
        }),
        run: async ({ signal, progress }) => {
          starts++;
          await progress(0.5);
          await Promise.race([
            held.promise,
            new Promise((r) => signal.addEventListener('abort', r, { once: true })),
          ]);
          return { state: signal.aborted ? 'cancelled' : 'succeeded' };
        },
        reconcile: async () => {
          reconciliations++;
          await new Promise((r) => setTimeout(r, 20));
          return { state: 'cancelled' };
        },
      },
    ],
    [
      'unknown',
      {
        validate: () => {},
        run: async () => {
          throw new Error('private-secret');
        },
      },
    ],
  ]);
  const jobs = new JobRegistry(dir, definitions);
  try {
    await jobs.initialize();
    const submitted = await Promise.all(
      Array.from({ length: 12 }, () =>
        jobs.submit(actor, 'A', 'probe', 'same', { value: 1 }, scope),
      ),
    );
    assert.equal(new Set(submitted.map((j) => j.id)).size, 1);
    await poll(() => starts === 1);
    await assert.rejects(jobs.submit(actor, 'A', 'probe', 'same', { value: 2 }, scope), /changed/);
    await assert.rejects(jobs.submit(actor, 'A', 'probe', 'different', {}, scope), /reserved/);
    const b = await jobs.submit(actor, 'B', 'probe', 'same', { value: 1 }, scope);
    await poll(() => starts === 2);
    assert.equal(jobs.list({ ...actor, projectIds: ['B'] }).length, 1);
    assert.throws(() => jobs.get({ ...actor, projectIds: ['B'] }, submitted[0].id));
    await jobs.cancel(actor, b.id);
    held.resolve();
    await jobs.drain();
    assert.equal(jobs.get(actor, submitted[0].id).state, 'succeeded');
    assert.equal(jobs.get(actor, b.id).state, 'cancelled');
    assert.equal(released, 2);
    const uncertain = await jobs.submit(actor, 'A', 'unknown', 'unknown', {}, scope);
    await jobs.drain();
    assert.equal(jobs.get(actor, uncertain.id).state, 'uncertain');
    assert.equal(JSON.stringify(jobs.list(actor)).includes('secret'), false);
    await assert.rejects(jobs.reconcile(actor, uncertain.id), /unavailable/);
    const stored = JSON.parse(await readFile(path.join(dir, 'jobs.json'), 'utf8'));
    stored.jobs[0].state = 'running';
    await writeFile(path.join(dir, 'jobs.json'), JSON.stringify(stored));
    const restarted = new JobRegistry(dir, definitions);
    await restarted.initialize();
    assert.equal(restarted.get(actor, submitted[0].id).state, 'uncertain');
    assert.equal(starts, 2); // initialize never restarts a side effect
    const checked = await Promise.all(
      Array.from({ length: 12 }, () => restarted.reconcile(actor, submitted[0].id)),
    );
    assert.ok(checked.every((job) => job.state === 'cancelled'));
    assert.equal(reconciliations, 1);
    await writeFile(path.join(dir, 'jobs.json'), '{"schema":"legacy","jobs":[]}');
    await assert.rejects(new JobRegistry(dir, definitions).initialize());
  } finally {
    held.resolve();
    await jobs.drain();
    await rm(dir, { recursive: true, force: true });
  }
});

test('HTTP job receipt is scoped and cancellation is explicit rather than request lifetime', async () => {
  const held = deferred();
  let jobs;
  const f = await fixture({ route: (ctx) => jobs.route(ctx) });
  jobs = new JobRegistry(
    f.dir,
    new Map([
      [
        'probe',
        {
          validate: (input) => fields(input, []),
          run: async () => {
            await held.promise;
            return { state: 'succeeded' };
          },
        },
      ],
    ]),
  );
  await jobs.initialize();
  try {
    const response = await fetch(f.runtime.origin + '/api/v1/projects/A/jobs/probe', {
      method: 'POST',
      headers: { ...f.headers, 'idempotency-key': 'request-one' },
      body: JSON.stringify({ input: {}, ...scope }),
    });
    assert.equal(response.status, 202);
    const job = (await response.json()).job;
    assert.equal(Object.hasOwn(job, 'input'), false);
    assert.notEqual(job.sessionId, f.headers.cookie.split('=')[1]);
    const listed = await fetch(f.runtime.origin + '/api/v1/jobs', { headers: f.headers });
    assert.equal((await listed.json()).jobs.length, 1);
    assert.notEqual(jobs.list(actor)[0].state, 'cancelled');
    held.resolve();
    await jobs.drain();
    assert.equal(jobs.get(actor, job.id).state, 'succeeded');
  } finally {
    held.resolve();
    await jobs.drain();
    await f.close();
  }
});

test('storage failure prevents runtime effects and blocks subsequent reservations', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'batch-job-failure-'));
  let starts = 0;
  const jobs = new JobRegistry(
    dir,
    new Map([
      [
        'probe',
        {
          validate: () => {},
          run: async () => {
            starts++;
            return { state: 'succeeded' };
          },
        },
      ],
    ]),
  );
  try {
    await jobs.initialize();
    await mkdir(path.join(dir, 'jobs.json'));
    await assert.rejects(jobs.submit(actor, 'A', 'probe', 'first', {}, scope));
    await assert.rejects(jobs.submit(actor, 'B', 'probe', 'second', {}, scope), /SERVER_DRAINING/);
    await assert.rejects(jobs.drain(), /reconciliation/);
    assert.equal(starts, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('forced shutdown fences outstanding reconciliation and refuses new reconciliation', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'batch-reconcile-'));
  const held = deferred();
  let entered = false;
  const jobs = new JobRegistry(
    dir,
    new Map([
      [
        'probe',
        {
          validate: () => {},
          run: async () => ({ state: 'uncertain' }),
          reconcile: async () => {
            entered = true;
            await held.promise;
            return { state: 'succeeded' };
          },
        },
      ],
    ]),
  );
  try {
    await jobs.initialize();
    const job = await jobs.submit(actor, 'A', 'probe', 'first', {}, scope);
    await jobs.drain();
    const pending = jobs.reconcile(actor, job.id);
    await poll(() => entered);
    await jobs.forceUncertain();
    await assert.rejects(jobs.reconcile(actor, job.id), /SERVER_DRAINING/);
    held.resolve();
    assert.equal((await pending).state, 'uncertain');
    await jobs.drain();
    const stored = JSON.parse(await readFile(path.join(dir, 'jobs.json'), 'utf8'));
    assert.equal(stored.jobs[0].state, 'uncertain');
  } finally {
    held.resolve();
    await jobs.drain();
    await rm(dir, { recursive: true, force: true });
  }
});
