import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { projectFixture } from './server-project-fixtures.mjs';
import { createServerRuntime } from '../dist-server/server/runtime.js';
import { loadConfig } from '../dist-server/server/config.js';
import { ProjectRegistration } from '../dist-server/server/project-registration.js';
import { token } from './server-fixtures.mjs';
export async function browserFixture(count = 2, definitions, catalog, instrument, agents) {
  const f = await projectFixture();
  await f.repo.close();
  const registration = new ProjectRegistration(f.dir);
  const ids = [f.id];
  for (let i = 1; i < count; i++) {
    const r = await registration.provision(
      f.actor,
      'create-' + i,
      { rootId: 'root', directoryName: i === 1 ? 'Beta' : 'Project' + i },
      'create',
    );
    ids.push(r.id);
  }
  f.actor.projectIds = ids;
  let catalogFile;
  if (catalog) {
    catalogFile = path.join(f.dir, 'catalog.json');
    await writeFile(catalogFile, JSON.stringify(catalog));
  }
  const config = await loadConfig({ dataDir: f.dir, port: 0 });
  const runtime = await createServerRuntime(config, { definitions, catalogFile, agents });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  if (instrument) await page.addInitScript(instrument);
  await page.goto(runtime.origin);
  await page.getByLabel('アクセストークン').fill(token);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor();
  return {
    ...f,
    ids,
    config,
    runtime,
    browser,
    context,
    page,
    close: async () => {
      await browser.close();
      await runtime.close();
      await f.close();
    },
  };
}
