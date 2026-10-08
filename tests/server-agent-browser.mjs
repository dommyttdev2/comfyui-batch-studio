import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect } from '@playwright/test';
import { browserFixture } from './server-project-browser-fixtures.mjs';
import { fixtureAgents, seedBrief } from './server-agent-fixtures.mjs';
async function fixture(options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-browser-'));
  const agents = fixtureAgents(directory, options);
  const f = await browserFixture(2, undefined, undefined, undefined, agents);
  return {
    ...f,
    agents,
    close: async () => {
      await f.runtime.close('stop');
      await f.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
async function story(p, name = 'Alpha') {
  await p.getByRole('button', { name, exact: true }).click();
  await p.getByRole('button', { name: 'ストーリー', exact: true }).click();
  await expect(p.getByRole('status').filter({ hasText: 'CLI利用可能' })).toBeVisible();
}
test('Chromium agent scopes preserve inputs/history, flush edits, resume and import task as draft', async () => {
  const f = await fixture();
  const p = f.page;
  try {
    const seeded = await seedBrief(f.runtime, f.actor, f.id);
    await f.runtime.repository.execute(f.actor, f.id, 'seed-release', {}, () =>
      f.runtime.projectApi.projects.releaseLease(f.actor, {
        projectId: f.id,
        expectedRevision: seeded.revision,
        leaseId: seeded.lease.id,
      }),
    );
    await story(p);
    await p.getByLabel('Artifact内容').fill('# unsent story');
    await p.getByLabel('Assistant入力').fill('chat alpha');
    await p.getByRole('button', { name: '送信', exact: true }).click();
    await expect(p.getByLabel('Assistant会話')).toContainText('Fixture codex answer');
    await expect(p.getByRole('button', { name: '新規会話', exact: true })).toBeEnabled();
    await p.getByLabel('Assistant入力').fill('resume alpha');
    await p.getByRole('button', { name: '送信', exact: true }).click();
    await expect.poll(() => f.agents.state.starts).toBe(2);
    await expect.poll(() => f.agents.state.resumes).toBe(1);
    await p.getByRole('tab', { name: 'Home', exact: true }).click();
    await story(p, 'Beta');
    await expect(p.getByLabel('Assistant入力')).toHaveValue('');
    await expect(p.getByLabel('Assistant会話')).toBeEmpty();
    await p.getByRole('tab', { name: /^Alpha/ }).click();
    await expect(p.getByLabel('Assistant入力')).toHaveValue('resume alpha');
    await p.getByLabel('Provider').selectOption('grok');
    await expect(p.getByLabel('Assistant入力')).toHaveValue('');
    await p.getByLabel('Provider').selectOption('codex');
    await expect(p.getByLabel('Assistant入力')).toHaveValue('resume alpha');
    await expect(p.getByRole('button', { name: '工程タスクを実行', exact: true })).toBeEnabled();
    await p.getByLabel('工程タスク', { exact: true }).selectOption('story-finalize');
    await p.getByRole('button', { name: '工程タスクを実行', exact: true }).click();
    await expect(p.getByText('下書きへ取り込み済み', { exact: true })).toBeVisible();
    const project = await f.runtime.projectApi.projects.read(f.actor, { projectId: f.id });
    assert.equal(project.drafts.story.content, '# Fixture story');
    assert.notEqual(project.artifacts.story?.content, '# Fixture story');
  } finally {
    await f.close();
  }
});
test('Chromium closing a running agent tab does not cancel it or reuse old tab input; explicit stop releases ownership', async () => {
  const f = await fixture({ hold: true });
  const p = f.page;
  try {
    await story(p);
    await p.getByLabel('Assistant入力').fill('held chat');
    await p.getByRole('button', { name: '送信', exact: true }).click();
    await expect(p.getByRole('button', { name: '停止', exact: true })).toBeVisible();
    await p.getByRole('button', { name: 'Alphaを閉じる', exact: true }).click();
    await expect(p.getByRole('tab')).toHaveCount(1);
    assert.equal(f.agents.state.active.size, 1);
    await story(p);
    await expect(p.getByLabel('Assistant入力')).toHaveValue('');
    await p.getByRole('button', { name: '停止', exact: true }).click();
    await expect(p.getByText('cancelled', { exact: true })).toBeVisible();
    assert.equal(f.agents.state.active.size, 0);
  } finally {
    await f.close();
  }
});
test('Chromium lost acceptance reply retries the same operation instead of launching another CLI', async () => {
  const f = await fixture();
  const p = f.page;
  const keys = [];
  try {
    await story(p);
    let lost = false;
    await p.route('**/agents/story/codex/chat', async (route) => {
      keys.push(route.request().headers()['idempotency-key']);
      const response = await route.fetch();
      if (!lost) {
        lost = true;
        await route.abort('failed');
      } else await route.fulfill({ response });
    });
    await p.getByLabel('Assistant入力').fill('lost reply');
    await p.getByRole('button', { name: '送信', exact: true }).click();
    await expect(
      p.getByRole('button', { name: '同じリクエストを再確認', exact: true }),
    ).toBeVisible();
    await p.getByRole('button', { name: '同じリクエストを再確認', exact: true }).click();
    await expect(
      p.getByRole('button', { name: '同じリクエストを再確認', exact: true }),
    ).toHaveCount(0);
    assert.equal(f.agents.state.starts, 1);
    assert.equal(keys[0], keys[1]);
  } finally {
    await f.close();
  }
});
