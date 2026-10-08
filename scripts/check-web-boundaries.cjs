const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../src/web');
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.tsx?$/.test(file)) {
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*)['"]([^'"]+)['"]/g)) {
        const target = match[1];
        if (
          target.startsWith('.')
            ? !path.resolve(path.dirname(file), target).startsWith(root + path.sep)
            : !['react', 'react-dom', 'react-dom/client'].includes(target)
        )
          throw Error('Forbidden Web dependency: ' + file + ': ' + target);
      }
      if (
        /\b(?:ipcRenderer|BrowserWindow|WebContentsView|require|process)\b|window\.api|import\s*\(/.test(
          source,
        )
      )
        throw Error('Desktop/server/dynamic dependency in Web: ' + file);
    }
  }
}
walk(root);
console.log('Web dependencies exclude Desktop, server and application implementation.');
