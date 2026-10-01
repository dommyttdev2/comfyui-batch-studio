const fs = require('node:fs');
const path = require('node:path');
const { matchCode, doesNotMatchCode } = require('./source-match.cjs');
const { readMainProcessSource } = require('./main-process-source.cjs');

const repo = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(repo, 'src', 'renderer', 'ui.tsx'), 'utf8');
const app = fs.readFileSync(path.join(repo, 'src', 'renderer', 'App.tsx'), 'utf8');
const stage = fs.readFileSync(path.join(repo, 'src', 'renderer', 'ThumbnailStage.tsx'), 'utf8');
const picker = fs.readFileSync(
  path.join(repo, 'src', 'renderer', 'ThumbnailPickerWindow.tsx'),
  'utf8',
);
const sharedPicker = fs.readFileSync(
  path.join(repo, 'src', 'renderer', 'ImagePickerGrid.tsx'),
  'utf8',
);
const standalone = fs.readFileSync(
  path.join(repo, 'src', 'renderer', 'StandaloneToolApp.tsx'),
  'utf8',
);
const virtualGrid = fs.readFileSync(
  path.join(repo, 'src', 'renderer', 'VirtualPickerGrid.tsx'),
  'utf8',
);
const thumbnailCss = fs.readFileSync(
  path.join(repo, 'src', 'renderer', 'thumbnail-stage.css'),
  'utf8',
);
const service = fs.readFileSync(path.join(repo, 'src', 'main', 'thumbnail-service.ts'), 'utf8');
const autosave = fs.readFileSync(
  path.join(repo, 'src', 'renderer', 'use-editor-autosave.ts'),
  'utf8',
);

const finalArtifactImageService = fs.readFileSync(
  path.join(repo, 'src', 'main', 'final-artifact-image-service.ts'),
  'utf8',
);
const main = readMainProcessSource(repo);
const preload = fs.readFileSync(path.join(repo, 'src', 'preload', 'index.cjs'), 'utf8');
const runtimeCopy = fs.readFileSync(path.join(repo, 'scripts', 'copy-runtime.cjs'), 'utf8');
const pickerPerf = fs.readFileSync(
  path.join(repo, 'src', 'main', 'thumbnail-picker-perf.ts'),
  'utf8',
);
const thumbnailCache = fs.readFileSync(
  path.join(repo, 'src', 'main', 'thumbnail-image-cache.ts'),
  'utf8',
);
const thumbnailTypes = fs.readFileSync(path.join(repo, 'src', 'shared', 'types.ts'), 'utf8');
const thumbnailIpc = fs.readFileSync(path.join(repo, 'src', 'shared', 'ipc.ts'), 'utf8');
matchCode(
  pickerPerf,
  /thumbnail-picker-performance\.jsonl/,
  'performance events must be saved in a discoverable JSONL log',
);
matchCode(pickerPerf, /sessionId/, 'timing events must be correlated to a picker session');
matchCode(pickerPerf, /MAX_BYTES/, 'performance logs must be size bounded');
doesNotMatchCode(
  pickerPerf,
  /imagePath|dataUrl|sourceImagePath/,
  'performance log must not include source file paths or image contents',
);
matchCode(main, /'window_opened'/, 'picker startup must be measured');
matchCode(main, /'list_images'/, 'Main process file enumeration must be measured');
matchCode(main, /'preview_read'/, 'individual preview read timings must be captured');
matchCode(main, /'preview_error'/, 'preview failures must be timed');
matchCode(
  main,
  /thumbnailPickerForSender\(event\.sender\)/,
  'renderer metrics must be bound to a picker window',
);
matchCode(thumbnailCache, /timing\.statMs/, 'cache identity lookup must be measured');
matchCode(thumbnailCache, /timing\.decodeMs/, 'cache decode must be measured');
matchCode(thumbnailCache, /timing\.resizeMs/, 'cache resizing must be measured');
matchCode(thumbnailCache, /timing\.hit = true/, 'cache hits must be distinguished from misses');
matchCode(picker, /'list_painted'/, 'initial React list rendering must be measured');
matchCode(picker, /'first_image_painted'/, 'first image paint must be measured');
matchCode(picker, /'grid_painted'/, 'search and size changes must be measured');
matchCode(sharedPicker, /onLoad=/, 'image decode completion must be measured');
matchCode(thumbnailTypes, /logPickerPerf:/, 'typed preload must expose renderer metrics');
matchCode(thumbnailIpc, /THUMBNAIL_PICKER_PERF/, 'IPC contract must expose renderer metrics');
matchCode(preload, /logPickerPerf:/, 'preload must forward renderer metrics');
matchCode(picker, /openPickerPerfLog/, 'picker must offer log folder action');

matchCode(ui, /'キャプション',\s*'サムネイル'/, 'thumbnail stage must follow caption');
matchCode(app, /case 'サムネイル':\s*return <ThumbnailStage/, 'thumbnail stage must render');
matchCode(
  service,
  /Array\.from\(\{ length: 5 \}/,
  'new projects must create five thumbnail documents',
);
matchCode(
  service,
  /sourceDocuments\.filter[\s\S]*\.map\(\(candidate\)/,
  'saved thumbnail documents must be normalized without truncation',
);
matchCode(stage, /const addDocument = \(\)/, 'editor must support adding documents');
matchCode(stage, /const confirmDeleteDocument = \(\)/, 'editor must support deleting documents');
matchCode(stage, /state\.documents\.length <= 1/, 'editor must retain at least one document');
matchCode(service, /thumbnail-editor\.json/, 'thumbnail settings must persist in the project');
matchCode(
  service,
  /meta\?\.settings\.artifactOutputPath[\s\S]*path\.join\(path\.resolve\(base\), 'thumbnails'\)/,
  'exports must be written to the configured artifact output root',
);
matchCode(
  main,
  /Number\.isSafeInteger\(documentId\)/,
  'thumbnail export must support dynamically allocated document IDs',
);
matchCode(
  service,
  /listExportedThumbnails/,
  'exported thumbnails must be available to downstream selection',
);
matchCode(stage, /'3-images'/, 'three-image PSD layout must be available');
matchCode(stage, /'4-images-left-split'/, 'left-split PSD layout must be available');
matchCode(stage, /'4-images-right-split'/, 'right-split PSD layout must be available');
matchCode(stage, /'5-images-both-split'/, 'five-image PSD layout must be available');
matchCode(
  stage,
  /context\.stroke\(\);[\s\S]*ratio \*\* 1\.35/,
  'gradient must render above white dividers',
);
matchCode(
  stage,
  /skipLayerImageData: true/,
  'PSD raster layers must not decode as opaque black overlays',
);
doesNotMatchCode(
  stage,
  /drawImage\(template\.(?:dividers|gradient)/,
  'opaque PSD overlay canvases must never cover the thumbnail preview',
);
matchCode(stage, /画像をドラッグして構図を調整/, 'preview must explain direct positioning');
matchCode(
  stage,
  /フォント[\s\S]*サイズ[\s\S]*X位置[\s\S]*Y位置/,
  'text typography and position must be editable',
);
matchCode(
  preload,
  /thumbnail:[\s\S]*fonts:[\s\S]*exportImage/,
  'thumbnail API must expose system fonts',
);
matchCode(main, /IPC\.THUMBNAIL_FONTS/, 'main process must handle font enumeration');
const cache = fs.readFileSync(path.join(repo, 'src', 'main', 'thumbnail-image-cache.ts'), 'utf8');
const memoryCache = fs.readFileSync(
  path.join(repo, 'src', 'renderer', 'thumbnail-image-memory-cache.ts'),
  'utf8',
);
matchCode(
  cache,
  /MAX_EDGE:[\s\S]*editor: 2048, gallery: 320/,
  'editor and gallery caches must have distinct resolutions',
);
matchCode(
  cache,
  /info\.size, info\.mtimeMs, info\.ctimeMs/,
  'cache keys must invalidate replaced source files',
);
matchCode(cache, /MAX_CONCURRENT = 2/, 'cache generation must bound concurrent image decodes');
matchCode(
  cache,
  /ThumbnailCachePruner\(LIMIT_BYTES\)[\s\S]*scheduleCachePrune/,
  'cache capacity cleanup must be delegated to the single-flight idle pruner',
);
matchCode(
  cache,
  /pending\.has\(file\) \|\| protectedCacheFiles\.has\(file\)/,
  'pending and actively accessed cache files must be protected from prune',
);
matchCode(
  main,
  /pruneRequests[\s\S]*pruneRuns[\s\S]*pruneDeleted[\s\S]*pruneLastMs/,
  'picker performance logs must include path-free prune counters and duration',
);
matchCode(cache, /LIMIT_BYTES = 512/, 'disk cache must have a size limit');
matchCode(memoryCache, /const LIMIT = 128/, 'decoded image cache must have a memory limit');
matchCode(stage, /readEditorImage\(imagePath\)/, 'editor must load persistent image cache');
matchCode(
  stage,
  /fullResolutionImages\(active\)/,
  'single export must use original image resolution',
);
matchCode(
  stage,
  /fullResolutionImages\(thumbnail\)/,
  'batch export must use original image resolution',
);
matchCode(picker, /storeWebpPreview/, 'gallery must persist Chromium-scaled WebP previews');
matchCode(main, /IPC\.THUMBNAIL_READ_EDITOR_IMAGE/, 'Main must expose editor cache');

matchCode(
  main,
  /THUMBNAIL_SELECT_IMAGE[\s\S]*getFinalArtifactStatus\(root\)[\s\S]*defaultPath:\s*finalArtifact\.exists/,
  'thumbnail image picker must default to the final artifact directory',
);
matchCode(
  stage,
  /thumbnail[\s\S]*\.fonts\(\)[\s\S]*FontFamilyComboBox/,
  'font selector must use the installed font list',
);
matchCode(stage, /role="combobox"/, 'font selector must expose a combobox input');
matchCode(stage, /includes\(needle\)/, 'font selector must filter installed fonts by typed text');
matchCode(stage, /role="listbox"/, 'font selector must expose a dropdown suggestion list');
matchCode(
  stage,
  /setShowAll\(true\)[\s\S]*setShowAll\(false\)/,
  'font dropdown must show all fonts while typed input switches to suggestions',
);
matchCode(
  service,
  /fonts\.includes\('Meiryo UI'\) \? 'Meiryo UI' : 'Times New Roman'/,
  'Meiryo UI must be the default font when it is installed',
);
matchCode(
  stage,
  /openImagePicker\(drag\.slot\)/,
  'clicking a preview image area must open the image picker',
);
matchCode(
  stage,
  /Math\.hypot[\s\S]*moved[\s\S]*moveSlot/,
  'preview dragging must remain distinct from click-to-pick',
);
matchCode(
  stage,
  /\.openPicker\([\s\S]*project\.rootPath[\s\S]*slot/,
  'preview click must open the image picker in a dedicated window',
);
doesNotMatchCode(
  stage,
  /thumbnail-image-picker-backdrop/,
  'thumbnail image selection must not render as a modal in the project window',
);
matchCode(
  standalone,
  /thumbnail-picker[\s\S]*ThumbnailPickerWindow/,
  'thumbnail picker must be routed as a standalone renderer window',
);
matchCode(
  picker,
  /\.listImages\(nextContext\.root\)/,
  'picker window must list final artifact images',
);
matchCode(
  main,
  /validateThumbnailPickerImage[\s\S]*assertFinalArtifactImage\(state\.root,\s*imagePath\)/,
  'picker cache reads must reuse final-artifact realpath authorization',
);
matchCode(
  sharedPicker,
  /IntersectionObserver[\s\S]*readPreview\(item\)/,
  'image picker previews must load lazily through the shared provider adapter',
);
matchCode(
  main,
  /THUMBNAIL_LIST_IMAGES[\s\S]*getFinalArtifactStatus\(root\)[\s\S]*listThumbnailImages/,
  'thumbnail gallery must use the final artifact directory',
);
matchCode(
  service,
  /readThumbnailPreview[\s\S]*readImagePreview\(imagePath\)/,
  'thumbnail preview must delegate to the shared final artifact image service',
);
matchCode(
  finalArtifactImageService,
  /readOrientedNativeImage[\s\S]*resize\(\{ width: 320/,
  'shared gallery previews must remain EXIF-aware and lightweight',
);
matchCode(
  preload,
  /thumbnail:[\s\S]*listImages:[\s\S]*readPreview:[\s\S]*openPicker:[\s\S]*pickerContext/,
  'thumbnail gallery and picker window APIs must be exposed through preload',
);
matchCode(
  preload,
  /THUMBNAIL_LIST_IMAGES:\s*'thumbnail:list-images'[\s\S]*THUMBNAIL_PICKER_OPEN:\s*'thumbnail-picker:open'/,
  'preload IPC constants must define gallery and picker channels',
);
matchCode(
  sharedPicker,
  /\['large', '大'\][\s\S]*\['medium', '中'\][\s\S]*\['small', '小'\]/,
  'shared image picker must expose large medium small display sizes',
);
matchCode(
  sharedPicker,
  /<VirtualPickerGrid[\s\S]*size=\{session\.size\}/,
  'shared image picker grid must reflect the selected display size',
);
matchCode(
  picker,
  /<ImagePickerGrid[\s\S]*provider=\{provider\}/,
  'thumbnail picker must delegate rendering and selection state to the shared picker',
);
matchCode(
  thumbnailCss,
  /thumbnail-image-picker-grid\.large[\s\S]*repeat\(3,[\s\S]*thumbnail-image-picker-grid\.medium[\s\S]*repeat\(5,[\s\S]*thumbnail-image-picker-grid\.small[\s\S]*repeat\(7,/,
  'gallery display sizes must render 3, 5, and 7 columns',
);
matchCode(
  thumbnailCss,
  /thumbnail-image-choice-preview img[\s\S]*height:\s*auto[\s\S]*object-fit:\s*contain/,
  'gallery previews must preserve the source aspect ratio and show the whole image',
);
doesNotMatchCode(
  thumbnailCss,
  /thumbnail-image-choice-preview\s*\{[\s\S]*?aspect-ratio:\s*4\s*\/\s*3/,
  'gallery preview containers must not force images into a 4:3 frame',
);
matchCode(
  main,
  /loadRenderer\(view, 'thumbnail-picker'\)/,
  'image picker must load in its own Electron window',
);
matchCode(
  main,
  /openThumbnailPickerWindow[\s\S]*autoHideMenuBar:\s*true[\s\S]*window\.removeMenu\(\)[\s\S]*window\.setMenuBarVisibility\(false\)/,
  'thumbnail picker window must not show the application menu bar',
);
matchCode(
  sharedPicker,
  /tentativeRef\.current === item\.path[\s\S]*\.commit\(item\.path\)[\s\S]*\.preview\(item\.path\)/,
  'shared picker must preview on first click and commit the same image on the second click',
);
matchCode(
  picker,
  /preview: \(path\) => window\.batchStudio\.thumbnail\.previewPicker\(path\)[\s\S]*commit: \(path\) => window\.batchStudio\.thumbnail\.commitPicker\(path\)/,
  'thumbnail picker provider must bind the shared state machine to thumbnail IPC',
);
matchCode(
  main,
  /THUMBNAIL_PICKER_COMMIT[\s\S]*beginCommit\(resolved\)[\s\S]*THUMBNAIL_PICKER_COMMITTED[\s\S]*await committed[\s\S]*state\.window\.close\(\)/,
  'committing an image must await the project save before closing the picker window',
);
matchCode(
  main,
  /window\.on\('closed'[\s\S]*!state\.committed[\s\S]*THUMBNAIL_PICKER_CANCELLED/,
  'closing an uncommitted picker must cancel the tentative preview',
);
matchCode(
  stage,
  /onPickerPreview[\s\S]*setPickerPreview\(selection\)/,
  'first selection must update the project preview immediately',
);
matchCode(
  stage,
  /onPickerCommit[\s\S]*saveNow\(next\)[\s\S]*setState\(saved\)[\s\S]*commitResult\(selection\.sessionId, selection\.imagePath, true\)/,
  'confirmed selection must persist before acknowledging the picker',
);
matchCode(
  stage,
  /onPickerCancel[\s\S]*setPickerPreview\(null\)/,
  'closing without confirmation must remove the tentative preview',
);
matchCode(preload, /thumbnail:[\s\S]*exportImage/, 'thumbnail API must be exposed through preload');
matchCode(main, /IPC\.THUMBNAIL_EXPORT/, 'main process must handle image export');
matchCode(
  runtimeCopy,
  /thumbnail\/psd-templates/,
  'runtime PSD templates must be copied from the dedicated thumbnail directory',
);

console.log('Thumbnail stage contract tests passed.');

matchCode(stage, /useEditorAutosave\(/, 'thumbnail must use durable autosave');
matchCode(
  stage,
  /saveStatus[\s\S]*saveError[\s\S]*retrySave/,
  'save failures must remain visible and retryable',
);
doesNotMatchCode(
  stage,
  /thumbnail\.save\(project\.rootPath, state\)\.catch\(\(\) => \{\}\)/,
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

async function testExportedThumbnailAuthorization() {
  const promises = require('node:fs/promises');
  const assert = require('node:assert/strict');
  const text = service
    .slice(
      service.indexOf('export async function assertExportedThumbnail('),
      service.indexOf('\nexport async function deleteThumbnailOutputs('),
    )
    .replace(/^export /, '')
    .replace(/: string/g, '')
    .replace(/: Promise<string>/g, '')
    .replace(/readJson<unknown>/g, 'readJson');
  const temp = await promises.mkdtemp(path.join(require('node:os').tmpdir(), 'thumbnail-auth-'));
  const output = path.join(temp, 'thumbnails');
  let outputManifest = { outputs: {} };
  const authorize = new Function(
    'path',
    'thumbnailOutputDirectory',
    'readJson',
    'statePath',
    'normalizeThumbnailState',
    'thumbnailOutputManifest',
    'realpath',
    'lstat',
    'process',
    `return ${text};`,
  )(
    path,
    async () => output,
    async () => ({}),
    () => '',
    () => ({ documents: [{ id: 1 }] }),
    async () => outputManifest,
    promises.realpath,
    promises.lstat,
    process,
  );
  try {
    await promises.mkdir(output);
    const selected = path.join(output, 'thumbnail-01.jpg');
    await promises.writeFile(selected, 'image');
    assert.equal(await authorize(temp, selected), selected);
    outputManifest = { outputs: { 1: { fileName: 'thumbnail-01.png' } } };
    await assert.rejects(authorize(temp, selected));
    outputManifest = { outputs: {} };
    const invalidId = path.join(output, 'thumbnail-02.jpg');
    await promises.writeFile(invalidId, 'image');
    await assert.rejects(authorize(temp, invalidId));
    const outside = path.join(temp, 'thumbnail-01.jpg');
    await promises.writeFile(outside, 'image');
    await assert.rejects(authorize(temp, outside));
    const link = path.join(output, 'thumbnail-1.png');
    await promises.symlink(outside, link);
    await assert.rejects(authorize(temp, link));
  } finally {
    await promises.rm(temp, { recursive: true, force: true });
  }
}

testExportedThumbnailAuthorization().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

matchCode(
  virtualGrid,
  /thumbnail-image-picker-grid thumbnail-image-picker-row \$\{size\}/,
  'virtual rows must retain the three picker column layouts',
);
matchCode(
  virtualGrid,
  /activePath[\s\S]*scrollTop/,
  'filtering and size changes must keep the current image visible',
);
const rangeSource = virtualGrid
  .slice(
    virtualGrid.indexOf('export function virtualPickerRange('),
    virtualGrid.indexOf('\nexport function VirtualPickerGrid'),
  )
  .replace(/^export /, '')
  .replace(/: number/g, '');
const virtualPickerRange = new Function('OVERSCAN', `return ${rangeSource}`)(3);
const firstRange = virtualPickerRange(2000, 5, 200, 0, 700);
require('node:assert/strict').equal(firstRange.rows, 400);
require('node:assert/strict').ok(
  (firstRange.end - firstRange.start) * 5 < 100,
  '2000 images must mount only visible and overscan rows',
);
const lastRange = virtualPickerRange(2000, 7, 200, 100000, 700);
require('node:assert/strict').ok(lastRange.start <= lastRange.end);
require('node:assert/strict').ok(lastRange.end <= lastRange.rows);

doesNotMatchCode(
  stage,
  /state\.documents\s*\.filter\(\(document\) => document\.id !== active\.id\)[\s\S]*readEditorImage/,
  'inactive documents must not retain decoded images through bulk prefetch',
);
matchCode(
  stage,
  /Object\.fromEntries\(Object\.entries\(current\)\.filter\(\(\[imagePath\]\) => retained\.has\(imagePath\)\)\)/,
  'switching documents must release inactive editor image references',
);
matchCode(stage, /resetEditorImageCache\(\)/, 'switching projects must clear decoded image cache');
matchCode(stage, /imageLoadState\.error[\s\S]*再試行/, 'missing active images must offer retry');
matchCode(
  memoryCache,
  /requestedGeneration !== generation/,
  'old project decodes must not refill the new project cache',
);

matchCode(
  service,
  /manifest\.outputs\[String\(Number\(match\[1\]\)\)\][\s\S]*tracked\.fileName !== entry\.name/,
  'downstream thumbnail list must not expose superseded formats',
);
matchCode(
  service,
  /writeJsonAtomic\(manifestPath, manifest\)[\s\S]*cleanupTrackedOutput/,
  'old thumbnail cleanup must follow successful new output tracking',
);
