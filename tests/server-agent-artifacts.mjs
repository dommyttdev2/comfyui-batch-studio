import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, link, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ProjectUseCases } from '../dist-server/application/project-use-cases.js';
import { AgentStore } from '../dist-server/server/agent-store.js';
import { AgentArtifacts, readAgentArtifact } from '../dist-server/server/agent-artifacts.js';
import { JobRegistry } from '../dist-server/server/jobs.js';
import { projectFixture } from './server-project-fixtures.mjs';
const hash = (v) => createHash('sha256').update(v).digest('hex');
test('job artifact imports once into draft, rejects changed hash/revision and rechecks grants', async () => {
  const f = await projectFixture(),
    directory = await mkdtemp(path.join(os.tmpdir(), 'agent-artifact-'));
  const store = new AgentStore(f.dir);
  await store.initialize();
  const jobs = new JobRegistry(
    f.dir,
    new Map([['agent', { validate: () => {}, run: async () => ({ state: 'succeeded' }) }]]),
  );
  await jobs.initialize();
  const scope = { projectId: f.id, stage: 'story', provider: 'codex' };
  const app = new ProjectUseCases(
    f.repo,
    { read: async () => null },
    { now: Date.now },
    { next: randomUUID },
    { text: hash },
  );
  const importer = new AgentArtifacts({ store, jobs, projects: f.repo }, app, directory);
  const prepare = async (key, text) => {
    const job = (
      await jobs.reserve(
        f.actor,
        f.id,
        'agent',
        key,
        {},
        { stage: 'story', provider: 'codex', turnId: key },
      )
    ).job;
    await jobs.activate(f.actor, job.id, {});
    await jobs.drain();
    const p = await app.read(f.actor, { projectId: f.id });
    await store.begin(f.actor, scope, job.id, null, 'task', 'story-finalize', p.revision);
    await store.update(f.actor, scope, job.id, {
      type: 'session.started',
      at: 1,
      sessionId: 'cli-session-' + key,
    });
    await store.update(f.actor, scope, job.id, {
      type: 'turn.started',
      at: 1,
      turnId: 'cli-turn-' + key,
    });
    await mkdir(path.join(directory, job.id, 'output'), { recursive: true });
    await writeFile(path.join(directory, job.id, 'output/story.md'), text);
    const artifact = await importer.capture(f.actor, scope, job);
    await store.finish(f.actor, scope, job.id, 'completed', artifact);
    return job;
  };
  try {
    const first = await prepare('one', '# Generated story');
    const result = await importer.ingest(f.actor, scope, first.id);
    assert.equal(result.project.drafts.story.content, '# Generated story');
    assert.equal(result.project.artifacts.story, undefined);
    assert.equal(store.record(f.actor, scope, first.id).imported, true);
    const again = await importer.ingest(f.actor, scope, first.id);
    assert.equal(again.project.revision, result.project.revision);
    const changed = await prepare('two', '# Original');
    await writeFile(path.join(directory, changed.id, 'output/story.md'), '# Changed');
    await assert.rejects(importer.ingest(f.actor, scope, changed.id));
    assert.equal(
      (await app.read(f.actor, { projectId: f.id })).drafts.story.content,
      '# Generated story',
    );
    const stale = await prepare('three', '# Stale generation');
    await f.repo.execute(f.actor, f.id, 'manual', {}, () =>
      f.repo.transaction(f.id, async (tx) => {
        const p = await tx.load(),
          before = p.revision;
        p.revision++;
        p.drafts.story.content = '# Manual edit';
        await tx.commit(before, p, {
          type: 'project.changed',
          projectId: f.id,
          userId: f.actor.userId,
          sessionId: f.actor.sessionId,
          requestId: 'manual',
          subjectId: 'story',
          revision: p.revision,
        });
        return p;
      }),
    );
    await assert.rejects(importer.ingest(f.actor, scope, stale.id));
    assert.equal(store.record(f.actor, scope, stale.id).importError, 'REVISION_CONFLICT');
    assert.equal(
      (await app.read(f.actor, { projectId: f.id })).drafts.story.content,
      '# Manual edit',
    );
    await assert.rejects(
      importer.ingest({ ...f.actor, permissions: ['read', 'execute'] }, scope, stale.id),
    );
    await assert.rejects(importer.read({ ...f.actor, userId: 'foreign' }, f.id, stale.id));
  } finally {
    await f.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test('output verifier rejects traversal, empty/large files, hard links and output directory aliases', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-output-')),
    id = randomUUID(),
    output = path.join(directory, id, 'output');
  await mkdir(output, { recursive: true });
  try {
    await assert.rejects(readAgentArtifact(directory, id, '../secret.json'));
    await writeFile(path.join(output, 'story.md'), '');
    await assert.rejects(readAgentArtifact(directory, id, 'story.md'));
    await writeFile(path.join(output, 'story.md'), 'x'.repeat(10_000_001));
    await assert.rejects(readAgentArtifact(directory, id, 'story.md'));
    await rm(path.join(output, 'story.md'));
    const outside = path.join(directory, 'outside');
    await mkdir(outside);
    await writeFile(path.join(outside, 'story.md'), '# Private');
    await link(path.join(outside, 'story.md'), path.join(output, 'story.md'));
    await assert.rejects(readAgentArtifact(directory, id, 'story.md'));
    await rm(output, { recursive: true });
    await symlink(outside, output, 'junction');
    await assert.rejects(readAgentArtifact(directory, id, 'story.md'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
