const fs = require('node:fs');
const path = require('node:path');
const { matchCode, doesNotMatchCode } = require('./source-match.cjs');

const repo = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(repo, 'src', 'renderer', 'ui.tsx'), 'utf8');
const app = fs.readFileSync(path.join(repo, 'src', 'renderer', 'App.tsx'), 'utf8');
const stage = fs.readFileSync(path.join(repo, 'src', 'renderer', 'ThumbnailStage.tsx'), 'utf8');
const service = fs.readFileSync(path.join(repo, 'src', 'main', 'thumbnail-service.ts'), 'utf8');
const main = fs.readFileSync(path.join(repo, 'src', 'main', 'main.ts'), 'utf8');
const preload = fs.readFileSync(path.join(repo, 'src', 'preload', 'index.cjs'), 'utf8');
const runtimeCopy = fs.readFileSync(path.join(repo, 'scripts', 'copy-runtime.cjs'), 'utf8');

matchCode(ui, /'キャプション',\s*'サムネイル'/, 'thumbnail stage must follow caption');
matchCode(app, /case 'サムネイル':\s*return <ThumbnailStage/, 'thumbnail stage must render');
matchCode(service, /Array\.from\(\{ length: 6 \}/, 'editor must create six thumbnail documents');
matchCode(service, /thumbnail-editor\.json/, 'thumbnail settings must persist in the project');
matchCode(service, /path\.join\(root, 'thumbnails'\)/, 'exports must stay in the project');
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
matchCode(preload, /thumbnail:[\s\S]*exportImage/, 'thumbnail API must be exposed through preload');
matchCode(main, /IPC\.THUMBNAIL_EXPORT/, 'main process must handle image export');
matchCode(
  runtimeCopy,
  /thumbnail\/psd-templates/,
  'runtime PSD templates must be copied from the dedicated thumbnail directory',
);

console.log('Thumbnail stage contract tests passed.');
