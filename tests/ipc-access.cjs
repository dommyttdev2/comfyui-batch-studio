const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const repo = path.resolve(__dirname, '..');
const mainSource = fs.readFileSync(path.join(repo, 'src', 'main', 'main.ts'), 'utf8');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-ipc-access-'));
const tscBin = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(
  process.execPath,
  [tscBin, '-p', path.join(repo, 'tsconfig.electron.json'), '--outDir', runtime],
  { cwd: repo, stdio: 'inherit' },
);

(async () => {
  const access = await import(pathToFileURL(path.join(runtime, 'main', 'ipc-access.js')).href);
  const { IPC } = await import(pathToFileURL(path.join(runtime, 'shared', 'ipc.js')).href);

  const registeredKeys = [...mainSource.matchAll(/handleIpc\(\s*IPC\.([A-Z0-9_]+)/g)].map(
    (match) => match[1],
  );
  assert.equal(registeredKeys.length, new Set(registeredKeys).size, 'IPC handlers must be unique');

  const registeredChannels = registeredKeys.map((key) => IPC[key]).sort();
  assert.deepEqual(
    access.definedIpcAccessChannels(),
    registeredChannels,
    'every registered invoke handler must have exactly one access policy',
  );

  const projectA = path.join(os.tmpdir(), 'ipc-project-a');
  const projectB = path.join(os.tmpdir(), 'ipc-project-b');
  const localA = { kind: 'project-local', projectRoot: projectA };
  const thumbnailA = { kind: 'thumbnail-picker', projectRoot: projectA };
  const marketplaceA = { kind: 'marketplace-picker', projectRoot: projectA };

  assert.deepEqual(access.authorizeIpcAccess(IPC.PROJECT_SCAN, localA, [projectA]), {
    writeRoot: null,
  });
  assert.throws(
    () => access.authorizeIpcAccess(IPC.PROJECT_SCAN, localA, [projectB]),
    /Project.*一致しません/,
    'a project Window must not operate on another Window project root',
  );
  assert.throws(
    () =>
      access.authorizeIpcAccess(IPC.APP_SETTINGS_GET, { kind: 'unknown', projectRoot: null }, []),
    /現在のWindow/,
    'unregistered WebContents must be denied',
  );

  assert.deepEqual(access.authorizeIpcAccess(IPC.THUMBNAIL_LIST_IMAGES, thumbnailA, [projectA]), {
    writeRoot: null,
  });
  assert.throws(
    () => access.authorizeIpcAccess(IPC.THUMBNAIL_LIST_IMAGES, marketplaceA, [projectA]),
    /現在のWindow/,
    'marketplace picker may not impersonate the thumbnail picker',
  );
  assert.deepEqual(
    access.authorizeIpcAccess(IPC.MARKETPLACE_READ_SOURCE_PREVIEW, marketplaceA, [projectA]),
    { writeRoot: null },
  );

  assert.equal(
    access.authorizeIpcAccess(IPC.PROJECT_SAVE_SETTINGS, localA, [projectA]).writeRoot,
    projectA,
    'project mutation policies must request the shared Run/write guard',
  );
  assert.equal(
    access.authorizeIpcAccess(IPC.THUMBNAIL_PICKER_COMMIT, thumbnailA, []).writeRoot,
    projectA,
    'picker commit must inherit the owning project write guard',
  );
  assert.equal(
    access.authorizeIpcAccess(IPC.EXECUTION_STOP_SCHEDULING, localA, [projectA, 'run']).writeRoot,
    null,
    'Execution controls must keep their specialized Run-state guard rather than self-blocking',
  );

  assert.deepEqual(access.authorizeIpcAccess(IPC.R2_SETTINGS, { kind: 'tool-r2' }, []), {
    writeRoot: null,
  });
  assert.throws(
    () => access.authorizeIpcAccess(IPC.VASTAI_SETTINGS, { kind: 'tool-r2' }, []),
    /現在のWindow/,
    'standalone tools must not cross service boundaries',
  );
  assert.deepEqual(access.authorizeIpcAccess(IPC.VASTAI_SETTINGS, { kind: 'tool-vastai' }, []), {
    writeRoot: null,
  });

  assert.match(
    mainSource,
    /function handleIpc<[\s\S]*authorizeIpcAccess\(channel,\s*sender,\s*args\)[\s\S]*ensureProjectWritable\(decision\.writeRoot\)/,
    'Main must enforce the common authorization and project write guard before handlers',
  );
  assert.match(
    mainSource,
    /THUMBNAIL_READ_PREVIEW[\s\S]*validateThumbnailPickerImage\(thumbnailPickerForSender\(contents\),args\[0\]\)/,
    'thumbnail picker preview paths must be authorized before cache reads',
  );
  assert.match(
    mainSource,
    /validateThumbnailPickerImage[\s\S]*assertFinalArtifactImage\(state\.root,imagePath\)/,
    'thumbnail picker paths must use the final-artifact realpath scope check',
  );
  assert.equal(
    (mainSource.match(/ipcMain\.handle\(/g) ?? []).length,
    1,
    'only the common wrapper may register ipcMain.handle directly',
  );

  console.log('IPC sender, project-root, write and picker access policy tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
