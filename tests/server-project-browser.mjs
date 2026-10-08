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

test('Chromium Modal Host traps focus, preserves tool conditions and closes only the top dialog', async () => {
  const f = await browserFixture();
  const p = f.page;
  try {
    await p.getByRole('button', { name: 'Alpha', exact: true }).click();
    await p.getByRole('button', { name: 'ツール', exact: true }).click();
    const dialog = p.getByRole('dialog');
    await expect(dialog).toBeVisible();
    assert.equal(await p.locator('#root').evaluate((e) => e.inert), true);
    await dialog.getByLabel('検索', { exact: true }).fill('retained search');
    await p.keyboard.press('Shift+Tab');
    assert.equal(await dialog.evaluate((e) => e.contains(document.activeElement)), true);
    await dialog.getByRole('button', { name: '表示状態をリセット', exact: true }).click();
    await expect(p.getByRole('alertdialog')).toBeVisible();
    await p.keyboard.press('Escape');
    await expect(p.getByRole('alertdialog')).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await p.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    assert.equal(await p.locator('#root').evaluate((e) => e.inert), false);
    await expect(p.getByRole('button', { name: 'ツール', exact: true })).toBeFocused();
    await p.getByRole('button', { name: 'ツール', exact: true }).click();
    await expect(dialog.getByLabel('検索', { exact: true })).toHaveValue('retained search');
    await dialog.getByLabel('ツール種類').selectOption('R2 Browser');
    await dialog.getByLabel('Bucket').fill('bucket-one');
    await dialog.getByLabel('パス').fill('models/');
    await dialog.getByLabel('用途').selectOption('select');
    await expect(dialog).toContainText('対象: Alpha');
    await expect(dialog.getByRole('button', { name: /Projectへ選択を確定/ })).toBeDisabled();
    await p.setViewportSize({ width: 390, height: 844 });
    assert.ok(await dialog.evaluate((e) => e.getBoundingClientRect().width <= window.innerWidth));
  } finally {
    await f.close();
  }
});
test('Chromium reset uses the shared modal and commits the confirmed target', async () => {
  const f = await browserFixture();
  const p = f.page;
  try {
    await p.getByRole('button', { name: 'Alpha', exact: true }).click();
    await p.getByRole('button', { name: 'ストーリー', exact: true }).click();
    await p.getByLabel('Artifact内容').fill('# Story to reset');
    await p.getByRole('button', { name: '確定', exact: true }).click();
    await expect(p.getByText('confirmed', { exact: true })).toBeVisible();
    await p.getByRole('button', { name: 'Reset', exact: true }).click();
    const dialog = p.getByRole('dialog', { name: 'Artifact Reset確認' });
    await expect(dialog).toBeVisible();
    assert.equal(await p.locator('#root').evaluate((e) => e.inert), true);
    await dialog.getByRole('button', { name: 'Resetを実行', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(p.getByLabel('Artifact内容')).toHaveValue('');
  } finally {
    await f.close();
  }
});
