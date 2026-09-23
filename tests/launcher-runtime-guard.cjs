const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runningBatchStudioPids } = require('../scripts/check-running-batch-studio.cjs');

const expectedExecutable = path.resolve('node_modules/electron/dist/electron.exe');
let calls = 0;
const active = runningBatchStudioPids({
  platform: 'win32',
  executable: expectedExecutable,
  exec: (command, args, options) => {
    calls++;
    assert.equal(command, 'powershell.exe');
    assert.ok(args.includes('-NonInteractive'));
    assert.match(
      args.at(-1),
      /\$ErrorActionPreference = 'Stop';\s+\$expected = [^;]+;\s+Get-CimInstance/,
      'PowerShell statements must be separated before the process-discovery pipeline',
    );
    assert.match(args.at(-1), /Get-CimInstance/);
    assert.match(args.at(-1), /ExecutablePath/);
    assert.match(args.at(-1), /OrdinalIgnoreCase/);
    assert.equal(options.env.BATCH_STUDIO_ELECTRON_EXE, expectedExecutable);
    return '4312\r\n4028\r\n';
  },
});
assert.deepEqual(active, [4312, 4028]);
if (process.platform === 'win32') {
  assert.doesNotThrow(
    () =>
      runningBatchStudioPids({
        platform: 'win32',
        executable: path.join(process.env.TEMP || process.cwd(), 'nonexistent-batch-studio.exe'),
      }),
    'Validate the actual PowerShell command on Windows, not only a mocked process list',
  );
}
assert.equal(calls, 1);
assert.deepEqual(
  runningBatchStudioPids({
    platform: 'win32',
    exec: () => '',
  }),
  [],
);
assert.deepEqual(
  runningBatchStudioPids({
    platform: 'linux',
    exec: () => {
      throw new Error('Non-Windows hosts should not invoke PowerShell');
    },
  }),
  [],
);
assert.throws(
  () =>
    runningBatchStudioPids({
      platform: 'win32',
      exec: () => {
        throw new Error('WMI unavailable');
      },
    }),
  /WMI unavailable/,
  'Process-detection errors must prevent potentially unsafe rebuilds',
);

const launcher = fs.readFileSync(path.resolve(__dirname, '..', 'run.bat'), 'utf8');
const checkIndex = launcher.indexOf('node scripts\\check-running-batch-studio.cjs');
const installIndex = launcher.indexOf('call npm install');
assert.ok(checkIndex !== -1 && installIndex > checkIndex);
assert.match(
  launcher.slice(checkIndex, installIndex),
  /if errorlevel 1 \([\s\S]*?exit \/b 1/,
  'run.bat must stop before mutating dependencies or runtime files',
);
const scripts = require('../package.json').scripts;
for (const name of ['predev', 'prebuild:renderer', 'prebuild:electron', 'prestart']) {
  assert.equal(scripts[name], 'node scripts/check-running-batch-studio.cjs', name);
}

console.log('Launcher/runtime mismatch regression checks passed');
