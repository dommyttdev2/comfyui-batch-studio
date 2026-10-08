const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (file.endsWith('.ts')) {
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) {
        const target = match[1];
        const resolved = path.resolve(path.dirname(file), target);
        if (
          target.startsWith('.')
            ? !['server', 'domain', 'application'].some((layer) =>
                resolved.startsWith(path.join(root, 'src', layer) + path.sep),
              )
            : !target.startsWith('node:') &&
              target !== 'ws' &&
              !(target === 'ssh2' && file === path.join(root, 'src/server/ssh-resources.ts'))
        )
          throw new Error('Forbidden server dependency: ' + file + ': ' + target);
      }
      if (
        /\b(?:ipcMain|WebContentsView|BrowserWindow|nativeImage|safeStorage)\b|import\s*\(|require\s*\(/.test(
          source,
        )
      )
        throw new Error('Desktop/dynamic dependency in server: ' + file);
    }
  }
}
walk(path.join(root, 'src/server'));
console.log('Server dependencies exclude Desktop and renderer.');
