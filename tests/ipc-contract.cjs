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
assert.match(
  preload,
  /BEGIN GENERATED IPC CHANNELS - edit src\/shared\/ipc\.ts instead/,
  'Preload IPC constants must be generated from the shared contract',
);
assert.deepEqual(
  Object.keys(actual).sort(),
  Object.keys(expected).sort(),
  'Every IPC key must exist in Preload',
);
for (const key of Object.keys(expected))
  assert.equal(actual[key], expected[key], `IPC channel mismatch: ${key}`);

const keySet = (source, pattern) => new Set([...source.matchAll(pattern)].map((match) => match[1]));
const invokes = keySet(preload, /ipcRenderer\.invoke\(I\.([A-Z0-9_]+)/g);
const listens = keySet(preload, /ipcRenderer\.on\(I\.([A-Z0-9_]+)/g);
const handles = keySet(main, /ipcMain\.handle\(\s*IPC\.([A-Z0-9_]+)/g);
const sends = keySet(main, /\.send\(\s*IPC\.([A-Z0-9_]+)/g);

for (const key of invokes) {
  assert.ok(expected[key], `Unknown invoked IPC key: ${key}`);
  assert.ok(handles.has(key), `Renderer invoke lacks Main handler: ${key}`);
  assert.equal(listens.has(key), false, `IPC direction is ambiguous (invoke + event): ${key}`);
}
for (const key of listens) {
  assert.ok(expected[key], `Unknown listened IPC key: ${key}`);
  assert.ok(sends.has(key), `Renderer event listener lacks Main sender: ${key}`);
  assert.equal(handles.has(key), false, `Event-only IPC must not be registered as an invoke handler: ${key}`);
}
for (const key of handles) assert.ok(expected[key], `Main handler uses unknown IPC key: ${key}`);
for (const key of sends) assert.ok(expected[key], `Main sender uses unknown IPC key: ${key}`);

const used = new Set([...invokes, ...listens, ...handles, ...sends]);
for (const key of Object.keys(expected))
  assert.ok(used.has(key), `IPC contract key is not used by Main or Preload: ${key}`);

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
  console.log(
    `IPC contract passed: ${invokes.size} invoke channels, ${listens.size} event channels; Codex routing passed.`,
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
