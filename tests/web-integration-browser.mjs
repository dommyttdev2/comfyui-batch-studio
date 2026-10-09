import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { expect } from '@playwright/test';
import { browserFixture } from './server-project-browser-fixtures.mjs';

const reply = (route, body) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
async function open(f, tool, project = true) {
  if (project) {
    await f.page.getByRole('button', { name: 'Alpha', exact: true }).click();
    await expect(f.page.getByRole('tab', { name: /^Alpha/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  }
  await f.page.getByRole('button', { name: 'ツール', exact: true }).click();
  const d = f.page.getByRole('dialog');
  await d.getByLabel('ツール種類').selectOption(tool);
  return d;
}
test('Chromium R2 confirmation displays server facts, cancellation has no effect and explicit confirmation sends once', async () => {
  const f = await browserFixture();
  let calls = 0;
  const p = f.page;
  try {
    await p.route('**/integrations/r2/status', (r) =>
      reply(r, { state: 'ready', canManage: true }),
    );
    await p.route('**/integrations/r2/list?**', (r) =>
      reply(r, { objects: [{ key: 'models/test.bin', size: 12 }], nextToken: null }),
    );
    await p.route('**/integrations/r2/targets', (r) => reply(r, { targetId: 'fixed-target' }));
    await p.route('**/integrations/operations/prepare', (r) =>
      reply(r, {
        confirmationId: 'one-confirmation',
        expiresAt: Date.now() + 60000,
        summary: { bucket: 'server-observed', key: 'models/test.bin', size: 12 },
      }),
    );
    await p.route('**/integrations/operations/confirm', (r) => {
      calls++;
      assert.equal(r.request().postDataJSON().confirmationId, 'one-confirmation');
      return reply(r, { id: 'receipt-one', state: 'succeeded' });
    });
    const d = await open(f, 'R2 Browser');
    await d.getByLabel('Bucket', { exact: true }).fill('bucket-one');
    await d.getByRole('button', { name: 'Object一覧', exact: true }).click();
    await d.getByLabel('Object', { exact: true }).selectOption('models/test.bin');
    await d.getByRole('button', { name: '削除を確認', exact: true }).click();
    const c = p.getByRole('alertdialog');
    await expect(c).toContainText('server-observed');
    assert.equal(calls, 0);
    await c.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(calls, 0);
    await d.getByRole('button', { name: '削除を確認', exact: true }).click();
    await c.getByRole('button', { name: '確認して実行', exact: true }).click();
    await expect(c).toHaveCount(0);
    assert.equal(calls, 1);
    await expect(d).toContainText('receipt-one');
  } finally {
    await f.close();
  }
});
test('Chromium ignores a closed tool response and invalidates object selection when bucket changes', async () => {
  const f = await browserFixture();
  const p = f.page;
  let release;
  let entered;
  const started = new Promise((r) => (entered = r));
  const barrier = new Promise((r) => (release = r));
  try {
    await p.route('**/integrations/r2/status', (r) =>
      reply(r, { state: 'ready', canManage: true }),
    );
    await p.route('**/integrations/r2/list?**', async (r) => {
      entered();
      await barrier;
      await reply(r, { objects: [{ key: 'old-only.bin', size: 1 }], nextToken: 'old-cursor' });
    });
    const d = await open(f, 'R2 Browser');
    await d.getByLabel('Bucket', { exact: true }).fill('bucket-one');
    await d.getByRole('button', { name: 'Object一覧', exact: true }).click();
    await started;
    await p.keyboard.press('Escape');
    release();
    await p.getByRole('button', { name: 'ツール', exact: true }).click();
    await expect(d.getByLabel('Object', { exact: true }).locator('option')).toHaveCount(1);
    await p.unroute('**/integrations/r2/list?**');
    await p.route('**/integrations/r2/list?**', (r) =>
      reply(r, { objects: [{ key: 'new.bin', size: 2 }], nextToken: 'next' }),
    );
    await d.getByRole('button', { name: 'Object一覧', exact: true }).click();
    await d.getByLabel('Object', { exact: true }).selectOption('new.bin');
    await d.getByLabel('Bucket', { exact: true }).fill('bucket-two');
    await expect(d.getByLabel('Object', { exact: true })).toHaveValue('');
    await expect(d.getByRole('button', { name: '次ページ', exact: true })).toBeDisabled();
  } finally {
    release?.();
    await f.close();
  }
});
test('Chromium stages a real binary file in bounded hashed chunks and completes the server resource', async () => {
  const f = await browserFixture();
  const p = f.page;
  const bytes = Buffer.alloc(8 * 1024 * 1024 + 19, 73);
  const chunks = [];
  try {
    await p.route('**/resources/staging/*', async (route) => {
      if (route.request().method() === 'PUT') chunks.push(route.request().postDataBuffer().length);
      await route.continue();
    });
    const d = await open(f, 'R2 Browser');
    await d
      .getByLabel('Browser file')
      .setInputFiles({ name: 'bounded.bin', mimeType: 'application/octet-stream', buffer: bytes });
    await d.getByRole('button', { name: 'Browser fileをstagingへ送る', exact: true }).click();
    await expect(d.locator('.tool-result')).toContainText('complete', { timeout: 20000 });
    await expect(d.locator('.tool-result')).toContainText(
      createHash('sha256').update(bytes).digest('hex'),
    );
    assert.deepEqual(chunks, [8 * 1024 * 1024, 19]);
    await d.getByRole('button', { name: 'stagingを削除', exact: true }).click();
    await expect(d.getByLabel('再開するstaging ID')).toHaveValue('');
  } finally {
    await f.close();
  }
});
test('Chromium configures current Project resources with a real lease and preserves saved bindings on reopening', async () => {
  const f = await browserFixture();
  const p = f.page;
  try {
    let d = await open(f, '環境設定');
    await d.getByLabel('実行先', { exact: true }).selectOption('remote');
    await d.getByLabel('Remote Instance', { exact: true }).fill('345');
    await d.getByRole('button', { name: 'Project環境を保存', exact: true }).click();
    await expect(d.locator('.tool-result')).toContainText('Projectへ保存しました');
    await p.keyboard.press('Escape');
    await p.getByRole('button', { name: 'ツール', exact: true }).click();
    d = p.getByRole('dialog');
    await expect(d.getByLabel('実行先', { exact: true })).toHaveValue('remote');
    await d.getByRole('button', { name: 'Project環境を保存', exact: true }).click();
    await expect(d.locator('.tool-result')).toContainText('Projectへ保存しました');
    const project = await f.runtime.projectApi.projects.read(
      { ...f.actor, projectIds: f.ids },
      { projectId: f.id },
    );
    assert.equal(project.resourceBindings.executionTarget, 'remote');
    assert.equal(project.resourceBindings.remoteInstanceId, 345);
  } finally {
    await f.close();
  }
});
test('Chromium Secret registration clears password fields and environment source exposes no editable Secret controls', async () => {
  const f = await browserFixture();
  const p = f.page;
  let submitted;
  try {
    await p.route('**/integrations/settings', (r) =>
      reply(r, {
        configured: true,
        revision: 1,
        canManage: true,
        canRegisterSecrets: true,
        providers: [{ provider: 'civitai', state: 'ready', revision: 1 }],
      }),
    );
    await p.route('**/integrations/settings', (r) => {
      if (r.request().method() === 'GET')
        return reply(r, {
          configured: true,
          revision: 1,
          canManage: true,
          canRegisterSecrets: true,
          providers: [{ provider: 'civitai', state: 'ready', revision: 1 }],
        });
      submitted = r.request().postDataJSON();
      return reply(r, {
        configured: true,
        revision: 2,
        canManage: true,
        canRegisterSecrets: true,
        providers: [],
      });
    });
    const d = await open(f, 'サービス連携', false);
    const passwords = d.locator('input[type=password]');
    await expect(passwords).toHaveCount(1);
    await passwords.fill('fixture-only-secret-value');
    await d.getByRole('button', { name: '設定を保存', exact: true }).click();
    await expect(d.locator('.tool-result')).toContainText('設定を保存しました');
    await expect(passwords).toHaveValue('');
    assert.equal(submitted.settings.secrets.apiKey, 'fixture-only-secret-value');
    await expect(d).not.toContainText('fixture-only-secret-value');
    await p.keyboard.press('Escape');
    await p.unroute('**/integrations/settings');
    await p.route('**/integrations/settings', (r) =>
      reply(r, {
        configured: true,
        revision: 2,
        canManage: true,
        canRegisterSecrets: false,
        providers: [],
      }),
    );
    await p.getByRole('button', { name: 'ツール', exact: true }).click();
    await expect(p.getByRole('dialog').locator('input[type=password]')).toHaveCount(0);
  } finally {
    await f.close();
  }
});

import { createRequire } from 'node:module';

test('Chromium Civitai selection invokes current catalog validation and P1 LoRA import against the origin Project', async () => {
  const { models } = createRequire(import.meta.url)(
    './core-support/artifact-fixtures.cjs',
  ).artifacts();
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
  const f = await browserFixture(2, undefined, catalog);
  const p = f.page;
  try {
    await p.route('**/integrations/civitai/status', (r) =>
      reply(r, { state: 'ready', canManage: true }),
    );
    await p.route('**/integrations/civitai/search?**', (r) =>
      reply(r, {
        generation: 1,
        items: selections.map((s) => ({ ...s, files: [{ id: s.fileId, name: s.fileName }] })),
      }),
    );
    const d = await open(f, 'Civitai Explorer');
    await d.getByRole('button', { name: '検索する', exact: true }).click();
    await d.getByLabel('モデル候補').selectOption('0');
    await d
      .locator('select')
      .filter({ has: p.locator('option[value="' + models.checkpoint.fileId + '"]') })
      .selectOption(String(models.checkpoint.fileId));
    await d.getByLabel('用途').selectOption('select');
    await d.getByRole('button', { name: 'Projectへ選択を確定', exact: true }).click();
    await expect(d.locator('.tool-result')).toContainText('Projectへ保存しました');
    await d.getByLabel('モデル候補').selectOption('1');
    await d
      .locator('select')
      .filter({ has: p.locator('option[value="' + models.loras[0].fileId + '"]') })
      .selectOption(String(models.loras[0].fileId));
    await d.getByLabel('LoRA ref').fill(models.loras[0].ref);
    const [importResponse] = await Promise.all([
      p.waitForResponse((r) => r.url().endsWith('/commands/import-loras')),
      d.getByRole('button', { name: 'LoRAを下書きへ追加・更新', exact: true }).click(),
    ]);
    assert.equal(importResponse.ok(), true, JSON.stringify(await importResponse.json()));
    await expect(d.locator('.tool-result')).toContainText('Projectへ保存しました');
    const project = await f.runtime.projectApi.projects.read(
      { ...f.actor, projectIds: f.ids },
      { projectId: f.id },
    );
    const saved = JSON.parse(project.drafts.models.content);
    assert.equal(saved.checkpoint.fileId, models.checkpoint.fileId);
    assert.equal(saved.loras[0].fileId, models.loras[0].fileId);
    assert.equal(project.drafts.models.status, 'draft');
  } finally {
    await f.close();
  }
});

import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { transformWithOxc } from 'vite';

test('streaming browser SHA-256 matches Node for padding boundaries and irregular chunk splits', async () => {
  const source = await readFile(new URL('../src/web/file-sha256.ts', import.meta.url), 'utf8');
  const { code } = await transformWithOxc(source, 'file-sha256.ts');
  const { Sha256 } = await import(
    'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
  );
  for (const size of [0, 1, 55, 56, 63, 64, 65, 127, 128, 1024 * 1024 + 17]) {
    const bytes = randomBytes(size),
      hash = new Sha256();
    for (let offset = 0; offset < size; offset += 37)
      hash.update(bytes.subarray(offset, offset + 37));
    assert.equal(hash.digest(), createHash('sha256').update(bytes).digest('hex'));
    assert.throws(() => hash.digest(), /HASH_FINISHED/);
  }
});
test('Chromium resumes staging from the committed offset and rejects changed bytes of the same name and size', async () => {
  const f = await browserFixture();
  const p = f.page;
  const bytes = randomBytes(8 * 1024 * 1024 + 99);
  let release, entered;
  const started = new Promise((r) => (entered = r)),
    barrier = new Promise((r) => (release = r));
  let first = true;
  try {
    await p.route('**/resources/staging/*', async (route) => {
      if (route.request().method() === 'PUT' && first) {
        first = false;
        const response = await route.fetch();
        entered();
        await barrier;
        await route.fulfill({ response });
      } else await route.continue();
    });
    let d = await open(f, 'R2 Browser');
    await d
      .getByLabel('Browser file')
      .setInputFiles({ name: 'resume.bin', mimeType: 'application/octet-stream', buffer: bytes });
    await d.getByRole('button', { name: 'Browser fileをstagingへ送る', exact: true }).click();
    await started;
    await d.getByRole('button', { name: 'staging送信を一時停止', exact: true }).click();
    release();
    await expect(d.locator('.tool-result')).toContainText('一時停止');
    const id = await d.getByLabel('再開するstaging ID').inputValue();
    assert.ok(id);
    await p.keyboard.press('Escape');
    await p.getByRole('button', { name: 'ツール', exact: true }).click();
    d = p.getByRole('dialog');
    await d.getByRole('button', { name: 'stagingを開く', exact: true }).click();
    await expect(d.locator('.tool-result')).toContainText('8388608');
    const changed = Buffer.from(bytes);
    changed[0] ^= 255;
    await d
      .getByLabel('Browser file')
      .setInputFiles({ name: 'resume.bin', mimeType: 'application/octet-stream', buffer: changed });
    await d.getByRole('button', { name: 'Browser fileをstagingへ送る', exact: true }).click();
    await expect(d.getByRole('alert')).toContainText('SOURCE_CHANGED');
    await d
      .getByLabel('Browser file')
      .setInputFiles({ name: 'resume.bin', mimeType: 'application/octet-stream', buffer: bytes });
    await d.getByRole('button', { name: 'Browser fileをstagingへ送る', exact: true }).click();
    await expect(d.locator('.tool-result')).toContainText('complete', { timeout: 20000 });
    await expect(d.locator('.tool-result')).toContainText(
      createHash('sha256').update(bytes).digest('hex'),
    );
  } finally {
    release?.();
    await f.close();
  }
});

test('Chromium keeps R2 list and search pagination separate and exposes template download and conditional PUT operations', async () => {
  const f = await browserFixture();
  const p = f.page;
  const seen = [];
  try {
    await p.route('**/integrations/r2/status', (r) =>
      reply(r, { state: 'ready', canManage: true }),
    );
    await p.route('**/integrations/r2/list?**', (r) => {
      const u = new URL(r.request().url());
      seen.push(['list', u.searchParams.get('token')]);
      return reply(r, {
        objects: [{ key: 'page.bin', size: 1 }],
        nextToken: u.searchParams.has('token') ? null : 's3-next',
      });
    });
    await p.route('**/integrations/r2/search?**', (r) => {
      const u = new URL(r.request().url());
      seen.push(['search', u.searchParams.get('token')]);
      return reply(r, {
        objects: [{ key: 'search.bin', size: 2 }],
        nextToken: u.searchParams.has('token') ? null : 'local:1',
      });
    });
    await p.route('**/integrations/r2/templates?**', (r) =>
      reply(r, {
        revision: 1,
        templates: [
          {
            id: 'template-one',
            name: 'My models',
            objects: [{ key: 'search.bin', name: 'search.bin', size: 2 }],
          },
        ],
      }),
    );
    await p.route('**/integrations/r2/batch-download-info', (r) => {
      assert.equal(r.request().postDataJSON().objects[0].key, 'search.bin');
      return reply(r, {
        objects: [{ name: 'search.bin', url: 'https://r2.invalid/signed-download' }],
        expiresAt: Date.now() + 300000,
      });
    });
    await p.route('**/integrations/r2/put-url-info', (r) => {
      assert.equal(r.request().postDataJSON().key, 'new.bin');
      return reply(r, {
        url: 'https://r2.invalid/conditional-put',
        expiresAt: Date.now() + 300000,
      });
    });
    const d = await open(f, 'R2 Browser');
    await d.getByLabel('Bucket', { exact: true }).fill('bucket-one');
    await d.getByRole('button', { name: 'Object一覧', exact: true }).click();
    await expect(d.getByRole('button', { name: '次ページ', exact: true })).toBeEnabled();
    await d.getByRole('button', { name: '次ページ', exact: true }).click();
    await expect(d.getByRole('button', { name: '次ページ', exact: true })).toBeDisabled();
    await d.getByLabel('Object検索', { exact: true }).fill('search');
    await d.getByRole('button', { name: 'Indexを検索', exact: true }).click();
    await expect(d.getByRole('button', { name: '次ページ', exact: true })).toBeEnabled();
    await d.getByRole('button', { name: '次ページ', exact: true }).click();
    await expect(d.getByRole('button', { name: '次ページ', exact: true })).toBeDisabled();
    assert.deepEqual(seen, [
      ['list', null],
      ['list', 's3-next'],
      ['search', null],
      ['search', 'local:1'],
    ]);
    await d.getByRole('button', { name: 'Template一覧', exact: true }).click();
    await d.getByLabel('Download template', { exact: true }).selectOption('template-one');
    await d.getByRole('button', { name: 'Templateの取得リンクを発行', exact: true }).click();
    await expect(d.getByRole('link', { name: 'search.binを取得', exact: true })).toHaveAttribute(
      'href',
      'https://r2.invalid/signed-download',
    );
    await d.getByLabel('PUT先Object key', { exact: true }).fill('new.bin');
    await d.getByRole('button', { name: '条件付きPUT URLを発行', exact: true }).click();
    await expect(d.locator('.tool-result')).toContainText('https://r2.invalid/conditional-put');
  } finally {
    await f.close();
  }
});
