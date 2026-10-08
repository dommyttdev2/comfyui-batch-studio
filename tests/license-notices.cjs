const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkNotices, renderNotices } = require('../scripts/generate-third-party-notices.cjs');
const { copyLicenseFiles } = require('../scripts/copy-license-notices.cjs');
const root = path.resolve(__dirname, '..');
checkNotices(root);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-license-test-'));
try {
  for (const file of [
    'package-lock.json',
    'licenses/third-party.json',
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
  ]) {
    fs.mkdirSync(path.dirname(path.join(temporary, file)), { recursive: true });
    fs.copyFileSync(path.join(root, file), path.join(temporary, file));
  }
  const lockPath = path.join(temporary, 'package-lock.json');
  const lock = JSON.parse(fs.readFileSync(lockPath));
  const dependency = Object.keys(lock.packages).find((name) => name);
  const original = lock.packages[dependency].integrity;
  lock.packages[dependency].integrity = 'sha512-changed';
  fs.writeFileSync(lockPath, JSON.stringify(lock));
  assert.throws(() => renderNotices(temporary), /Refresh third-party notices/);
  lock.packages[dependency].integrity = original;
  fs.writeFileSync(lockPath, JSON.stringify(lock));
  const catalogPath = path.join(temporary, 'licenses/third-party.json');
  const originalCatalog = fs.readFileSync(catalogPath, 'utf8');
  const catalog = JSON.parse(originalCatalog);
  const textKey = Object.keys(catalog.texts)[0];
  catalog.texts[textKey] += 'tampered';
  fs.writeFileSync(catalogPath, JSON.stringify(catalog));
  assert.throws(() => renderNotices(temporary), /Invalid notice text/);
  fs.writeFileSync(catalogPath, originalCatalog);
  fs.appendFileSync(path.join(temporary, 'THIRD_PARTY_NOTICES.md'), 'changed');
  assert.throws(() => checkNotices(temporary), /stale/);
  fs.writeFileSync(path.join(temporary, 'THIRD_PARTY_NOTICES.md'), renderNotices(temporary));
  assert.throws(() => copyLicenseFiles(temporary), /Required distribution license is missing/);
  const electron = path.join(temporary, 'node_modules/electron/dist');
  fs.mkdirSync(electron, { recursive: true });
  fs.writeFileSync(path.join(electron, 'LICENSE'), 'Electron test license');
  fs.writeFileSync(
    path.join(electron, 'LICENSES.chromium.html'),
    '<html>Chromium test notices</html>',
  );
  copyLicenseFiles(temporary);
  assert.equal(
    fs.readFileSync(path.join(temporary, 'dist-electron/LICENSE'), 'utf8'),
    fs.readFileSync(path.join(root, 'LICENSE'), 'utf8'),
  );
  assert.equal(
    fs.readFileSync(
      path.join(temporary, 'dist-electron/licenses/electron/LICENSES.chromium.html'),
      'utf8',
    ),
    '<html>Chromium test notices</html>',
  );
  assert.equal(
    fs.readFileSync(path.join(temporary, 'dist-electron/THIRD_PARTY_NOTICES.md'), 'utf8'),
    renderNotices(temporary),
  );
  console.log('License drift and distribution-copy tests passed.');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
