import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, writeFile, mkdir, symlink, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { projectFixture } from './server-project-fixtures.mjs';
import { login } from './server-project-http-fixtures.mjs';
import { ProjectRegistration } from '../dist-server/server/project-registration.js';
import { createServerRuntime } from '../dist-server/server/runtime.js';
import { loadConfig } from '../dist-server/server/config.js';
import { EventBroker } from '../dist-server/server/events.js';
import { atomicJson } from '../dist-server/server/storage.js';

test('registered aliases deduplicate; root escapes and old envelopes reject without conversion', async () => {
  const f = await projectFixture();
  try {
    const registration = new ProjectRegistration(f.dir);
    await symlink(path.join(f.root, 'Alpha'), path.join(f.root, 'Alias'), 'junction');
    const same = await registration.provision(
      f.actor,
      'alias',
      { rootId: 'root', directoryName: 'Alias' },
      'register',
    );
    assert.equal(same.id, f.id);
    await symlink(f.dir, path.join(f.root, 'Escape'), 'junction');
    await assert.rejects(
      registration.provision(
        f.actor,
        'escape',
        { rootId: 'root', directoryName: 'Escape' },
        'register',
      ),
      /ROOT_CHANGED/,
    );
    if (process.platform === 'win32') {
      const lower = await registration.provision(
        f.actor,
        'case',
        { rootId: 'root', directoryName: 'alpha' },
        'register',
      );
      assert.equal(lower.id, f.id);
    }
    const file = path.join(f.root, 'Alpha', 'web-project.json');
    const original = await readFile(file, 'utf8');
    await writeFile(file, '{"schema":"old-project/1"}');
    await assert.rejects(f.app.read(f.actor, { projectId: f.id }));
    assert.equal(await readFile(file, 'utf8'), '{"schema":"old-project/1"}');
    await writeFile(file, original);
    await atomicJson(path.join(f.dir, 'events.json'), {
      schema: 'web-events/1',
      sequence: 0,
      events: [],
    });
    await assert.rejects(new EventBroker(f.dir, () => []).initialize());
    // Remove only the explicitly created links before recursive fixture cleanup on Windows.
    await rm(path.join(f.root, 'Alias'));
    await rm(path.join(f.root, 'Escape'));
  } finally {
    await f.close();
  }
});

test('binary asset HTTP validates scope, hash, traversal and junction replacement', async () => {
  const f = await projectFixture();
  await f.repo.close();
  const root = path.join(f.root, 'Alpha');
  const assets = path.join(root, 'assets');
  await mkdir(assets);
  const bytes = Buffer.from('registered asset');
  await writeFile(path.join(assets, 'test.txt'), bytes);
  const manifest = {
    schema: 'web-assets/1',
    assets: [
      {
        id: 'test',
        file: 'test.txt',
        mime: 'text/plain',
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    ],
  };
  await atomicJson(path.join(root, 'web-assets.json'), manifest);
  const config = await loadConfig({ dataDir: f.dir, port: 0 });
  const runtime = await createServerRuntime(config);
  try {
    const headers = await login(runtime, config);
    const get = (id, project = f.id) =>
      fetch(runtime.origin + '/api/v1/projects/' + project + '/assets/' + id, { headers });
    let res = await get('test');
    assert.equal(res.status, 200);
    assert.equal(await res.text(), bytes.toString());
    assert.equal((await get('missing')).status, 404);
    assert.equal((await get('test', 'unknown')).status, 403);
    assert.equal((await get('template-illustrious')).status, 200);
    await writeFile(path.join(assets, 'test.txt'), 'replaced');
    assert.equal((await get('test')).status, 409);
    manifest.assets[0].file = '../web-project.json';
    await atomicJson(path.join(root, 'web-assets.json'), manifest);
    assert.equal((await get('test')).status, 403);
    manifest.assets[0].file = 'test.txt';
    await atomicJson(path.join(root, 'web-assets.json'), manifest);
    await rm(assets, { recursive: true });
    await symlink(f.dir, assets, 'junction');
    assert.equal((await get('test')).status, 403);
    await rm(assets);
  } finally {
    await runtime.close();
    await f.close();
  }
});

test('killed writer freezes reserved operation; explicit dead-owner reconciliation retains tombstone', async () => {
  const f = await projectFixture();
  await f.repo.close();
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import {ProjectRegistry, Ownership} from './dist-server/server/ownership.js';
    import {DiskProjects} from './dist-server/server/project-repository.js';
    import {EventBroker} from './dist-server/server/events.js';
    const actor = JSON.parse(process.env.PROBE_ACTOR);
    const broker = new EventBroker(process.env.BATCH_STUDIO_DATA_DIR, () => []); await broker.initialize();
    const repo = new DiskProjects(new ProjectRegistry(process.env.BATCH_STUDIO_DATA_DIR),new Ownership(),broker);
    await repo.initialize();
    await repo.execute(actor,actor.projectIds[0],'interrupted',{action:'probe'},async () => {
      console.log('reserved'); await new Promise(() => {setInterval(() => {},1000);});
    });
  `,
    ],
    {
      env: { ...process.env, BATCH_STUDIO_DATA_DIR: f.dir, PROBE_ACTOR: JSON.stringify(f.actor) },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  try {
    await new Promise((resolve, reject) => {
      child.stdout.on('data', (data) => {
        if (data.toString().includes('reserved')) resolve();
      });
      child.on('exit', (code) => reject(Error('writer exited ' + code)));
      child.on('error', reject);
    });
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    await assert.rejects(f.repo.initialize(), /Ownership is held/);
    const cli = spawnSync(process.execPath, ['dist-server/server/project-recover.js'], {
      env: {
        ...process.env,
        BATCH_STUDIO_DATA_DIR: f.dir,
        BATCH_STUDIO_PROJECT_ID: f.id,
        BATCH_STUDIO_OPERATION_ID: 'interrupted',
      },
      encoding: 'utf8',
    });
    assert.equal(cli.status, 0, cli.stderr);
    await f.repo.initialize();
    await assert.rejects(
      f.repo.execute(f.actor, f.id, 'interrupted', { action: 'probe' }, () => {
        throw Error('must not replay');
      }),
      /OPERATION_EXPIRED/,
    );
    const next = await f.repo.execute(f.actor, f.id, 'next', {}, () =>
      f.app.acquireLease(f.actor, { projectId: f.id }),
    );
    assert.equal(next.project.revision, 1);
    const e = JSON.parse(await readFile(path.join(f.root, 'Alpha', 'web-project.json'), 'utf8'));
    assert.equal(e.operations.find((o) => o.id === 'interrupted').result, null);
  } finally {
    child.kill();
    await f.close();
  }
});

test('provisioning interrupted after grant resumes one identity; operation quota and expired lease refuse writes', async () => {
  const f = await projectFixture();
  try {
    const registration = new ProjectRegistration(f.dir);
    registration.registry.register = async () => {
      throw Error('publish interrupted');
    };
    await assert.rejects(
      registration.provision(f.actor, 'new', { rootId: 'root', directoryName: 'Beta' }, 'create'),
      /publish interrupted/,
    );
    const restarted = new ProjectRegistration(f.dir);
    await restarted.initialize();
    const result = await restarted.provision(
      f.actor,
      'new',
      { rootId: 'root', directoryName: 'Beta' },
      'create',
    );
    const intents = JSON.parse(await readFile(path.join(f.dir, 'provisioning.json'), 'utf8'));
    assert.equal(intents.intents.filter((i) => i.operation === 'new').length, 1);
    const auth = JSON.parse(await readFile(path.join(f.dir, 'auth.json'), 'utf8'));
    assert.equal(auth.principals[0].projectIds.filter((id) => id === result.id).length, 1);
    const first = await f.repo.execute(f.actor, f.id, 'lease', {}, () =>
      f.app.acquireLease(f.actor, { projectId: f.id }),
    );
    f.time(61000);
    await assert.rejects(
      f.repo.execute(f.actor, f.id, 'expired', {}, () =>
        f.app.saveDraft(f.actor, {
          projectId: f.id,
          expectedRevision: 1,
          leaseId: first.project.lease.id,
          key: 'story',
          content: 'stale',
        }),
      ),
      /lease/i,
    );
    const file = path.join(f.root, 'Alpha', 'web-project.json');
    const e = JSON.parse(await readFile(file, 'utf8'));
    e.operations = Array.from({ length: 100000 }, (_, i) => ({
      id: 'key' + i,
      user: 'operator',
      hash: '0'.repeat(64),
      time: 0,
      state: 'done',
      result: null,
    }));
    await atomicJson(file, e);
    await assert.rejects(
      f.repo.execute(f.actor, f.id, 'overflow', {}, () => {
        throw Error('must not execute');
      }),
      /STORAGE_LIMIT/,
    );
  } finally {
    await f.close();
  }
});

test('process crash after broker append replays committed outbox without duplicate sequence', async () => {
  const f = await projectFixture();
  await f.repo.close();
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import {ProjectRegistry,Ownership} from './dist-server/server/ownership.js';
    import {DiskProjects} from './dist-server/server/project-repository.js';
    import {EventBroker} from './dist-server/server/events.js';
    import {ProjectUseCases} from './dist-server/application/project-use-cases.js';
    const actor=JSON.parse(process.env.PROBE_ACTOR);
    const broker=new EventBroker(process.env.BATCH_STUDIO_DATA_DIR,()=>[]);await broker.initialize();
    const repo=new DiskProjects(new ProjectRegistry(process.env.BATCH_STUDIO_DATA_DIR),new Ownership(),broker);
    const app=new ProjectUseCases(repo,{read:async()=>null},{now:Date.now},{next:()=>crypto.randomUUID()});await repo.initialize();
    const append=broker.appendProject.bind(broker);broker.appendProject=async event=>{await append(event);console.log('appended');await new Promise(()=>setInterval(()=>{},1000));};
    await repo.execute(actor,actor.projectIds[0],'committed',{},()=>app.acquireLease(actor,{projectId:actor.projectIds[0]}));
  `,
    ],
    {
      env: { ...process.env, BATCH_STUDIO_DATA_DIR: f.dir, PROBE_ACTOR: JSON.stringify(f.actor) },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  try {
    await new Promise((resolve, reject) => {
      child.stdout.on('data', (d) => {
        if (d.toString().includes('appended')) resolve();
      });
      child.on('exit', (c) => reject(Error('writer exited ' + c)));
      child.on('error', reject);
    });
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    const file = path.join(f.root, 'Alpha', 'web-project.json');
    const before = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(before.delivery, 0);
    assert.equal(before.project.revision, 1);
    const eventId = before.outbox[0].eventId;
    const cli = spawnSync(process.execPath, ['dist-server/server/project-recover.js'], {
      env: { ...process.env, BATCH_STUDIO_DATA_DIR: f.dir, BATCH_STUDIO_PROJECT_ID: f.id },
      encoding: 'utf8',
    });
    assert.equal(cli.status, 0, cli.stderr);
    await f.broker.initialize();
    await f.repo.initialize();
    const journal = JSON.parse(await readFile(path.join(f.dir, 'events.json'), 'utf8'));
    assert.equal(journal.events.filter((e) => e.eventId === eventId).length, 1);
    const after = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(after.outbox.length, 0);
    assert.equal(after.project.revision, 1);
    const receipt = await f.repo.execute(f.actor, f.id, 'committed', {}, () => {
      throw Error('must not replay');
    });
    assert.equal(receipt.project.revision, 1);
  } finally {
    child.kill();
    await f.close();
  }
});
