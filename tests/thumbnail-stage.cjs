const fs = require('node:fs');
const path = require('node:path');
const { matchCode, doesNotMatchCode } = require('./source-match.cjs');

const repo = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(repo, 'src', 'renderer', 'ui.tsx'), 'utf8');
const app = fs.readFileSync(path.join(repo, 'src', 'renderer', 'App.tsx'), 'utf8');
const stage = fs.readFileSync(path.join(repo, 'src', 'renderer', 'ThumbnailStage.tsx'), 'utf8');
const picker = fs.readFileSync(
  path.join(repo, 'src', 'renderer', 'ThumbnailPickerWindow.tsx'),
  'utf8',
);
const standalone = fs.readFileSync(
  path.join(repo, 'src', 'renderer', 'StandaloneToolApp.tsx'),
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
matchCode(
  preload,
  /thumbnail:[\s\S]*fonts:[\s\S]*exportImage/,
  'thumbnail API must expose system fonts',
);
matchCode(main, /IPC\.THUMBNAIL_FONTS/, 'main process must handle font enumeration');
matchCode(
  main,
  /THUMBNAIL_SELECT_IMAGE[\s\S]*getFinalArtifactStatus\(root\)[\s\S]*defaultPath:\s*finalArtifact\.exists/,
  'thumbnail image picker must default to the final artifact directory',
);
matchCode(service, /InstalledFontCollection/, 'Windows installed font families must be enumerated');
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
  picker,
  /IntersectionObserver[\s\S]*readPreview\(item\.path\)/,
  'image picker previews must load lazily',
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
  picker,
  /\['large', '大'\][\s\S]*\['medium', '中'\][\s\S]*\['small', '小'\]/,
  'image picker must expose large medium small display sizes',
);
matchCode(
  picker,
  /thumbnail-image-picker-grid \$\{size\}/,
  'image picker grid must reflect the selected display size',
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
  picker,
  /tentativeRef\.current === item\.path[\s\S]*commitPicker\(item\.path\)[\s\S]*previewPicker\(item\.path\)/,
  'first click must preview while selecting the same image again commits it',
);
matchCode(
  main,
  /THUMBNAIL_PICKER_COMMIT[\s\S]*state\.committed = true[\s\S]*THUMBNAIL_PICKER_COMMITTED[\s\S]*state\.window\.close\(\)/,
  'committing an image must notify the project preview and close the picker window',
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
  /onPickerCommit[\s\S]*updateSlot\(selection\.slot,[\s\S]*setPickerPreview\(null\)/,
  'confirmed selection must persist to the thumbnail slot',
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
matchCode(stage, /saveStatus[\s\S]*saveError[\s\S]*retrySave/, 'save failures must remain visible and retryable');
doesNotMatchCode(stage, /thumbnail\.save\(project\.rootPath, state\)\.catch\(\(\) => \{\}\)/, 'editor may not silently swallow save failure');
matchCode(service, /withTemplateStoreLock\(file/, 'concurrent Main process saves must share a per-file lock');
matchCode(service, /normalized\.saveRevision\s*<\s*lastRevision/, 'older save must not overwrite newer editor state');
matchCode(autosave, /return \(\) => flush\(\)/, 'stage switch must flush pending autosave before unmount');
matchCode(autosave, /window\.addEventListener\('beforeunload', flush\)/, 'window closing must dispatch pending autosave');
matchCode(autosave, /EDITOR_SAVE_STALE/, 'out-of-order save acknowledgments must surface as conflicts');
