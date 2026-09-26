const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const sharedPath = path.join(repo, 'src', 'shared', 'ipc.ts');
const preloadPath = path.join(repo, 'src', 'preload', 'index.cjs');
const begin = '// BEGIN GENERATED IPC CHANNELS - edit src/shared/ipc.ts instead';
const end = '// END GENERATED IPC CHANNELS';

function sharedLiteral(source) {
  const match = source.match(/export const IPC = (\{[\s\S]*?\n\}) as const;/);
  if (!match) throw new Error('Unable to parse src/shared/ipc.ts');
  return match[1];
}

function generatedBlock(shared) {
  return `${begin}\nconst I = ${sharedLiteral(shared)};\n${end}`;
}

function replaceBlock(preload, block) {
  const start = preload.indexOf(begin);
  const finish = preload.indexOf(end);
  if (start >= 0 && finish > start) {
    return preload.slice(0, start) + block + preload.slice(finish + end.length);
  }
  const legacy = preload.match(/const I = \{[\s\S]*?\n\};/);
  if (!legacy) throw new Error('Unable to locate preload IPC constants');
  return preload.replace(legacy[0], block);
}

const shared = fs.readFileSync(sharedPath, 'utf8');
const preload = fs.readFileSync(preloadPath, 'utf8');
const expected = replaceBlock(preload, generatedBlock(shared));

if (process.argv.includes('--check')) {
  if (expected !== preload) {
    console.error(
      'Preload IPC constants are stale. Run: node scripts/generate-preload-ipc.cjs',
    );
    process.exitCode = 1;
  }
} else if (expected !== preload) {
  fs.writeFileSync(preloadPath, expected);
}
