/** Add editable Photoshop text metadata while preserving transparent raster previews. */

const fs = require('fs');
const path = require('path');
const agPsd = require(path.resolve('.codex-js-deps/node_modules/ag-psd'));
const { createCanvas } = require(path.resolve('.codex-js-deps/node_modules/canvas'));

agPsd.initializeCanvas(createCanvas);

function walk(children, callback) {
  for (const layer of children || []) {
    callback(layer);
    walk(layer.children, callback);
  }
}

function findLayer(psd, name) {
  let result;
  walk(psd.children, (layer) => {
    if (layer.name === name) result = layer;
  });
  if (!result) throw new Error(`Layer not found: ${name}`);
  return result;
}

function moveMasksToSlotFolders(psd) {
  const slotsRoot = findLayer(psd, '01_IMAGE_SLOTS__REPLACE_CONTENT_KEEP_MASKS');
  Object.assign(slotsRoot, { left: 0, top: 0, right: psd.width, bottom: psd.height });
  for (const slot of slotsRoot.children || []) {
    if (!slot.name.startsWith('SLOT_')) continue;
    const imageLayer = (slot.children || []).find((layer) =>
      layer.name.startsWith('REPLACE_IMAGE__'),
    );
    if (!imageLayer?.mask) {
      throw new Error(`Source mask not found in ${slot.name}`);
    }
    slot.mask = imageLayer.mask;
    delete imageLayer.mask;
    Object.assign(slot, { left: 0, top: 0, right: psd.width, bottom: psd.height });
  }
}

function keepSafeRasterPreview(layer, bounds) {
  // Photopea relies on the TypeLayer raster preview until the text is edited.
  // psd-tools stores transparency as a grayscale layer mask. Bake that mask
  // into the actual alpha channel before removing it, so Photopea sees a
  // normal transparent TypeLayer instead of an opaque black rectangle.
  const pixels = layer.imageData?.data;
  const maskPixels = layer.mask?.imageData?.data;
  if (pixels && maskPixels && pixels.length === maskPixels.length) {
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i + 3] = Math.round((pixels[i + 3] * maskPixels[i]) / 255);
    }
  }
  delete layer.mask;
  Object.assign(layer, bounds);
}

function editableText(text, fontSize, x, y) {
  return {
    text,
    transform: [1, 0, 0, 1, x, y],
    antiAlias: 'sharp',
    orientation: 'horizontal',
    shapeType: 'point',
    style: {
      font: { name: 'TimesNewRomanPSMT' },
      fontSize,
      fillColor: { r: 255, g: 255, b: 255 },
      fillFlag: true,
      strokeFlag: false,
      tracking: 0,
    },
    paragraphStyle: { justification: 'center' },
  };
}

function processFile(filePath) {
  const input = fs.readFileSync(filePath);
  const psd = agPsd.readPsd(input, { useImageData: true, useRawThumbnail: true });

  moveMasksToSlotFolders(psd);

  const title = findLayer(psd, 'TITLE__EDIT_TEXT');
  title.text = editableText('Scene 01', 154, 800, 985);
  keepSafeRasterPreview(title, { left: 0, top: 0, right: psd.width, bottom: psd.height });

  const subtitle = findLayer(psd, 'SUBTITLE__EDIT_TEXT');
  subtitle.text = editableText('Midnight Elegance', 50, 800, 1100);
  keepSafeRasterPreview(subtitle, { left: 0, top: 0, right: psd.width, bottom: psd.height });

  const textGroup = findLayer(psd, '04_TEXT__EDITABLE');
  Object.assign(textGroup, { left: 0, top: 0, right: psd.width, bottom: psd.height });

  const output = agPsd.writePsdBuffer(psd, {
    generateThumbnail: false,
    trimImageData: false,
    invalidateTextLayers: false,
  });
  fs.writeFileSync(filePath, output);
  console.log(`editable text added: ${filePath}`);
}

const outputDir = process.argv[2];
if (!outputDir) throw new Error('Usage: node make_psd_text_editable.cjs <output-dir>');

for (const fileName of fs.readdirSync(outputDir).sort()) {
  if (fileName.toLowerCase().endsWith('.psd')) {
    processFile(path.join(outputDir, fileName));
  }
}
