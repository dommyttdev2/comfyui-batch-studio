const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { readMainProcessSource } = require('./main-process-source.cjs');

const repo = path.resolve(__dirname, '..');
const shared = fs.readFileSync(path.join(repo, 'src/shared/ipc.ts'), 'utf8');
const preload = fs.readFileSync(path.join(repo, 'src/preload/index.cjs'), 'utf8');
const main = readMainProcessSource(repo);
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
const handles = keySet(main, /handleIpc\(\s*IPC\.([A-Z0-9_]+)/g);
const sends = keySet(main, /\.send\(\s*IPC\.([A-Z0-9_]+)/g);

for (const key of invokes) {
  assert.ok(expected[key], `Unknown invoked IPC key: ${key}`);
  assert.ok(handles.has(key), `Renderer invoke lacks Main handler: ${key}`);
  assert.equal(listens.has(key), false, `IPC direction is ambiguous (invoke + event): ${key}`);
}
for (const key of listens) {
  assert.ok(expected[key], `Unknown listened IPC key: ${key}`);
  assert.ok(sends.has(key), `Renderer event listener lacks Main sender: ${key}`);
  assert.equal(
    handles.has(key),
    false,
    `Event-only IPC must not be registered as an invoke handler: ${key}`,
  );
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
  await bridge.assistant.startTask('project-root', 'story-finalize', 'make it concise');
  assert.deepEqual(calls.at(-1), [
    expected.AGENT_TASK_START,
    'project-root',
    'story-finalize',
    'make it concise',
  ]);
  await bridge.assistant.stopTask('project-root', 'story-finalize');
  assert.deepEqual(calls.at(-1), [expected.AGENT_TASK_STOP, 'project-root', 'story-finalize']);

  const commonHandler = main.slice(main.indexOf('export function registerAssistantIpc'));
  assert.match(commonHandler, /tasks: \{ codex: codexCliTaskRunner, grok: grokCliTaskRunner \}/);
  assert.match(commonHandler, /commands\.startTask\(/);
  assert.match(commonHandler, /commands\.stopTask\(/);
  console.log('IPC contract and provider-neutral agent task routing tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
