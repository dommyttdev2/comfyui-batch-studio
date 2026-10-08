const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const digest = crypto.createHash('sha256');
function walk(relative) {
  for (const entry of fs
    .readdirSync(path.join(root, relative), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const name = relative + '/' + entry.name;
    if (entry.isDirectory()) walk(name);
    else digest.update(name).update(fs.readFileSync(path.join(root, name)));
  }
}
for (const dir of ['src/server', 'src/application', 'src/domain', 'schemas', 'templates'])
  walk(dir);
digest.update(fs.readFileSync(path.join(root, 'package-lock.json')));
fs.writeFileSync(
  path.join(root, 'dist-server/build.json'),
  JSON.stringify({ buildId: digest.digest('hex') }) + '\n',
);
