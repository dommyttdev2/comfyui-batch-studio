const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

/**
 * An Electron main process keeps running after its windows close while an
 * Execution Run is active. Rebuilding the on-disk renderer in that situation
 * can make a newer UI invoke IPC channels missing from the old main process.
 * Guard the on-disk app, not every electron.exe installed on the machine.
 */
function runningBatchStudioPids({
  platform = process.platform,
  executable = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
  exec = execFileSync,
} = {}) {
  if (platform !== 'win32') return [];
  const script = [
    "$ErrorActionPreference = 'Stop';",
    '$expected = [System.IO.Path]::GetFullPath($env:BATCH_STUDIO_ELECTRON_EXE);',
    'Get-CimInstance -ClassName Win32_Process -Filter "Name = \'electron.exe\'" |',
    '  Where-Object { $_.ExecutablePath -and $_.ExecutablePath.Equals($expected, [System.StringComparison]::OrdinalIgnoreCase) } |',
    '  Select-Object -ExpandProperty ProcessId',
  ].join(' ');
  const output = exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, BATCH_STUDIO_ELECTRON_EXE: path.resolve(executable) },
  });
  return output
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isSafeInteger(pid) && pid > 0);
}

function main() {
  let pids;
  try {
    pids = runningBatchStudioPids();
  } catch (error) {
    console.error('[ERROR] Batch Studioの実行状態を確認できません。ビルドを中止します。');
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
  if (!pids.length) return;
  console.error('[ERROR] ComfyUI Batch Studioが起動中です。更新・ビルドは実行できません。');
  console.error(`[INFO] 同一アプリのElectronプロセス: ${pids.join(', ')}`);
  console.error(
    '実行中のRunを確認し、Batch Studioを「終了」してから再実行してください。' +
      '他のElectronアプリやプロジェクトデータを削除しないでください。',
  );
  process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { runningBatchStudioPids };
