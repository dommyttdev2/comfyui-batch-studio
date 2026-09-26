// npm run build:electron && electron --no-sandbox tests/image-memory-electron.cjs
// Use xvfb-run on Linux without a display. All fixtures are synthetic and temporary.
const { app, nativeImage, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');

app.disableHardwareAcceleration();
app
  .whenReady()
  .then(async () => {
    const root = path.resolve(__dirname, '../dist-electron');
    const pipeline = await import(pathToFileURL(path.join(root, 'main/image-pipeline.js')).href);
    const limitsPath = path.join(root, 'shared/image-size-limits.js');
    const limits = await import(pathToFileURL(limitsPath).href);
    const marketplace = await import(
      pathToFileURL(path.join(root, 'main/marketplace-image-service.js')).href
    );
    const cache = await import(
      pathToFileURL(path.join(root, 'main/thumbnail-image-cache.js')).href
    );
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'image-memory-electron-'));
    const side = Number(process.argv[2] || 2048);
    let window;
    try {
      const state = await marketplace.createDefaultMarketplaceImageState();
      await marketplace.saveMarketplaceImageState(temporary, state);
      const editorFile = path.join(temporary, '._batch_studio/marketplace-images.json');
      const editorBefore = await fs.readFile(editorFile, 'utf8');
      await assert.rejects(
        marketplace.exportCustomMarketplaceImage(temporary, {
          ...state,
          custom: { ...state.custom, width: 20000, height: 20000 },
        }),
        /作業メモリ/,
      );
      assert.equal(await fs.readFile(editorFile, 'utf8'), editorBefore);
      assert.deepEqual(await fs.readdir(temporary), ['._batch_studio']);
      const bitmap = Buffer.alloc(side * side * 4, 127);
      const fixture = nativeImage.createFromBitmap(bitmap, { width: side, height: side });
      for (const [format, bytes] of [
        ['png', fixture.toPNG()],
        ['jpeg', fixture.toJPEG(100)],
      ]) {
        const file = path.join(temporary, `input.${format}`);
        await fs.writeFile(file, bytes);
        const baselineRss = process.memoryUsage().rss;
        const start = performance.now();
        const decoded = await pipeline.readOrientedNativeImage(file);
        const rendered = pipeline.renderLanczosCrop(
          decoded.image,
          { x: 0, y: 0, width: side, height: side },
          side + 1,
          side,
        );
        const encoded = pipeline.encodeLanczosImage(rendered, format);
        assert.ok(encoded.length > 0);
        assert.deepEqual(rendered.getSize(), { width: side + 1, height: side });
        console.log(
          JSON.stringify({
            format,
            side,
            elapsedMs: performance.now() - start,
            baselineRss,
            rss: process.memoryUsage().rss,
            maxRssKiB: process.resourceUsage().maxRSS,
          }),
        );
      }

      // Header rejection must happen before native decoding, with no writes.
      const giant = Buffer.from(fixture.toPNG());
      giant.writeUInt32BE(20000, 16);
      giant.writeUInt32BE(20000, 20);
      const giantFile = path.join(temporary, 'giant.png');
      await fs.writeFile(giantFile, giant);
      const webpFile = path.join(temporary, 'input.webp');
      await fs.writeFile(webpFile, 'synthetic cache identity');
      await assert.rejects(
        cache.storeWebpThumbnailPreview(
          temporary,
          webpFile,
          `data:image/png;base64,${giant.toString('base64')}`,
        ),
        /Invalid WebP preview dimensions/,
      );
      const before = await fs.readdir(temporary);
      const rejectionStart = performance.now();
      await assert.rejects(pipeline.readOrientedNativeImage(giantFile), /作業メモリ/);
      assert.throws(
        () =>
          pipeline.renderLanczosCrop(
            fixture,
            { x: 0, y: 0, width: side, height: side },
            20000,
            20000,
          ),
        /作業メモリ/,
      );
      assert.deepEqual(await fs.readdir(temporary), before);
      console.log(
        JSON.stringify({ scope: 'giant rejection', elapsedMs: performance.now() - rejectionStart }),
      );

      window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
      await window.loadURL('about:blank');
      const moduleUrl = `data:text/javascript;base64,${Buffer.from(await fs.readFile(limitsPath)).toString('base64')}`;
      const renderer = await window.webContents.executeJavaScript(`(async () => {
      const limits = await import(${JSON.stringify(moduleUrl)});
      const canvas = document.createElement('canvas');
      canvas.width = ${side}; canvas.height = ${side};
      canvas.getContext('2d').fillRect(0, 0, ${side}, ${side});
      const image = new Image(); image.src = canvas.toDataURL('image/webp', 1);
      await image.decode();
      limits.assertInputDimensions(image.naturalWidth, image.naturalHeight);
      let rejected = false;
      try { limits.assertOutputDimensions(20000, 20000); } catch { rejected = true; }
      return { width: image.naturalWidth, height: image.naturalHeight, rejected };
    })()`);
      assert.deepEqual(renderer, { width: side, height: side, rejected: true });
      assert.doesNotThrow(() => limits.assertInputDimensions(renderer.width, renderer.height));
      console.log(JSON.stringify({ scope: 'Chromium WebP and shared limits', ...renderer }));
    } finally {
      window?.destroy();
      await fs.rm(temporary, { recursive: true, force: true });
    }
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
