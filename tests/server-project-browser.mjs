import { readFile } from 'node:fs/promises';
import { transformWithOxc } from 'vite';
import { createRequire } from 'node:module';
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

test('Chromium creates a new Project and requires authentication with the newly granted scope', async () => {
  const f = await browserFixture();
  const p = f.page;
  try {
    await p.getByLabel('Project名').fill('Gamma');
    await p.getByRole('button', { name: 'Projectを作成', exact: true }).click();
    await expect(p.getByRole('heading', { name: 'Workspaceにログイン' })).toBeVisible();
    await p
      .getByLabel('アクセストークン')
      .fill('fixture-credential-abcdefghijklmnopqrstuvwxyz123456');
    await p.getByRole('button', { name: 'ログイン', exact: true }).click();
    await expect(p.getByRole('tab', { name: 'Gamma', exact: true })).toBeVisible();
    await expect(p.getByRole('tab')).toHaveCount(2);
  } finally {
    await f.close();
  }
});
test('Chromium reload recovers one last Project and offers a revision-checked unsent draft', async () => {
  const f = await browserFixture();
  const p = f.page;
  try {
    await p.getByRole('button', { name: 'Alpha', exact: true }).click();
    await p.getByRole('button', { name: 'ストーリー', exact: true }).click();
    await p.getByLabel('Artifact内容').fill('# recovered draft');
    await expect
      .poll(async () =>
        p.evaluate(
          () =>
            new Promise((resolve) => {
              const r = indexedDB.open('batch-studio-drafts', 1);
              r.onsuccess = () => {
                const q = r.result.transaction('drafts').objectStore('drafts').getAll();
                q.onsuccess = () => {
                  resolve(q.result.length);
                  r.result.close();
                };
              };
            }),
        ),
      )
      .toBe(1);
    await p.reload();
    await p
      .getByLabel('アクセストークン')
      .fill('fixture-credential-abcdefghijklmnopqrstuvwxyz123456');
    await p.getByRole('button', { name: 'ログイン', exact: true }).click();
    await expect(p.getByRole('tab', { name: 'Alpha', exact: true })).toBeVisible();
    await expect(p.getByRole('tab')).toHaveCount(2);
    await p.getByRole('button', { name: '下書きを復元', exact: true }).click();
    await expect(p.getByLabel('Artifact内容')).toHaveValue('# recovered draft');
  } finally {
    await f.close();
  }
});
test('Chromium closing a Project leaves its server job running and all-jobs can reopen it', async () => {
  let finish;
  const held = new Promise((r) => (finish = r));
  const definitions = new Map([
    [
      'probe',
      {
        validate: () => {},
        run: async () => {
          await held;
          return { state: 'succeeded' };
        },
      },
    ],
  ]);
  const f = await browserFixture(2, definitions);
  const p = f.page;
  try {
    await p.getByRole('button', { name: 'Alpha', exact: true }).click();
    const job = await f.runtime.jobs.submit(
      f.actor,
      f.id,
      'probe',
      'background',
      {},
      { stage: 'story', provider: 'codex', turnId: 'test-turn' },
    );
    await expect(p.getByRole('tab', { name: /Alpha.*処理中/ })).toBeVisible();
    await p.getByRole('button', { name: 'Alphaを閉じる', exact: true }).click();
    assert.notEqual(f.runtime.jobs.get(f.actor, job.id).state, 'cancelled');
    await p.getByRole('button', { name: '全ジョブ', exact: true }).click();
    await expect(p.getByText(/probe — running/)).toBeVisible();
    await p.getByRole('button', { name: 'Projectを開く', exact: true }).click();
    await expect(p.getByRole('tab', { name: /Alpha.*処理中/ })).toBeVisible();
    finish();
    await f.runtime.jobs.drain();
    assert.equal(f.runtime.jobs.get(f.actor, job.id).state, 'succeeded');
  } finally {
    finish();
    await f.close();
  }
});
test('Chromium another authenticated client cannot edit an owned Project lease', async () => {
  const f = await browserFixture();
  const p = f.page;
  let other;
  try {
    await p.getByRole('button', { name: 'Alpha', exact: true }).click();
    other = await f.browser.newContext();
    const q = await other.newPage();
    await q.goto(f.runtime.origin);
    await q
      .getByLabel('アクセストークン')
      .fill('fixture-credential-abcdefghijklmnopqrstuvwxyz123456');
    await q.getByRole('button', { name: 'ログイン', exact: true }).click();
    await q.getByRole('button', { name: 'Alpha', exact: true }).click();
    await expect(q.getByLabel('Artifact内容')).toBeDisabled();
    await expect(q.getByRole('alert')).toContainText('LEASE_REQUIRED');
    await expect(p.getByLabel('Artifact内容')).toBeEnabled();
  } finally {
    await other?.close();
    await f.close();
  }
});

test('Chromium confirms model and PromptPlan artifacts and compiles a registered fixture Workflow', async () => {
  const require = createRequire(import.meta.url);
  const { models, plan } = require('./core-support/artifact-fixtures.cjs').artifacts();
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
  const f = await browserFixture(1, undefined, catalog);
  const p = f.page;
  try {
    await p.getByRole('button', { name: 'Alpha', exact: true }).click();
    for (const [name, content] of [
      ['モデル', models],
      ['Prompt Plan', plan],
    ]) {
      await p.getByRole('button', { name, exact: true }).click();
      await p.getByLabel('Artifact内容').fill(JSON.stringify(content));
      await p.getByRole('button', { name: '確定', exact: true }).click();
      await expect(p.getByText('confirmed', { exact: true })).toBeVisible();
    }
    await p.getByRole('button', { name: 'Workflow', exact: true }).click();
    await p.getByRole('button', { name: 'Workflowを生成', exact: true }).click();
    await expect(p.getByText('confirmed', { exact: true })).toBeVisible();
    const graph = JSON.parse(await p.getByLabel('Artifact内容').inputValue());
    assert.ok(graph.apiSha256);
    assert.ok(graph.template.sha256);
  } finally {
    await f.close();
  }
});

test('Chromium 1/5/10 tabs keep one editor, one WS and renewal timer; close releases UI resources', async () => {
  const instrument = () => {
    const state = (window.__resources = {
      listeners: new Map(),
      timers: new Set(),
      urls: new Set(),
    });
    const add = window.addEventListener.bind(window),
      remove = window.removeEventListener.bind(window);
    window.addEventListener = (type, fn, opts) => {
      state.listeners.set(fn, type);
      add(type, fn, opts);
    };
    window.removeEventListener = (type, fn, opts) => {
      state.listeners.delete(fn);
      remove(type, fn, opts);
    };
    const set = window.setInterval.bind(window),
      clear = window.clearInterval.bind(window);
    window.setInterval = (...args) => {
      const id = set(...args);
      state.timers.add(id);
      return id;
    };
    window.clearInterval = (id) => {
      state.timers.delete(id);
      clear(id);
    };
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      state.urls.add(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      state.urls.delete(url);
      revoke(url);
    };
    const Original = window.WebSocket;
    state.sockets = new Set();
    window.WebSocket = class extends Original {
      constructor(...args) {
        super(...args);
        state.sockets.add(this);
        this.addEventListener('close', () => state.sockets.delete(this));
      }
    };
  };
  const f = await browserFixture(10, undefined, undefined, instrument);
  const p = f.page;
  const cdp = await f.context.newCDPSession(p);
  const baselineListeners = await p.evaluate(() => window.__resources.listeners.size);
  try {
    await cdp.send('Performance.enable');
    const read = async () => {
      await cdp.send('HeapProfiler.collectGarbage');
      const metrics = await cdp.send('Performance.getMetrics');
      return Object.fromEntries(
        metrics.metrics
          .filter((m) => ['JSHeapUsedSize', 'Nodes', 'JSEventListeners'].includes(m.name))
          .map((m) => [m.name, m.value]),
      );
    };
    const measurements = [];
    for (const count of [1, 5, 10]) {
      for (let i = 0; i < count; i++) {
        await p.getByRole('tab', { name: 'Home', exact: true }).click();
        await p
          .getByRole('button', {
            name: i === 0 ? 'Alpha' : i === 1 ? 'Beta' : 'Project' + i,
            exact: true,
          })
          .click();
      }
      const before = Date.now();
      for (let pass = 0; pass < 3; pass++)
        for (let i = 0; i < count; i++) {
          await p
            .getByRole('tab', {
              name: new RegExp('^' + (i === 0 ? 'Alpha' : i === 1 ? 'Beta' : 'Project' + i)),
            })
            .click();
          await expect(p.getByLabel('Artifact内容')).toHaveCount(1);
        }
      measurements.push({
        tabs: count,
        meanSwitchMs: (Date.now() - before) / (3 * count),
        ...(await read()),
      });
      await p.getByRole('button', { name: 'ツール', exact: true }).click();
      await p.keyboard.press('Escape');
      assert.equal(await p.evaluate(() => window.__resources.listeners.size), baselineListeners);
      assert.equal(await p.evaluate(() => window.__resources.urls.size), 0);
      assert.equal(await p.evaluate(() => window.__resources.timers.size), 1);
      assert.equal(await p.evaluate(() => window.__resources.sockets.size), 1);
    }
    for (let i = 9; i >= 0; i--)
      await p
        .getByRole('button', {
          name: (i === 0 ? 'Alpha' : i === 1 ? 'Beta' : 'Project' + i) + 'を閉じる',
          exact: true,
        })
        .click();
    await expect(p.getByRole('tab')).toHaveCount(1);
    await expect(p.getByLabel('Artifact内容')).toHaveCount(0);
    await p.getByRole('button', { name: 'ログアウト', exact: true }).click();
    await expect(p.getByRole('heading', { name: 'Workspaceにログイン' })).toBeVisible();
    assert.equal(await p.evaluate(() => window.__resources.timers.size), 0);
    await expect.poll(() => p.evaluate(() => window.__resources.sockets.size)).toBe(0);
    assert.equal(await p.evaluate(() => window.__resources.listeners.size), baselineListeners);
    console.log(
      'P3 tab measurement ' +
        process.platform +
        ' ' +
        JSON.stringify(measurements) +
        ' closed ' +
        JSON.stringify(await read()),
    );
  } finally {
    await f.close();
  }
});

test('Chromium actual draft store enforces quota, expiry, user scope and serialized discard', async () => {
  const f = await browserFixture(1);
  try {
    const source = await readFile(new URL('../src/web/drafts.ts', import.meta.url), 'utf8');
    const code = (
      await transformWithOxc(source.replace('export class Drafts', 'class Drafts'), 'drafts.ts')
    ).code.replace(/export /g, '');
    const result = await f.page.evaluate(async (code) => {
      const Drafts = new Function(code + '; return Drafts;')();
      const drafts = new Drafts();
      const base = {
        userId: 'test-user',
        projectId: 'A',
        key: 'story',
        baseRevision: 0,
        content: 'draft',
      };
      await Promise.all([drafts.put(base), drafts.remove('test-user', 'A', 'story')]);
      const discarded = (await drafts.all()).length;
      let quota = '';
      try {
        await drafts.put({ ...base, content: 'x'.repeat(20 * 1024 * 1024) });
      } catch (error) {
        quota = error.message;
      }
      await drafts.put(base);
      await drafts.put({ ...base, userId: 'other-user' });
      const now = Date.now;
      Date.now = () => now() + 8 * 86400000;
      await drafts.purge('test-user', ['A']);
      Date.now = now;
      const remaining = await drafts.all();
      return { discarded, quota, users: remaining.map((r) => r.userId) };
    }, code);
    assert.deepEqual(result, { discarded: 0, quota: 'DRAFT_STORAGE_LIMIT', users: ['other-user'] });
  } finally {
    await f.close();
  }
});

test('Chromium actual Workspace ignores late responses for replaced generations and closed-tab events', async () => {
  const f = await browserFixture(1);
  try {
    const source = await readFile(new URL('../src/web/workspace.ts', import.meta.url), 'utf8');
    const stripped = source
      .replace(/^import.*;$/gm, '')
      .replace('export class Workspace', 'class Workspace')
      .replace('export const workspace = new Workspace();', '');
    const code = (await transformWithOxc(stripped, 'workspace.ts')).code.replace(/export /g, '');
    const result = await f.page.evaluate(async (code) => {
      let finish;
      const response = new Promise((r) => (finish = r));
      const Api = { request: () => response };
      const Workspace = new Function('api', 'Drafts', code + '; return Workspace;')(Api, class {});
      const w = new Workspace();
      const old = { id: 'A', generation: 'old', project: { revision: 1, lease: null }, dirty: {} };
      w.tabs = [old];
      const pending = w.action('A', 'save-draft', { key: 'story', content: 'old' });
      await Promise.resolve();
      await Promise.resolve();
      const current = { ...old, generation: 'new', project: { revision: 2, lease: null } };
      w.tabs = [current];
      finish({ project: { revision: 9 } });
      await pending;
      const revision = current.project.revision;
      w.tabs = [];
      w.packet({ type: 'project.changed', projectId: 'A', revision: 10 });
      return { revision, tabs: w.tabs.length };
    }, code);
    assert.deepEqual(result, { revision: 2, tabs: 0 });
  } finally {
    await f.close();
  }
});

test('Chromium session revocation hides the open modal and build mismatch blocks login', async () => {
  const f = await browserFixture(1);
  const p = f.page;
  try {
    await p.getByRole('button', { name: 'ツール', exact: true }).click();
    await expect(p.getByRole('dialog')).toBeVisible();
    const { writeFile } = await import('node:fs/promises');
    const { default: path } = await import('node:path');
    const authFile = path.join(f.dir, 'auth.json');
    const auth = JSON.parse(await readFile(authFile, 'utf8'));
    auth.principals[0].permissions = ['read'];
    await writeFile(authFile, JSON.stringify(auth), { mode: 0o600 });
    await expect(p.getByRole('heading', { name: 'Workspaceにログイン' })).toBeVisible();
    await expect(p.getByRole('dialog')).toHaveCount(0);
    await p.route('**/api/v1/health', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ apiVersion: '1', webBuildId: 'wrong', buildId: 'wrong' }),
      }),
    );
    await p
      .getByLabel('アクセストークン')
      .fill('fixture-credential-abcdefghijklmnopqrstuvwxyz123456');
    await p.getByRole('button', { name: 'ログイン', exact: true }).click();
    await expect(p.getByRole('alert')).toContainText('BUILD_MISMATCH');
    await expect(p.getByRole('tab')).toHaveCount(0);
  } finally {
    await f.close();
  }
});

test('Chromium actual modal context rejects stale generation, target, revision and lost lease', async () => {
  const f = await browserFixture(1);
  try {
    const source = await readFile(new URL('../src/web/modal.tsx', import.meta.url), 'utf8');
    const part = source
      .slice(
        source.indexOf('export function assertModalContext'),
        source.indexOf('export function Dialog'),
      )
      .replace('export function', 'function');
    const code = (await transformWithOxc(part, 'modal-context.ts')).code;
    const result = await f.page.evaluate((code) => {
      const assertContext = new Function(code + ';return assertModalContext;')();
      const context = {
        projectId: 'A',
        generation: 'one',
        key: 'models',
        revision: 2,
        leaseId: 'lease',
      };
      const tab = {
        id: 'A',
        generation: 'one',
        key: 'models',
        project: { revision: 2, lease: { leaseId: 'lease', ownedByCurrentSession: true } },
      };
      assertContext({ tabs: [tab] }, context);
      return [
        { ...context, generation: 'old' },
        { ...context, key: 'story' },
        { ...context, revision: 1 },
        { ...context, leaseId: 'old' },
      ]
        .map((c) => {
          try {
            assertContext({ tabs: [tab] }, c);
            return 'accepted';
          } catch (e) {
            return e.message;
          }
        })
        .concat(
          (() => {
            tab.project.lease.ownedByCurrentSession = false;
            try {
              assertContext({ tabs: [tab] }, context);
              return 'accepted';
            } catch (e) {
              return e.message;
            }
          })(),
        );
    }, code);
    assert.deepEqual(result, Array(5).fill('MODAL_CONTEXT_CHANGED'));
  } finally {
    await f.close();
  }
});

test('Chromium lease loss stops editing and keeps the unsent draft on the origin tab', async () => {
  const f = await browserFixture(1);
  const p = f.page;
  try {
    await p.getByRole('button', { name: 'Alpha', exact: true }).click();
    await p.getByRole('button', { name: 'ストーリー', exact: true }).click();
    await p.getByLabel('Artifact内容').fill('# preserved after lease loss');
    await p.route('**/commands/save-draft', (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'LEASE_REQUIRED' } }),
      }),
    );
    await p.getByRole('tab', { name: 'Home', exact: true }).click();
    await expect(p.getByRole('alert')).toContainText('LEASE_REQUIRED');
    await expect(p.getByLabel('Artifact内容')).toBeDisabled();
    await expect(p.getByLabel('Artifact内容')).toHaveValue('# preserved after lease loss');
    await expect(p.getByRole('tab', { name: /^Alpha/ })).toHaveAttribute('aria-selected', 'true');
  } finally {
    await f.close();
  }
});
