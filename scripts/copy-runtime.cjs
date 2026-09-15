const fs = require('fs');
const path = require('path');
fs.mkdirSync('dist-electron/preload', { recursive: true });
fs.copyFileSync('src/preload/index.cjs', 'dist-electron/preload/index.cjs');
fs.copyFileSync(
  'src/shared/marketplace-image-targets.json',
  'dist-electron/marketplace-image-targets.json',
);
fs.rmSync('dist-electron/templates', { recursive: true, force: true });
fs.cpSync('templates', 'dist-electron/templates', { recursive: true });
const thumbnailTemplates = 'thumbnail/psd-templates';
const thumbnailRuntime = 'dist-electron/thumbnail-templates';
fs.rmSync(thumbnailRuntime, { recursive: true, force: true });
fs.mkdirSync(thumbnailRuntime, { recursive: true });
for (const name of [
  'thumbnail-template-3-images.psd',
  'thumbnail-template-4-images-left-split.psd',
  'thumbnail-template-4-images-right-split.psd',
  'thumbnail-template-5-images-both-split.psd',
]) {
  fs.copyFileSync(path.join(thumbnailTemplates, name), path.join(thumbnailRuntime, name));
}
