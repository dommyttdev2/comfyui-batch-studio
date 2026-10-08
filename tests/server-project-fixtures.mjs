import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
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
    permissions: ['read', 'edit', 'execute', 'admin'],
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
