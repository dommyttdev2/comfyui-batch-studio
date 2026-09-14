const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(repo, 'src/main/main.ts'), 'utf8');
const ui = fs.readFileSync(path.join(repo, 'src/renderer/ExecutionStages.tsx'), 'utf8');

const handlerStart = main.indexOf('IPC.EXECUTION_RESTART_FROM_SCRATCH');
const handlerEnd = main.indexOf('IPC.CAPTION_STATUS', handlerStart);
assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, 'restart handler must exist');
const handler = main.slice(handlerStart, handlerEnd);

assert.match(handler, /listExecutionRuns\(root\)/, 'restart must inspect all persisted Runs');
assert.match(
  handler,
  /\['RUNNING', 'PAUSED', 'INTERRUPTED'\]/,
  'restart must cancel all active Run lifecycles',
);
assert.match(handler, /localExecutor\(\)\.forceInterrupt/, 'local execution must be cancellable');
assert.match(handler, /remoteSceneExecutor\(\)/, 'remote execution must be cancellable');
assert.match(
  handler,
  /await compileWorkflow\(root\);/,
  'latest prompt_plan must be compiled before the replacement Run starts',
);
assert.ok(
  handler.indexOf('await compileWorkflow(root);') <
    handler.indexOf('await startExecutionRun(root, async () => preflight);'),
  'workflow compilation must precede replacement Run creation',
);
assert.match(
  handler,
  /Localへ回収済みの成果物は削除しません/,
  'confirmation must state that collected local artifacts are preserved',
);

const restartFlagStart = ui.indexOf('const canRestartFromScratch');
const restartFlagEnd = ui.indexOf('const canStart', restartFlagStart);
assert.ok(restartFlagStart >= 0 && restartFlagEnd > restartFlagStart, 'restart UI gate must exist');
const restartFlag = ui.slice(restartFlagStart, restartFlagEnd);
assert.doesNotMatch(
  restartFlag,
  /preflight\?\.state === 'READY'/,
  'stale workflow/preflight must not hide the latest Prompt Plan restart path',
);
assert.match(
  ui,
  /最新のPrompt Planで最初から実行/,
  'Execution screen must expose the latest Prompt Plan restart action',
);

console.log('Latest Prompt Plan restart source checks passed.');
