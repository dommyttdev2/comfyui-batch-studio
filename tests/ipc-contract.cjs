const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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

for (const key of [
  'ASSISTANT_GET_PROVIDER',
  'ASSISTANT_SET_PROVIDER',
  'ASSISTANT_SET_CONTEXT',
  'ASSISTANT_CONTEXT',
  'ASSISTANT_CONTEXT_CHANGED',
  'ASSISTANT_SNAPSHOT',
  'ASSISTANT_SEND',
  'ASSISTANT_STOP_TURN',
  'ASSISTANT_NEW_CONVERSATION',
  'ASSISTANT_RESTORE_CONVERSATION',
  'ASSISTANT_MODELS',
  'ASSISTANT_SELECT_MODEL',
  'ASSISTANT_SET_VISIBLE',
  'ASSISTANT_SET_RATIO',
  'ASSISTANT_SET_DIVIDER_X',
  'AGENT_TASK_START',
  'AGENT_TASK_STOP',
  'AGENT_EVENT',
]) {
  assert.ok(expected[key], `Missing provider-neutral IPC channel: ${key}`);
}

assert.equal(
  Object.keys(expected).some((key) => key.startsWith('CODEX_') || key.startsWith('GROK_SET_')),
  false,
  'Provider-specific pane IPC channels must be removed',
);
assert.equal(
  Object.keys(expected).includes('AUTO_ARTIFACT_GROK_ARM'),
  false,
  'Grok Web artifact arming IPC must be removed',
);
assert.equal(
  Object.keys(expected).includes('GROK_TASK_BUILD'),
  false,
  'Grok Web prompt builder IPC must be removed',
);

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
          return undefined;
        },
        on: () => {},
        removeListener: () => {},
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
  await bridge.assistant.setVisible(true);
  assert.deepEqual(calls.at(-1), [expected.ASSISTANT_SET_VISIBLE, true]);
  await bridge.assistant.setRatio(0.5);
  assert.deepEqual(calls.at(-1), [expected.ASSISTANT_SET_RATIO, 0.5]);
  await bridge.assistant.setDividerScreenX(900);
  assert.deepEqual(calls.at(-1), [expected.ASSISTANT_SET_DIVIDER_X, 900]);

  const commonHandler = main.slice(
    main.indexOf('const validateAgentTaskRequest'),
    main.indexOf('ipcMain.handle(IPC.ASSISTANT_SET_VISIBLE'),
  );
  assert.match(commonHandler, /grokCliTaskRunner\.run/);
  assert.match(commonHandler, /codexCliTaskRunner\.run/);
  assert.match(commonHandler, /grokCliTaskRunner\.stop/);
  assert.match(commonHandler, /codexCliTaskRunner\.stop/);
  assert.doesNotMatch(commonHandler, /codexSendTask|codexStopTurn/);

  assert.match(main, /ipcMain\.handle\(IPC\.ASSISTANT_SET_VISIBLE/);
  assert.match(main, /state\.assistantVisible = visible === true/);
  assert.match(main, /ipcMain\.handle\(IPC\.ASSISTANT_SET_RATIO/);
  assert.match(main, /ipcMain\.handle\(IPC\.ASSISTANT_SET_DIVIDER_X/);
  assert.doesNotMatch(main, /IPC\.CODEX_|IPC\.GROK_SET_|IPC\.AUTO_ARTIFACT_GROK_ARM/);

  console.log('Provider-neutral IPC and assistant task routing tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
