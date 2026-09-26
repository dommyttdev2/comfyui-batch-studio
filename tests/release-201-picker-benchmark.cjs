const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain } = require('electron');

const repo = process.cwd();
const label = process.env.BATCH_STUDIO_RELEASE_201_LABEL ?? 'after';
const counts = (process.env.BATCH_STUDIO_RELEASE_201_COUNTS ?? '100,500,2000')
  .split(',')
  .map((value) => Number(value))
  .filter((value) => Number.isSafeInteger(value) && value > 0);
const sampleCount = Number(process.env.BATCH_STUDIO_RELEASE_201_SAMPLES ?? 5);
const benchmarkChannel = 'release-201-benchmark-event';

app.disableHardwareAcceleration();

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function distribution(values) {
  return {
    p50: Math.round(percentile(values, 0.5) * 100) / 100,
    p95: Math.round(percentile(values, 0.95) * 100) / 100,
  };
}

function dataUrlBytes(dataUrl) {
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}

function sourceTransferBytes(source) {
  return Buffer.byteLength(JSON.stringify(source), 'utf8');
}

async function browserFixtureDataUrls() {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, backgroundThrottling: false },
  });
  try {
    await window.loadURL('about:blank');
    return await window.webContents.executeJavaScript(`(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 90;
      const context = canvas.getContext('2d');
      context.fillStyle = '#345';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#def';
      context.fillRect(20, 20, 120, 50);
      return {
        png: canvas.toDataURL('image/png'),
        jpg: canvas.toDataURL('image/jpeg', 0.92),
        webp: canvas.toDataURL('image/webp', 0.92),
      };
    })()`);
  } finally {
    window.destroy();
  }
}

function fixtureName(index) {
  const extension = ['png', 'jpg', 'webp'][index % 3];
  return `image-${String(index).padStart(4, '0')}.${extension}`;
}

async function writeFixtureProject(root, count, dataUrls) {
  const finalDirectory = path.join(root, 'final');
  const artifactDirectory = path.join(root, 'artifacts');
  await fs.mkdir(finalDirectory, { recursive: true });
  const bytes = {
    png: dataUrlBytes(dataUrls.png),
    jpg: dataUrlBytes(dataUrls.jpg),
    webp: dataUrlBytes(dataUrls.webp),
  };
  const items = [];
  for (let index = 0; index < count; index++) {
    const name = fixtureName(index);
    const extension = path.extname(name).slice(1);
    const file = path.join(finalDirectory, name);
    await fs.writeFile(file, bytes[extension]);
    items.push({ path: file, name });
  }
  await fs.writeFile(
    path.join(root, 'project_meta.json'),
    JSON.stringify({
      schemaVersion: 1,
      createdAt: '2026-09-26T00:00:00.000Z',
      settings: {
        finalArtifactDirectory: finalDirectory,
        artifactOutputPath: artifactDirectory,
      },
    }),
  );
  return items;
}

async function benchmarkService(count, dataUrls, modules) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `release-201-service-${count}-`));
  const userData = path.join(root, 'user-data');
  try {
    const fixtureItems = await writeFixtureProject(root, count, dataUrls);
    const listStarted = performance.now();
    const listed = await modules.finalArtifact.listFinalArtifactImages(root);
    const listMs = performance.now() - listStarted;
    assert.equal(listed.length, count);

    const sampleItems = fixtureItems.slice(0, Math.min(18, fixtureItems.length));
    const initialMs = [];
    const redisplayMs = [];
    let initialTransferBytes = 0;
    let redisplayTransferBytes = 0;
    const rssBefore = process.memoryUsage().rss;

    for (const item of sampleItems) {
      const timing = {};
      const started = performance.now();
      const source = await modules.marketplace.readMarketplaceSourcePreview(
        root,
        item.path,
        'final-artifact',
        userData,
        timing,
      );
      initialMs.push(performance.now() - started);
      assert.ok(source, `Preview must load: ${item.name}`);
      initialTransferBytes += sourceTransferBytes(source);
      if (item.name.endsWith('.webp') && source.dataUrl.startsWith('data:image/webp;')) {
        await modules.cache
          .storeWebpThumbnailPreview(userData, item.path, dataUrls.png)
          .catch(() => undefined);
      }
    }

    for (const item of sampleItems) {
      const timing = {};
      const started = performance.now();
      const source = await modules.marketplace.readMarketplaceSourcePreview(
        root,
        item.path,
        'final-artifact',
        userData,
        timing,
      );
      redisplayMs.push(performance.now() - started);
      assert.ok(source, `Redisplay preview must load: ${item.name}`);
      redisplayTransferBytes += sourceTransferBytes(source);
    }

    const rssAfter = process.memoryUsage().rss;
    return {
      listMs: Math.round(listMs * 100) / 100,
      initial: distribution(initialMs),
      redisplay: distribution(redisplayMs),
      initialTransferKB: Math.round((initialTransferBytes / 1024) * 100) / 100,
      redisplayTransferKB: Math.round((redisplayTransferBytes / 1024) * 100) / 100,
      rssDeltaMB: Math.round(((rssAfter - rssBefore) / (1024 * 1024)) * 100) / 100,
    };
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function preloadSource(items, dataUrls) {
  const serializedItems = JSON.stringify(items);
  const serializedDataUrls = JSON.stringify(dataUrls);
  return `const { contextBridge, ipcRenderer } = require('electron');
const items = ${serializedItems};
const dataUrls = ${serializedDataUrls};
const send = (kind, value = {}) =>
  ipcRenderer.send(${JSON.stringify(benchmarkChannel)}, { kind, ...value });
const sourceFor = (item) => {
  const extension = item.name.split('.').pop();
  const key = extension === 'jpeg' ? 'jpg' : extension;
  return {
    path: item.path,
    name: item.name,
    width: 160,
    height: 90,
    dataUrl: dataUrls[key],
  };
};
contextBridge.exposeInMainWorld('batchStudio', {
  thumbnail: {
    pickerContext: async () => ({
      sessionId: 'release-201',
      root: '/release-201',
      slot: 'image-1',
      currentImagePath: '',
    }),
    listImages: async () => {
      send('transfer', { bytes: Buffer.byteLength(JSON.stringify(items), 'utf8') });
      return items;
    },
    readPreview: async (imagePath) => {
      const item = items.find((candidate) => candidate.path === imagePath);
      if (!item) return null;
      const source = sourceFor(item);
      send('transfer', { bytes: Buffer.byteLength(JSON.stringify(source), 'utf8') });
      return source;
    },
    storeWebpPreview: async () => undefined,
    previewPicker: async (imagePath) => {
      send('preview', { imagePath });
    },
    commitPicker: async (imagePath) => {
      send('commit', { imagePath });
    },
    logPickerPerf: async (event, metrics) => {
      send('metric', { event, metrics });
    },
    openPickerPerfLog: async () => undefined,
  },
});`;
}

async function doubleAnimationFrame(window) {
  await window.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
}

async function measureInteraction(window, script) {
  return window.webContents.executeJavaScript(`(async () => {
    const started = performance.now();
    ${script}
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      ms: performance.now() - started,
      mounted: document.querySelectorAll('.thumbnail-image-choice').length,
    };
  })()`);
}

async function runPickerWindow(count, dataUrls, interact) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), `release-201-ui-${count}-`));
  const items = Array.from({ length: count }, (_, index) => {
    const name = fixtureName(index);
    return { path: `/release-201/${name}`, name };
  });
  const preload = path.join(temporary, 'preload.cjs');
  await fs.writeFile(preload, preloadSource(items, dataUrls));
  const events = [];
  let listener;
  const window = new BrowserWindow({
    show: true,
    width: 1200,
    height: 900,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  try {
    listener = (event, value) => {
      if (event.sender.id === window.webContents.id) events.push(value);
    };
    ipcMain.on(benchmarkChannel, listener);
    const openedAt = performance.now();
    const rendererUrl = `${
      pathToFileURL(path.join(repo, 'dist-renderer', 'index.html')).href
    }?tool=thumbnail-picker`;
    await window.loadURL(rendererUrl);

    const deadline = Date.now() + 10_000;
    while (
      !events.some((event) => event.kind === 'metric' && event.event === 'first_image_painted')
    ) {
      if (Date.now() > deadline)
        throw new Error(`Picker first paint timed out for ${count} items.`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await doubleAnimationFrame(window);
    const initialMs = performance.now() - openedAt;
    const initialMounted = await window.webContents.executeJavaScript(
      "document.querySelectorAll('.thumbnail-image-choice').length",
    );
    const initialMemory = await window.webContents.getProcessMemoryInfo();

    const result = {
      initialMs,
      mounted: initialMounted,
      transferBytes: events
        .filter((event) => event.kind === 'transfer')
        .reduce((sum, event) => sum + Number(event.bytes || 0), 0),
      rssMB: initialMemory.residentSet / 1024,
      searchMs: 0,
      columnsMs: 0,
      scrollMs: 0,
      interactionOk: true,
    };

    if (interact) {
      const searchValue = `image-${String(Math.floor(count / 2)).padStart(4, '0')}`;
      const search = await measureInteraction(
        window,
        `const input = document.querySelector('input[type="search"]');
         const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
         setter.call(input, ${JSON.stringify(searchValue)});
         input.dispatchEvent(new Event('input', { bubbles: true }));`,
      );
      result.searchMs = search.ms;

      await measureInteraction(
        window,
        `const input = document.querySelector('input[type="search"]');
         const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
         setter.call(input, '');
         input.dispatchEvent(new Event('input', { bubbles: true }));`,
      );

      const columns = await measureInteraction(
        window,
        `const buttons = [...document.querySelectorAll('.thumbnail-image-picker-size button')];
         const small = buttons.find((button) => button.textContent.trim() === '小');
         small.click();`,
      );
      result.columnsMs = columns.ms;

      const scroll = await measureInteraction(
        window,
        `const viewport = document.querySelector('.thumbnail-image-picker-viewport');
         const target = viewport || document.scrollingElement;
         target.scrollTop = target.scrollHeight;`,
      );
      result.scrollMs = scroll.ms;

      const beforePreview = events.filter((event) => event.kind === 'preview').length;
      const beforeCommit = events.filter((event) => event.kind === 'commit').length;
      await window.webContents.executeJavaScript(
        "document.querySelector('.thumbnail-image-choice').click()",
      );
      await doubleAnimationFrame(window);
      const selected = await window.webContents.executeJavaScript(
        "document.querySelector('.thumbnail-image-choice')?.getAttribute('aria-pressed')",
      );
      await window.webContents.executeJavaScript(
        "document.querySelector('.thumbnail-image-choice').click()",
      );
      await doubleAnimationFrame(window);
      const previewed = events.filter((event) => event.kind === 'preview').length > beforePreview;
      const committed = events.filter((event) => event.kind === 'commit').length > beforeCommit;
      result.interactionOk = selected === 'true' && previewed && committed;

      const finalMemory = await window.webContents.getProcessMemoryInfo();
      result.rssMB = Math.max(result.rssMB, finalMemory.residentSet / 1024);
      result.transferBytes = events
        .filter((event) => event.kind === 'transfer')
        .reduce((sum, event) => sum + Number(event.bytes || 0), 0);
    }
    return result;
  } finally {
    if (listener) ipcMain.removeListener(benchmarkChannel, listener);
    window.destroy();
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

async function benchmarkUi(count, dataUrls) {
  const initial = [];
  const redisplay = [];
  const search = [];
  const columns = [];
  const scroll = [];
  const ipcKB = [];
  const rssMB = [];
  const mounted = [];
  let interactionOk = true;

  for (let sample = 0; sample < sampleCount; sample++) {
    const first = await runPickerWindow(count, dataUrls, true);
    const second = await runPickerWindow(count, dataUrls, false);
    initial.push(first.initialMs);
    redisplay.push(second.initialMs);
    search.push(first.searchMs);
    columns.push(first.columnsMs);
    scroll.push(first.scrollMs);
    ipcKB.push(first.transferBytes / 1024);
    rssMB.push(first.rssMB);
    mounted.push(first.mounted);
    interactionOk = interactionOk && first.interactionOk;
  }

  return {
    initial: distribution(initial),
    redisplay: distribution(redisplay),
    search: distribution(search),
    columns: distribution(columns),
    scroll: distribution(scroll),
    ipcKB: distribution(ipcKB),
    rssMB: distribution(rssMB),
    mounted: distribution(mounted),
    interactionOk,
  };
}

app
  .whenReady()
  .then(async () => {
    const dataUrls = await browserFixtureDataUrls();
    const base = path.join(repo, 'dist-electron');
    const modules = {
      marketplace: await import(
        pathToFileURL(path.join(base, 'main', 'marketplace-image-service.js')).href
      ),
      finalArtifact: await import(
        pathToFileURL(path.join(base, 'main', 'final-artifact-image-service.js')).href
      ),
      cache: await import(pathToFileURL(path.join(base, 'main', 'thumbnail-image-cache.js')).href),
    };

    for (const count of counts) {
      const service = await benchmarkService(count, dataUrls, modules);
      const ui = await benchmarkUi(count, dataUrls);
      assert.equal(
        ui.interactionOk,
        true,
        'preview/commit interaction contract must remain intact',
      );
      console.log(
        `RELEASE201 ${JSON.stringify({
          label,
          count,
          formats: ['png', 'jpeg', 'webp'],
          service,
          ui,
        })}`,
      );
    }
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
