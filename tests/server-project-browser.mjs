import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expect } from '@playwright/test';
import { browserFixture } from './server-project-browser-fixtures.mjs';
test('Chromium keeps A/B drafts and Pane state isolated, flushes navigation, deduplicates and closes tabs', async () => {
  const f = await browserFixture();
  const p = f.page;
  try {
    await p.getByRole('button', { name: 'Alpha', exact: true }).click();
    await p.getByRole('button', { name: 'ストーリー', exact: true }).click();
    await p.getByLabel('Artifact内容').fill('# Alpha story');
    await p.getByLabel('Provider').selectOption('grok');
    await p.getByLabel('Assistant入力').fill('Alpha assistant');
    await p.getByRole('tab', { name: 'Home', exact: true }).click();
    await p.getByRole('button', { name: 'Beta', exact: true }).click();
    await p.getByRole('button', { name: 'ストーリー', exact: true }).click();
    await p.getByLabel('Artifact内容').fill('# Beta story');
    await p.getByRole('tab', { name: /^Alpha/ }).click();
    await expect(p.getByLabel('Artifact内容')).toHaveValue('# Alpha story');
    await expect(p.getByLabel('Provider')).toHaveValue('grok');
    await expect(p.getByLabel('Assistant入力')).toHaveValue('Alpha assistant');
    await p.getByRole('tab', { name: 'Home', exact: true }).click();
    await p.getByRole('button', { name: 'Alpha', exact: true }).click();
    await expect(p.getByRole('tab')).toHaveCount(3);
    await p.getByRole('button', { name: 'Betaを閉じる', exact: true }).click();
    await expect(p.getByRole('tab')).toHaveCount(2);
    const actor = { ...f.actor, projectIds: f.ids };
    const project = await f.runtime.projectApi.projects.read(actor, { projectId: f.id });
    assert.equal(project.drafts.story.content, '# Alpha story');
  } finally {
    await f.close();
  }
});
test('Chromium preserves the origin tab and local draft on failed flush', async () => {
  const f = await browserFixture();
  const p = f.page;
  try {
    await p.getByRole('button', { name: 'Alpha', exact: true }).click();
    await p.getByRole('button', { name: 'ストーリー', exact: true }).click();
    await p.getByLabel('Artifact内容').fill('# unsent');
    await p.route('**/commands/save-draft', (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'REVISION_CONFLICT' } }),
      }),
    );
    await p.getByRole('tab', { name: 'Home', exact: true }).click();
    await expect(p.getByRole('alert')).toContainText('REVISION_CONFLICT');
    await expect(p.getByRole('tab', { name: /^Alpha/ })).toHaveAttribute('aria-selected', 'true');
    await expect(p.getByLabel('Artifact内容')).toHaveValue('# unsent');
    await p.getByRole('button', { name: 'Alphaを閉じる', exact: true }).click();
    await expect(p.getByRole('tab')).toHaveCount(2);
    await p.getByRole('button', { name: '下書きを破棄して閉じる', exact: true }).click();
    await expect(p.getByRole('tab')).toHaveCount(1);
  } finally {
    await f.close();
  }
});
