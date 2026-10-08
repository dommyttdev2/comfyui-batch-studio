const fs = require('node:fs');
const path = require('node:path');
const { checkNotices } = require('./generate-third-party-notices.cjs');

function copyLicenseFiles(root) {
  checkNotices(root);
  const electron = path.join(root, 'node_modules/electron/dist');
  const mappings = [
    ['LICENSE', 'dist-electron/LICENSE'],
    ['THIRD_PARTY_NOTICES.md', 'dist-electron/THIRD_PARTY_NOTICES.md'],
    [path.join(electron, 'LICENSE'), 'dist-electron/licenses/electron/LICENSE'],
    [
      path.join(electron, 'LICENSES.chromium.html'),
      'dist-electron/licenses/electron/LICENSES.chromium.html',
    ],
  ];
  for (const [source] of mappings) {
    if (!fs.existsSync(path.resolve(root, source)))
      throw new Error('Required distribution license is missing: ' + source);
  }
  for (const [source, destination] of mappings) {
    const output = path.join(root, destination);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.copyFileSync(path.resolve(root, source), output);
  }
}

module.exports = { copyLicenseFiles };
