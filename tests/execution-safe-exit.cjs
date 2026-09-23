const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(repo, name), 'utf8');
const main = read('src/main/main.ts');
const app = read('src/renderer/App.tsx');
const execution = read('src/renderer/ExecutionStages.tsx');
const run = read('src/main/execution-run.ts');
const ipc = read('src/shared/ipc.ts');
const preload = read('src/preload/index.cjs');

assert.match(main, /window\.on\('close', \(event\) => \{/);
assert.match(main, /event\.preventDefault\(\);/);
assert.match(main, /confirmRunStopBeforeLeave\(state\.projectRoot, window/);
assert.match(main, /app\.on\('before-quit', \(event\) => \{/);
assert.match(
  main,
  /confirmRunStopBeforeLeave\(\s*state\.projectRoot,\s*state\.window,\s*'アプリケーションを終了する',?\s*\)/,
);
assert.match(main, /await executionCoordinator\.waitForSettled/);
assert.match(main, /await stopVastInstanceForExit/);
assert.match(main, /instance\.status === 'stopped'/);
assert.match(main, /if \(await runRequiresExitGuard\(root\)\)/);
assert.match(main, /comfy\.isPromptQueued\(promptId\)/);
assert.match(main, /comfy\.historyState\(history, promptId\) === 'pending'/);
assert.match(main, /await discardExecutionRun\(root, runId\)/);
assert.match(
  main,
  /restartable\.some\(\(candidate\) =>[\s\S]*?EXECUTION_RECOVERY_UNCERTAIN[\s\S]*?LOCAL_OUTPUT_COLLECTION_FAILED/,
);
assert.match(main, /executionCoordinator\.releaseReservation/);
assert.match(main, /isDirectLocalComfyRefused/);
assert.match(main, /url\.protocol !== 'http:'/);
assert.match(main, /127\.0\.0\.1/);
assert.match(main, /\[::1\]/);
assert.match(main, /run\.lifecycle === 'RUNNING'\s*\|\|\s*executionCoordinator\.hasActive\(ref\)/);
assert.match(main, /await comfy\.health\(\)/);
assert.match(main, /confirmOfflineLocalRunDiscard\(root, run, comfy, error, owner\)/);

assert.match(app, /await window\\.batchStudio\\.execution\\.leave\\(project\\.rootPath\\)/);
const leaveHandler = main.slice(
  main.indexOf('ipcMain.handle(IPC.EXECUTION_LEAVE'),
  main.indexOf('ipcMain.handle(IPC.EXECUTION_STOP_FOR_EDIT'),
);
assert.match(leaveHandler, /return true;/, 'stage browsing must always be allowed');
assert.doesNotMatch(leaveHandler, /confirmRunStopBeforeLeave/, 'stage browsing must not stop a Run');
assert.match(app, /<ReadOnlyStage readOnly=\\{viewOnly\\}>/);
assert.match(app, /stage !== '実行'/);
assert.match(app, /batchStudio\\.execution\\.status\\(project\\.rootPath\\)/);
assert.match(app, /window\\.setInterval\\(\\(\\) => void inspect\\(\\), 3000\\)/);
assert.match(app, /resetScope && !viewOnly/, 'reset actions must not be available while running');
assert.match(main, /async function ensureProjectWritable\\(root: string\\)/);
for (const channel of [
  'PROJECT_SAVE_SETTINGS',
  'PROJECT_SAVE_BRIEF',
  'ARTIFACT_SAVE_DRAFT',
  'ARTIFACT_IMPORT_GROK',
  'ARTIFACT_CONFIRM',
  'ARTIFACT_RESET_FROM',
  'PROMPT_PLAN_SAVE',
  'WORKFLOW_COMPILE',
  'THUMBNAIL_SAVE',
  'THUMBNAIL_EXPORT',
  'MARKETPLACE_SAVE',
  'MARKETPLACE_GENERATE',
]) {
  const match = main.match(new RegExp('IPC\\\\.' + channel + ',[\\\\s\\\\S]*?await ensureProjectWritable\\\\(root\\\\);'));
  assert.ok(match, channel + ' must reject writes while a Run is active');
}
assert.match(app, /onDiscarded=\{\(\) => \{/);
assert.match(execution, /現在のRunを破棄してモデル選定へ戻る/);
assert.match(execution, /batchStudio\.execution\.discardForEdit\(/);
assert.match(ipc, /EXECUTION_DISCARD_FOR_EDIT/);
assert.match(preload, /discardForEdit: \(r, id\)/);
assert.match(run, /UI expected=/);
assert.match(run, /API expected=/);
console.log('Execution exit and discard integration guard tests passed.');
