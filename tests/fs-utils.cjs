const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-fs-utils-'));
const compiled = path.join(runtime, 'compiled');
const tscBin = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(
  process.execPath,
  [tscBin, '-p', path.join(repo, 'tsconfig.electron.json'), '--outDir', compiled],
  { cwd: repo, stdio: 'inherit' },
);
const load = (relative) => import(pathToFileURL(path.join(compiled, 'main', relative)).href);

(async () => {
  try {
    const { writeTextAtomic, writeJsonAtomic, readJson } = await load('fs-utils.js');
    const dir = path.join(runtime, 'writes');
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, 'execution-run.json');

    const values = Array.from(
      { length: 32 },
      (_, index) =>
        JSON.stringify({ index, payload: String(index).padStart(4, '0') + 'x'.repeat(16 * 1024) }) +
        '\n',
    );
    await Promise.all(values.map((value) => writeTextAtomic(target, value)));
    const finalText = fs.readFileSync(target, 'utf8');
    assert.ok(
      values.includes(finalText),
      'concurrent atomic writes must leave one complete writer payload',
    );

    const leftovers = fs
      .readdirSync(dir)
      .filter((name) => name.startsWith('.execution-run.json.') && name.endsWith('.tmp'));
    assert.deepEqual(leftovers, [], 'atomic writes must clean unique temporary files');

    await writeJsonAtomic(target, { state: 'first' });
    await writeJsonAtomic(target, { state: 'second' });
    assert.deepEqual(
      await readJson(target),
      { state: 'second' },
      'existing JSON files must remain replaceable',
    );

    console.log('fs-utils atomic write tests passed.');
  } finally {
    fs.rmSync(runtime, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
