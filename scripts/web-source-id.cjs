const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
function id() {
  const digest = crypto.createHash('sha256');
  function walk(dir) {
    for (const entry of fs
      .readdirSync(path.join(root, dir), { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const name = dir + '/' + entry.name;
      if (entry.isDirectory()) walk(name);
      else digest.update(name).update(fs.readFileSync(path.join(root, name)));
    }
  }
  walk('src/web');
  walk('web');
  return digest.digest('hex');
}
module.exports = id;
if (require.main === module) process.stdout.write(id());
