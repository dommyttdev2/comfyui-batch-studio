const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { matchCode, doesNotMatchCode } = require('./source-match.cjs');

const repo = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(repo, 'src', 'renderer', 'ui.tsx'), 'utf8');
const app = fs.readFileSync(path.join(repo, 'src', 'renderer', 'App.tsx'), 'utf8');
const stage = fs.readFileSync(
  path.join(repo, 'src', 'renderer', 'MarketplaceImageStage.tsx'),
  'utf8',
);
assert.equal(
  (stage.match(/onClick=\{\(\) => openPicker\('/g) ?? []).length,
  2,
  'Marketplace editor must expose separate Final Artifact and Thumbnail pickers',
);
const picker = fs.readFileSync(
  path.join(repo, 'src', 'renderer', 'MarketplaceImagePickerWindow.tsx'),
  'utf8',
);
const service = fs.readFileSync(
  path.join(repo, 'src', 'main', 'marketplace-image-service.ts'),
  'utf8',
);
const autosave = fs.readFileSync(
  path.join(repo, 'src', 'renderer', 'use-editor-autosave.ts'),
  'utf8',
);

const imagePipeline = fs.readFileSync(path.join(repo, 'src', 'main', 'image-pipeline.ts'), 'utf8');
const imagePipelineCore = fs.readFileSync(
  path.join(repo, 'src', 'main', 'image-pipeline-core.ts'),
  'utf8',
);
const imageService = fs.readFileSync(
  path.join(repo, 'src', 'main', 'final-artifact-image-service.ts'),
  'utf8',
);
const main = fs.readFileSync(path.join(repo, 'src', 'main', 'main.ts'), 'utf8');
const preload = fs.readFileSync(path.join(repo, 'src', 'preload', 'index.cjs'), 'utf8');
const runtimeCopy = fs.readFileSync(path.join(repo, 'scripts', 'copy-runtime.cjs'), 'utf8');
const targets = JSON.parse(
  fs.readFileSync(path.join(repo, 'src', 'shared', 'marketplace-image-targets.json'), 'utf8'),
);

matchCode(
  ui,
  /'サムネイル',\s*'販売サイト用画像'/,
  'marketplace image stage must follow thumbnail in navigation',
);
matchCode(
  app,
  /case '販売サイト用画像':\s*return <MarketplaceImageStage/,
  'marketplace image stage must render',
);
matchCode(
  stage,
  /finalArtifact\.status\(project\.rootPath\)/,
  'stage must depend on Final Artifact status',
);
matchCode(stage, /サムネイルから画像を選択/, 'stage must allow exported thumbnail selection');
matchCode(service, /assertExportedThumbnail/, 'marketplace must validate thumbnail input scope');
matchCode(
  service,
  /marketplaceOutputDirectory\(root\)/,
  'marketplace output must resolve artifact directory',
);
matchCode(
  service,
  /generationManifestPath\(outputDirectory\)/,
  'generation manifest must move together with marketplace images',
);
matchCode(
  service,
  /const outputDirectory = await marketplaceOutputDirectory\(root\)/,
  'ZIP must resolve current artifact directory',
);

matchCode(service, /state\.sourceType/, 'generation must use the selected source type');
matchCode(
  service,
  /marketplace-images\.json/,
  'marketplace editor state must persist in ._batch_studio',
);
matchCode(
  service,
  /path\.join\(path\.resolve\(base\), 'marketplace'\)/,
  'marketplace outputs must be written under the configured artifact directory',
);
matchCode(
  service,
  /for \(const target of targets\)/,
  'all marketplace targets must be rendered independently',
);
matchCode(imagePipeline, /toJPEG\(100\)/, 'JPEG quality must remain fixed at 100');
matchCode(
  service,
  /renderLanczosCrop/,
  'marketplace output must use the explicit Lanczos3 pipeline',
);
matchCode(
  imagePipelineCore,
  /LANCZOS_LOBES = 3[\s\S]*resizeLanczosBitmap/,
  'image pipeline must implement Lanczos3 resizing',
);
matchCode(
  imagePipeline,
  /parseExifOrientation[\s\S]*applyExifOrientation/,
  'image decoding must apply EXIF orientation before cropping',
);
matchCode(stage, /toDataURL\('image\/webp', 1\)/, 'WebP quality must remain fixed at 100 percent');
matchCode(
  stage,
  /marketplace\.renderPng[\s\S]*encodePngAsWebp/,
  'WebP must be encoded from the Lanczos-rendered target image',
);
matchCode(
  service,
  /MAX_INPUT_BYTES = 100 \* 1024 \* 1024/,
  'input images must remain limited to 100MB',
);
matchCode(
  imageService,
  /assertFinalArtifactImage/,
  'final artifact image access must validate project scope',
);
matchCode(
  imageService,
  /extension === '\.webp'[\s\S]*readFile\(resolved\)[\s\S]*data:\$\{mime\};base64/,
  'WebP final artifacts must be passed through for Chromium decoding',
);
matchCode(
  stage,
  /normalizedWebpSourcePng[\s\S]*toDataURL\('image\/png'\)/,
  'WebP source images must be normalized to PNG in Chromium',
);
matchCode(
  service,
  /path\.extname\(resolved\)\.toLowerCase\(\) === '\.webp'[\s\S]*normalizedPngImage/,
  'Main Process must decode normalized PNG for WebP source images',
);
matchCode(
  service,
  /path\.extname\(resolved\)\.toLowerCase\(\) === '\.webp'[\s\S]*readFile\(resolved\)[\s\S]*encodedImageDimensions[\s\S]*assertInputDimensions[\s\S]*sourceDimensions\.width !== normalizedSize\.width/,
  'Main Process must validate the original WebP dimensions before accepting Renderer normalization',
);
matchCode(
  preload,
  /generate: \(r, s, w, p\)[\s\S]*renderPng: \(r, p, c, w, h, s, t\)/,
  'WebP normalization payload must cross preload explicitly',
);
matchCode(
  picker,
  /finalArtifact\.listImages\(nextContext\.root\)/,
  'marketplace picker must list Final Artifact images',
);
matchCode(
  picker,
  /marketplace\.listThumbnailImages\(nextContext\.root\)/,
  'picker must list exported thumbnails',
);
matchCode(
  picker,
  /marketplace\.readSourcePreview\(root, item\.path, sourceType\)/,
  'preview must validate its source type',
);
matchCode(picker, /marketplace\.previewPicker/, 'first picker click must preview the image');
matchCode(picker, /marketplace[\s\S]*commitPicker/, 'second picker click must commit the image');
matchCode(
  main,
  /autoHideMenuBar: true[\s\S]*販売サイト用画像を選択/,
  'marketplace picker must be a dedicated menu-less window',
);
matchCode(
  main,
  /IPC\.MARKETPLACE_PICKER_CANCELLED/,
  'closing the picker without commit must cancel tentative selection',
);
matchCode(
  preload,
  /marketplace:[\s\S]*generateZip[\s\S]*exportCustom/,
  'renderer preload must expose marketplace generation actions',
);
matchCode(
  runtimeCopy,
  /marketplace-image-targets\.json/,
  'marketplace target catalog must be copied to the Electron runtime',
);

assert.equal(targets.schemaVersion, 1);
assert.deepEqual(
  targets.targets.map(({ id, width, height }) => [id, width, height]),
  [
    ['fanza.package', 560, 420],
    ['fanza.thumbnail', 100, 100],
    ['dlsite.package', 560, 420],
    ['dlsite.thumbnail', 300, 300],
  ],
  'marketplace target catalog must preserve the source app dimensions',
);
assert.equal(
  targets.targets.filter((target) => target.width === 560 && target.height === 420).length,
  2,
  'FANZA and DLsite package targets must remain separate even at the same dimensions',
);

console.log('Marketplace image stage source contract tests passed.');

matchCode(stage, /useEditorAutosave\(/, 'marketplace must use durable autosave');
matchCode(
  stage,
  /saveStatus[\s\S]*saveError[\s\S]*retrySave/,
  'save failures must remain visible and retryable',
);
doesNotMatchCode(
  stage,
  /marketplace\.save\(project\.rootPath, state\)\.catch\(\(\) => \{\}\)/,
  'editor may not silently swallow save failure',
);
matchCode(
  service,
  /withTemplateStoreLock\(file/,
  'concurrent Main process saves must share a per-file lock',
);
matchCode(
  service,
  /normalized\.saveRevision\s*<\s*lastRevision/,
  'older save must not overwrite newer editor state',
);
matchCode(
  autosave,
  /return \(\) => \{\s*void flushAndWait\(\)/,
  'stage switch must await the editor save at the navigation boundary',
);
matchCode(
  autosave,
  /registerEditorFlush\(root, flushAndWait\)/,
  'window closing must request and await pending autosave',
);
matchCode(
  autosave,
  /EDITOR_SAVE_STALE/,
  'out-of-order save acknowledgments must surface as conflicts',
);

const cache = fs.readFileSync(path.join(repo, 'src', 'main', 'thumbnail-image-cache.ts'), 'utf8');
matchCode(
  service,
  /assertMarketplaceSource\(root, imagePath, sourceType\)[\s\S]*readCachedThumbnailImage\(userDataRoot, resolved, 'gallery', timing\)/,
  'marketplace preview must authorize source before using the shared gallery cache',
);
matchCode(
  cache,
  /info\.size,\s*info\.mtimeMs,\s*info\.ctimeMs,\s*variant/,
  'gallery cache key must invalidate replacement images',
);
matchCode(
  picker,
  /data:image\/webp;base64,[\s\S]*storeWebpPreview\(item\.path, dataUrl\)/,
  'WebP fallback must persist a resized preview for subsequent pickers',
);
matchCode(
  main,
  /MARKETPLACE_READ_SOURCE_PREVIEW[\s\S]*app\.getPath\('userData'\)[\s\S]*marketplace_preview_read/,
  'marketplace preview must use the shared user cache and record transfer metrics',
);

matchCode(
  picker,
  /<VirtualPickerGrid[\s\S]*items=\{filteredItems\}[\s\S]*renderItem=/,
  'marketplace picker must render only virtual rows while preserving selection callbacks',
);

matchCode(
  service,
  /writeJsonAtomic\(generationManifestPath\(outputDirectory\), manifest\)[\s\S]*cleanupTrackedOutput/,
  'marketplace old-format cleanup must follow the new commit marker',
);
matchCode(
  service,
  /previousManifest\.outputs[\s\S]*previousExtension === extension/,
  'only tracked outputs from a different format may be cleaned',
);
