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

    // A denied Windows replacement must never copy bytes over the previous primary.
    const protectedDir = path.join(dir, 'execution_runs');
    fs.mkdirSync(protectedDir);
    const runId = '11111111-1111-4111-8111-111111111111';
    const protectedFile = path.join(protectedDir, runId + '.json');
    await writeJsonAtomic(protectedFile, { state: 'verified-original' });
    await writeJsonAtomic(protectedFile, { state: 'verified-before-test' });
    const expected = fs.readFileSync(protectedFile, 'utf8');
    const backup = protectedFile + '.bak';
    assert.equal(JSON.parse(fs.readFileSync(backup, 'utf8')).state, 'verified-original');

    const fsPromises = require('node:fs/promises');
    const nativeIo = {
      rename: fsPromises.rename,
      copyFile: fsPromises.copyFile,
      writeFile: fsPromises.writeFile,
      readFile: fsPromises.readFile,
      unlink: fsPromises.unlink,
      mkdir: fsPromises.mkdir,
      delay: async () => {},
    };
    for (const code of ['EPERM', 'EBUSY', 'EACCES', 'ENOSPC']) {
      let attempts = 0;
      const deniedIo = {
        ...nativeIo,
        rename: async (source, destination) => {
          if (destination === protectedFile) {
            attempts++;
            throw Object.assign(new Error('injected replacement failure'), { code });
          }
          return fsPromises.rename(source, destination);
        },
      };
      await assert.rejects(
        () => writeJsonAtomic(protectedFile, { state: 'partial-risk' }, deniedIo),
        { code },
      );
      assert.equal(attempts, code === 'ENOSPC' ? 1 : 5);
      assert.equal(fs.readFileSync(protectedFile, 'utf8'), expected);
      assert.equal(fs.readFileSync(backup, 'utf8'), expected);
      assert.deepEqual(
        fs.readdirSync(protectedDir).filter((name) => name.endsWith('.tmp') || name.endsWith('.backup')),
        [],
        'failed writes must clean all stage files without touching the original',
      );
    }
    const failedWriteIo = {
      ...nativeIo,
      writeFile: async () => {
        throw Object.assign(new Error('injected full disk'), { code: 'ENOSPC' });
      },
    };
    await assert.rejects(
      () => writeJsonAtomic(protectedFile, { state: 'incomplete' }, failedWriteIo),
      { code: 'ENOSPC' },
    );
    assert.equal(fs.readFileSync(protectedFile, 'utf8'), expected);

    let failedReplacements = 0;
    const retryIo = {
      ...nativeIo,
      rename: async (source, destination) => {
        if (destination === protectedFile && failedReplacements++ < 2)
          throw Object.assign(new Error('transient Windows lock'), { code: 'EPERM' });
        return fsPromises.rename(source, destination);
      },
    };
    await writeJsonAtomic(protectedFile, { state: 'replacement-after-retry' }, retryIo);
    assert.equal((await readJson(protectedFile)).state, 'replacement-after-retry');
    assert.equal(fs.readFileSync(backup, 'utf8'), expected);

    // Malformed/missing/unreadable persisted records must not all become null.
    assert.equal(await readJson(path.join(protectedDir, 'missing.json')), null);
    fs.writeFileSync(protectedFile, '{truncated');
    await assert.rejects(() => readJson(protectedFile), { code: 'PERSISTED_JSON_CORRUPT' });
    await assert.rejects(
      () => writeJsonAtomic(protectedFile, { state: 'should-not-overwrite-corruption' }),
      { code: 'PERSISTED_JSON_CORRUPT' },
    );
    assert.equal(fs.readFileSync(protectedFile, 'utf8'), '{truncated');
    const { restoreJsonFromBackup } = await load('fs-utils.js');
    await restoreJsonFromBackup(protectedFile);
    assert.equal((await readJson(protectedFile)).state, 'verified-before-test');
    const unreadable = path.join(protectedDir, 'current.json');
    fs.mkdirSync(unreadable);
    await assert.rejects(() => readJson(unreadable), { code: 'PERSISTED_JSON_UNREADABLE' });
    await assert.rejects(
      () => writeJsonAtomic(unreadable, { runId }),
      { code: 'PERSISTED_JSON_UNREADABLE' },
    );
    fs.rmSync(unreadable, { recursive: true });
    const draft = path.join(dir, 'draft.json');
    fs.writeFileSync(draft, '{truncated');
    assert.equal(await readJson(draft), null, 'noncritical drafts preserve existing null semantics');

    // Settings and Run loaders must propagate critical corruption instead of resetting it.
    const metaRoot = path.join(dir, 'project-with-damaged-meta');
    fs.mkdirSync(metaRoot);
    const meta = path.join(metaRoot, 'project_meta.json');
    fs.writeFileSync(meta, '{damaged');
    const projectMeta = await load('project-meta.js');
    await assert.rejects(() => projectMeta.saveProjectSettings(metaRoot, { r2Bucket: 'new' }), {
      code: 'PERSISTED_JSON_CORRUPT',
    });
    assert.equal(fs.readFileSync(meta, 'utf8'), '{damaged');
    const runService = await load('execution-run.js');
    const damagedRun = path.join(metaRoot, 'execution_runs', runId + '.json');
    fs.mkdirSync(path.dirname(damagedRun));
    fs.writeFileSync(damagedRun, '{damaged');
    await assert.rejects(() => runService.getExecutionRun(metaRoot, runId), {
      code: 'PERSISTED_JSON_CORRUPT',
    });

    console.log('fs-utils atomic write tests passed.');
  } finally {
    fs.rmSync(runtime, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
