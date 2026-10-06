const fs = require('node:fs');
const path = require('node:path');
function inspectCore(base = path.resolve(__dirname, '..')) {
  const problems = [],
    files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.ts$/.test(file)) files.push(file);
    }
  }
  walk(path.join(base, 'src/domain'));
  walk(path.join(base, 'src/application'));
  for (const file of files) {
    const layer = file.includes(path.sep + 'domain' + path.sep) ? 'domain' : 'application';
    const source = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    for (const match of source.matchAll(/\b(?:from\s*|import\s*)['"]([^'"]+)['"]/g)) {
      const value = match[1],
        resolved = path.resolve(path.dirname(file), value);
      if (
        !value.startsWith('.') ||
        (!resolved.startsWith(path.join(base, 'src/domain') + path.sep) &&
          !(
            layer === 'application' &&
            resolved.startsWith(path.join(base, 'src/application') + path.sep)
          ))
      )
        problems.push(file + ': forbidden import ' + value);
    }
    const code = source.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, '');
    if (/(?:\bimport\s*\(|\b(?:require|eval|Function)\b)/.test(code))
      problems.push(file + ': dynamic code/module loading');
    if (
      /\b(window|document|process|Buffer|Date|fetch|XMLHttpRequest|WebSocket|ipcMain|webContents|dialog|shell|setTimeout)\b/.test(
        code,
      )
    )
      problems.push(file + ': platform symbol');
    if (/\bMath\.random\s*\(/.test(code)) problems.push(file + ': non-injected randomness');
    if (/\bimport\s+[A-Za-z_$][\w$]*\s*=/.test(code)) problems.push(file + ': import assignment');
  }
  return problems;
}
module.exports = { inspectCore };
if (require.main === module) {
  const problems = inspectCore();
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exitCode = 1;
  } else console.log('Business core dependency boundaries passed.');
}
