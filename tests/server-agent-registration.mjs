import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { projectFixture } from './server-project-fixtures.mjs';
import { loadAgentRegistration } from '../dist-server/server/agent-registration.js';
import { ProjectRegistry } from '../dist-server/server/ownership.js';
test('registered runtime checks new Project overlap again before CLI launch', async () => {
  const f = await projectFixture(),
    directory = await mkdtemp(path.join(os.tmpdir(), 'agent-isolation-'));
  const credential = path.join(f.dir, 'test-cli-auth.json');
  try {
    await writeFile(credential, '{}');
    await writeFile(
      path.join(f.dir, 'agent-runtime.json'),
      JSON.stringify({
        schema: 'web-agent-runtime/1',
        docker: process.execPath,
        image: 'sha256:' + '1'.repeat(64),
        context: 'explicit',
        directory,
        providers: { codex: { credential, version: '0.155.1' } },
      }),
    );
    const configured = await loadAgentRegistration(f.dir);
    await configured.assertIsolation();
    await new ProjectRegistry(f.dir).register(
      { ...f.actor, projectIds: [...f.actor.projectIds, 'overlap'] },
      'overlap',
      directory,
    );
    await assert.rejects(configured.assertIsolation(), /overlaps/);
    await assert.rejects(loadAgentRegistration(f.dir), /overlaps/);
  } finally {
    await f.close();
    await rm(directory, { recursive: true, force: true });
  }
});
