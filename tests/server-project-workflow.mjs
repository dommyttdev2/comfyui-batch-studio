import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { projectFixture } from './server-project-fixtures.mjs';
import { ProjectUseCases } from '../dist-server/application/project-use-cases.js';
import { WorkflowApi, FixtureCatalog } from '../dist-server/server/workflow-api.js';
import { loadConfig } from '../dist-server/server/config.js';
const require = createRequire(import.meta.url);
const { artifacts } = require('./core-support/artifact-fixtures.cjs');
test('fixture catalog and registered resources compile deterministically into atomic provenance', async () => {
  const f = await projectFixture();
  try {
    const { models, plan } = artifacts();
    const selections = [models.checkpoint, ...models.loras];
    const catalog = {
      ...models.catalog,
      collections: [
        {
          items: selections.map((s) => ({
            ...s,
            modelType: s.ref.startsWith('lora.') ? 'LORA' : 'Checkpoint',
            versions: [
              {
                ...s,
                baseModel: 'Illustrious',
                files: [{ id: s.fileId, name: s.fileName, type: 'Model' }],
              },
            ],
          })),
        },
      ],
    };
    const file = path.join(f.dir, 'catalog.json');
    await writeFile(file, JSON.stringify(catalog));
    const config = await loadConfig({ dataDir: f.dir });
    const source = new FixtureCatalog(file);
    const api = new WorkflowApi(config, f.repo, source);
    const app = new ProjectUseCases(
      f.repo,
      source,
      { now: Date.now },
      { next: () => crypto.randomUUID() },
    );
    let p = (
      await f.repo.execute(f.actor, f.id, 'lease', {}, () =>
        app.acquireLease(f.actor, { projectId: f.id }),
      )
    ).project;
    let n = 0;
    for (const [key, content] of [
      ['models', JSON.stringify(models)],
      ['promptPlan', JSON.stringify(plan)],
    ]) {
      let c = { projectId: f.id, expectedRevision: p.revision, leaseId: p.lease.id, key, content };
      p = (await f.repo.execute(f.actor, f.id, 'save-' + ++n, c, () => app.saveDraft(f.actor, c)))
        .project;
      assert.equal(p.drafts[key].validation.valid, true);
      c = { ...c, expectedRevision: p.revision };
      p = (await f.repo.execute(f.actor, f.id, 'confirm-' + n, c, () => app.confirm(f.actor, c)))
        .project;
    }
    const command = { projectId: f.id, expectedRevision: p.revision, leaseId: p.lease.id };
    p = (
      await f.repo.execute(f.actor, f.id, 'compile', command, () =>
        api.workflows.compile(f.actor, command),
      )
    ).project;
    assert.equal(p.artifacts.workflow.status, 'confirmed');
    assert.equal(await api.workflows.status(f.actor, { projectId: f.id }), 'current');
    const build = JSON.parse(p.artifacts.workflow.content);
    assert.ok(build.apiSha256);
    assert.ok(build.template.sha256);
    const next = { ...command, expectedRevision: p.revision };
    const second = (
      await f.repo.execute(f.actor, f.id, 'compile2', next, () =>
        api.workflows.compile(f.actor, next),
      )
    ).project;
    assert.equal(JSON.parse(second.artifacts.workflow.content).apiSha256, build.apiSha256);
    await writeFile(file, '{"schemaVersion":0}');
    await assert.rejects(source.read(), /INVALID_CATALOG/);
    assert.equal(await new FixtureCatalog().read(), null);
    const disk = JSON.parse(await readFile(path.join(f.root, 'Alpha', 'web-project.json'), 'utf8'));
    assert.equal(disk.project.revision, second.revision);
  } finally {
    await f.close();
  }
});
