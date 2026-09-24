const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const repo = path.resolve(__dirname, '..');
const shared = fs.readFileSync(path.join(repo, 'src/shared/ipc.ts'), 'utf8');
const preload = fs.readFileSync(path.join(repo, 'src/preload/index.cjs'), 'utf8');
const main = fs.readFileSync(path.join(repo, 'src/main/main.ts'), 'utf8');
function constants(source, marker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Missing ${marker}`);
  const literal = source.slice(start + marker.length).match(/^\s*(\{[\s\S]*?\n\})(?: as const)?;/);
  assert.ok(literal, `Cannot parse ${marker}`);
  return vm.runInNewContext(`(${literal[1]})`);
}
const expected = constants(shared, 'export const IPC =');
const actual = constants(preload, 'const I =');
assert.deepEqual(
  Object.keys(actual).sort(),
  Object.keys(expected).sort(),
  'Every IPC key must exist in Preload',
);
for (const key of Object.keys(expected))
  assert.equal(actual[key], expected[key], `IPC channel mismatch: ${key}`);

const events = new EventEmitter();
const calls = [];
let bridge;
vm.runInNewContext(preload, {
  require: (name) => {
    assert.equal(name, 'electron');
    return {
      contextBridge: {
        exposeInMainWorld: (_name, value) => {
          bridge = value;
        },
      },
      ipcRenderer: {
        invoke: async (...args) => {
          calls.push(args);
        },
        on: (channel, listener) => events.on(channel, listener),
        removeListener: (channel, listener) => events.removeListener(channel, listener),
      },
    };
  },
});
(async () => {
  await bridge.codex.selectStageTask('project-root', 'execution');
  assert.deepEqual(calls.at(-1), [expected.CODEX_SELECT_STAGE_TASK, 'project-root', 'execution']);
  const selected = [];
  const remove = bridge.codex.onStageTaskSelected((stage) => selected.push(stage));
  events.emit(expected.CODEX_STAGE_TASK_SELECTED, {}, 'execution');
  remove();
  events.emit(expected.CODEX_STAGE_TASK_SELECTED, {}, 'caption');
  assert.deepEqual(selected, ['execution']);
  const handler = main.slice(
    main.indexOf('ipcMain.handle(IPC.CODEX_SELECT_STAGE_TASK'),
    main.indexOf('ipcMain.handle(IPC.CODEX_STATUS'),
  );
  assert.match(handler, /event\.sender\.id !== state\.localView\.webContents\.id/);
  assert.match(
    handler,
    /state\.codexView\.webContents\.send\(IPC\.CODEX_STAGE_TASK_SELECTED, stage\)/,
  );
  console.log('IPC contract and Codex stage task routing tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
