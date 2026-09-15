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
const picker = fs.readFileSync(
  path.join(repo, 'src', 'renderer', 'MarketplaceImagePickerWindow.tsx'),
  'utf8',
);
const service = fs.readFileSync(
  path.join(repo, 'src', 'main', 'marketplace-image-service.ts'),
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
matchCode(
  stage,
  /サムネイル工程の生成物は使用しません/,
  'stage must explicitly avoid Thumbnail output as an input source',
);
doesNotMatchCode(
  service,
  /path\.join\(root, 'thumbnails'/,
  'marketplace generation must never read Thumbnail output',
);
matchCode(
  service,
  /marketplace-images\.json/,
  'marketplace editor state must persist in ._batch_studio',
);
matchCode(
  service,
  /path\.join\(root, 'marketplace'\)/,
  'marketplace outputs must be written under the project',
);
matchCode(
  service,
  /for \(const target of targets\)/,
  'all marketplace targets must be rendered independently',
);
matchCode(service, /toJPEG\(100\)/, 'JPEG quality must remain fixed at 100');
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
  picker,
  /finalArtifact\.listImages\(nextContext\.root\)/,
  'marketplace picker must list Final Artifact images',
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
