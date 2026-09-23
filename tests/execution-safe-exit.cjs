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

assert.match(app, /await window\.batchStudio\.execution\.leave\(project\.rootPath\)/);
assert.doesNotMatch(app, /onDiscarded=\\{\\(\\) => \\{/);
assert.match(execution, /現在のRunを破棄/);
assert.doesNotMatch(execution, /現在のRunを破棄してモデル選定へ戻る/);
assert.doesNotMatch(execution, /別のRunとして実行する/);
assert.match(execution, /一時停止を要求中…/);
assert.match(execution, /一時停止中です/);
assert.match(execution, /再開/);
assert.match(execution, /batchStudio\.execution\.discardForEdit\(/);
assert.match(ipc, /EXECUTION_DISCARD_FOR_EDIT/);
assert.match(preload, /discardForEdit: \(r, id\)/);
assert.match(run, /UI expected=/);
assert.match(run, /API expected=/);
console.log('Execution exit and discard integration guard tests passed.');
