import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import { ProjectRegistration } from '../dist-server/server/project-registration.js';
import { DiskProjects } from '../dist-server/server/project-repository.js';
import { Ownership } from '../dist-server/server/ownership.js';
import { EventBroker } from '../dist-server/server/events.js';
import { atomicJson } from '../dist-server/server/storage.js';
import { ProjectUseCases } from '../dist-server/application/project-use-cases.js';
import { writeAuth } from './server-fixtures.mjs';
export async function projectFixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'web-project-disk-'));
  const root = path.join(dir, 'root');
  await mkdir(root);
  await writeAuth(dir);
  await atomicJson(path.join(dir, 'project-roots.json'), {
    schema: 'web-project-roots/1',
    roots: [{ id: 'root', name: 'Root', root }],
  });
  const registration = new ProjectRegistration(dir);
  const actor = {
    userId: 'operator',
    sessionId: 'session',
    requestId: 'request',
    projectIds: [],
    permissions: ['read', 'edit', 'admin'],
  };
  const created = await registration.provision(
    actor,
    'create',
    { rootId: 'root', directoryName: 'Alpha' },
    'create',
  );
  actor.projectIds = [created.id];
  const broker = new EventBroker(dir, () => []);
  await broker.initialize();
  let time = 1000;
  const repo = new DiskProjects(registration.registry, new Ownership(), broker, () => time);
  const app = new ProjectUseCases(
    repo,
    { read: async () => null },
    { now: () => time },
    { next: () => crypto.randomUUID() },
  );
  await repo.initialize();
  return {
    dir,
    root,
    id: created.id,
    actor,
    broker,
    repo,
    app,
    time: (v) => (time = v),
    close: async () => {
      await repo.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
test('disk transactions enforce lease/CAS, receipt identity and atomic scoped Project outbox', async () => {
  const f = await projectFixture();
  try {
    const packets = [];
    const off = await f.broker.subscribe(f.actor, [f.id], undefined, (p) => {
      packets.push(p);
      return true;
    });
    const submit = (key, input, work) => f.repo.execute(f.actor, f.id, key, input, work);
    const first = await submit('acquire', {}, () =>
      f.app.acquireLease(f.actor, { projectId: f.id }),
    );
    const lease = first.project.lease.id;
    const command = { projectId: f.id, expectedRevision: 1, leaseId: lease };
    const renewed = await submit('renew', command, () => f.app.renewLease(f.actor, command));
    assert.equal(renewed.project.lease.id, lease);
    assert.equal(renewed.project.revision, 2);
    const save = { ...command, expectedRevision: 2, key: 'story', content: '# Story' };
    const all = await Promise.all(
      Array.from({ length: 10 }, () => submit('save', save, () => f.app.saveDraft(f.actor, save))),
    );
    assert.ok(all.every((x) => x.project.revision === 3));
    assert.equal(all[0].project.artifacts.story, undefined);
    await assert.rejects(
      submit('save', { ...save, content: 'changed' }, () => f.app.saveDraft(f.actor, save)),
      /OPERATION_KEY_CONFLICT/,
    );
    await assert.rejects(
      submit('stale', save, () => f.app.saveDraft(f.actor, save)),
      /revision/i,
    );
    await assert.rejects(
      f.repo.execute({ ...f.actor, sessionId: 'other' }, f.id, 'other', {}, () =>
        f.app.acquireLease({ ...f.actor, sessionId: 'other' }, { projectId: f.id }),
      ),
      /lease/i,
    );
    const stored = JSON.parse(
      await readFile(path.join(f.root, 'Alpha', 'web-project.json'), 'utf8'),
    );
    assert.equal(stored.project.revision, 3);
    assert.equal(stored.outbox.length, 0);
    assert.equal(stored.operations.filter((o) => o.state === 'done').length, 3);
    assert.equal(packets.filter((p) => p.type === 'project.changed').length, 3);
    assert.equal(JSON.stringify(packets).includes(lease), false);
    off();
    f.time(8 * 86400000);
    await assert.rejects(
      submit('save', save, () => f.app.saveDraft(f.actor, save)),
      /OPERATION_EXPIRED/,
    );
  } finally {
    await f.close();
  }
});
test('outbox acknowledgement survives interrupted delivery and replay deduplicates event identity', async () => {
  const f = await projectFixture();
  try {
    const old = f.broker.appendProject;
    f.broker.appendProject = async () => {
      throw Error('interrupted');
    };
    const receipt = await f.repo.execute(f.actor, f.id, 'acquire', {}, () =>
      f.app.acquireLease(f.actor, { projectId: f.id }),
    );
    assert.equal(receipt.eventDelivery, 'pending');
    const file = path.join(f.root, 'Alpha', 'web-project.json');
    const e = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(e.outbox.length, 1);
    f.broker.appendProject = old;
    await old(e.outbox[0]);
    await f.repo.flush(f.id, e);
    const journal = JSON.parse(await readFile(path.join(f.dir, 'events.json'), 'utf8'));
    assert.equal(journal.events.filter((x) => x.eventId === e.outbox[0]?.eventId).length, 0);
    assert.equal(
      journal.events.filter((x) => x.type === 'project.changed' && x.revision === 1).length,
      1,
    );
    await f.repo.close();
    await f.repo.initialize();
    assert.equal((await f.app.read(f.actor, { projectId: f.id })).revision, 1);
  } finally {
    await f.close();
  }
});
