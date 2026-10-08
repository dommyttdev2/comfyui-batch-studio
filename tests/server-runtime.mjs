import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { createServerRuntime } from '../dist-server/server/runtime.js';
import { loadConfig } from '../dist-server/server/config.js';
import { fields, identifier } from '../dist-server/server/http.js';
import { ConfirmationUseCases } from '../dist-server/application/confirmation-use-cases.js';
import { writeAuth, token } from './server-fixtures.mjs';

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
    if (Date.now() > end) throw new Error('Runtime wait timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}
async function environment() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'batch-runtime-'));
  await writeAuth(dir);
  return { dir, config: await loadConfig({ dataDir: dir, port: 0 }) };
}
async function login(runtime, config) {
  const base = {
    origin: runtime.origin,
    'x-batch-api-version': '1',
    'x-batch-build-id': config.buildId,
    'content-type': 'application/json',
    'x-request-id': 'request',
  };
  const res = await fetch(runtime.origin + '/api/v1/session', {
    method: 'POST',
    headers: { ...base, authorization: 'Bearer ' + token },
    body: '{}',
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  return {
    ...base,
    cookie: res.headers.get('set-cookie').split(';')[0],
    'x-csrf-token': body.csrfToken,
  };
}

test('HTTP reaches P1 use case with scoped context; singleton and administrative shutdown work', async () => {
  const e = await environment();
  let inspected = 0;
  const core = new ConfirmationUseCases(
    {
      inspect: async () => {
        inspected++;
        return { fingerprint: 'current', revision: 1 };
      },
      save: async () => {},
      execute: async () => {
        throw new Error('Not used');
      },
    },
    { now: () => 100 },
    { next: () => 'confirmation' },
  );
  const commands = new Map([
    [
      'prepare',
      {
        permission: 'admin',
        validate: (input) => {
          fields(input, ['operation', 'targetId']);
          identifier(input.targetId);
        },
        execute: (who, input) => core.prepare(who, input),
      },
    ],
  ]);
  const runtime = await createServerRuntime(e.config, { commands, shutdownMs: 100 });
  try {
    await assert.rejects(createServerRuntime(e.config), /Ownership/);
    const headers = await login(runtime, e.config);
    const response = await fetch(runtime.origin + '/api/v1/projects/A/commands/prepare', {
      method: 'POST',
      headers,
      body: JSON.stringify({ operation: 'reset-editor', targetId: 'caption' }),
    });
    assert.equal(response.status, 200);
    assert.equal(inspected, 1);
    const result = (await response.json()).result;
    assert.equal(result.projectId, 'A');
    assert.notEqual(result.sessionId, headers.cookie.split('=')[1]);
    const shutdown = await fetch(runtime.origin + '/api/v1/admin/shutdown', {
      method: 'POST',
      headers,
      body: '{"mode":"drain"}',
    });
    assert.equal(shutdown.status, 202);
    await runtime.close();
    assert.equal(runtime.state(), 'closed');
    const restarted = await createServerRuntime(e.config);
    await restarted.close();
  } finally {
    await runtime.close();
    await rm(e.dir, { recursive: true, force: true });
  }
});

test('drain preserves running work and rejects new starts; stop acknowledges cancellation', async () => {
  const e = await environment();
  const held = deferred();
  let starts = 0;
  const runtime = await createServerRuntime(e.config, {
    shutdownMs: 1000,
    definitions: new Map([
      [
        'probe',
        {
          validate: () => {},
          run: async () => {
            starts++;
            await held.promise;
            return { state: 'succeeded' };
          },
        },
      ],
    ]),
  });
  try {
    const job = await runtime.jobs.submit(actor, 'A', 'probe', 'one', {}, scope);
    await poll(() => starts === 1);
    const closing = runtime.close();
    await assert.rejects(
      runtime.jobs.submit(actor, 'B', 'probe', 'two', {}, scope),
      /SERVER_DRAINING/,
    );
    held.resolve();
    await closing;
    assert.equal(runtime.jobs.get(actor, job.id).state, 'succeeded');
    const second = await createServerRuntime(e.config, {
      shutdownMs: 100,
      definitions: new Map([
        [
          'cancel',
          {
            validate: () => {},
            run: async ({ signal }) => {
              await new Promise((r) =>
                signal.aborted ? r() : signal.addEventListener('abort', r, { once: true }),
              );
              return { state: 'cancelled' };
            },
          },
        ],
      ]),
    });
    const cancel = await second.jobs.submit(actor, 'A', 'cancel', 'three', {}, scope);
    await second.close('stop');
    assert.equal(second.jobs.get(actor, cancel.id).state, 'cancelled');
  } finally {
    held.resolve();
    await runtime.close();
    await rm(e.dir, { recursive: true, force: true });
  }
});

test('deadline retains uncertain ownership and fences late completion after force', async () => {
  const e = await environment();
  const held = deferred();
  let released = 0;
  let interrupted = 0;
  let running = false;
  const definitions = new Map([
    [
      'probe',
      {
        validate: () => {},
        reserve: async () => ({
          release: async () => {
            released++;
          },
        }),
        run: async () => {
          running = true;
          await held.promise;
          return { state: 'succeeded' };
        },
        interrupt: async () => {
          interrupted++;
        },
        reconcile: async () => ({ state: 'cancelled' }),
      },
    ],
  ]);
  const runtime = await createServerRuntime(e.config, { definitions, shutdownMs: 1000 });
  try {
    const job = await runtime.jobs.submit(actor, 'A', 'probe', 'one', {}, scope);
    await poll(() => running);
    await runtime.close();
    assert.equal(runtime.jobs.get(actor, job.id).state, 'uncertain');
    assert.equal(interrupted, 1);
    assert.equal(released, 0);
    held.resolve();
    await runtime.jobs.drain();
    assert.equal(runtime.jobs.get(actor, job.id).state, 'uncertain');
    assert.equal(released, 0);
    const restarted = await createServerRuntime(e.config, { definitions });
    assert.equal(restarted.jobs.get(actor, job.id).state, 'uncertain');
    assert.equal((await restarted.jobs.reconcile(actor, job.id)).state, 'cancelled');
    await restarted.close();
  } finally {
    held.resolve();
    await runtime.close();
    await rm(e.dir, { recursive: true, force: true });
  }
});

test('real entry starts without Electron, crashes conservatively and needs explicit dead-lock recovery', async () => {
  const e = await environment();
  const entry = path.resolve('dist-server/server/entry.js');
  const env = { ...process.env, BATCH_STUDIO_DATA_DIR: e.dir, BATCH_STUDIO_PORT: '0' };
  const child = spawn(process.execPath, [entry], {
    cwd: e.dir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (data) => {
    output += data;
  });
  try {
    await poll(() => output.includes('listening at'));
    const rejected = spawn(process.execPath, [entry], { cwd: e.dir, env, stdio: 'ignore' });
    assert.equal((await once(rejected, 'exit'))[0], 1);
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    const failed = spawn(process.execPath, [entry], { cwd: e.dir, env, stdio: 'ignore' });
    assert.equal((await once(failed, 'exit'))[0], 1);
    const recovery = spawn(process.execPath, [path.resolve('dist-server/server/recover.js')], {
      cwd: e.dir,
      env,
      stdio: 'ignore',
    });
    assert.equal((await once(recovery, 'exit'))[0], 0);
    const runtime = await createServerRuntime(e.config);
    await runtime.close();
    const events = JSON.parse(
      await readFile(path.join(e.dir, 'events.json'), 'utf8').catch(() => '{}'),
    );
    assert.equal(events.schema === undefined || events.schema === 'web-events/1', true);
  } finally {
    child.kill();
    await rm(e.dir, { recursive: true, force: true });
  }
});

test('disconnected HTTP work remains owned when shutdown exceeds its deadline', async () => {
  const e = await environment();
  const held = deferred();
  let entered = false;
  const runtime = await createServerRuntime(e.config, {
    shutdownMs: 100,
    commands: new Map([
      [
        'probe',
        {
          permission: 'admin',
          validate: () => {},
          execute: async () => {
            entered = true;
            await held.promise;
            return {};
          },
        },
      ],
    ]),
  });
  const controller = new AbortController();
  try {
    const headers = await login(runtime, e.config);
    const request = fetch(runtime.origin + '/api/v1/projects/A/commands/probe', {
      method: 'POST',
      headers,
      body: '{}',
      signal: controller.signal,
    }).catch(() => {});
    await poll(() => entered);
    controller.abort();
    await request;
    await assert.rejects(runtime.close(), /HTTP work deadline/);
    assert.equal(runtime.state(), 'uncertain');
    await assert.rejects(createServerRuntime(e.config), /Ownership/);
    const owner = JSON.parse(await readFile(path.join(e.dir, 'server.lock', 'owner.json'), 'utf8'));
    assert.equal(owner.pid, process.pid);
  } finally {
    held.resolve();
    await runtime.drainRequests();
    await runtime.close().catch(() => {});
    await rm(e.dir, { recursive: true, force: true });
  }
});
