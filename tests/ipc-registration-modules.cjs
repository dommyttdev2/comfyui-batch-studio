const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readMainProcessSource, registrationModules } = require('./main-process-source.cjs');

const repo = path.resolve(__dirname, '..');
const rootRegistration = fs.readFileSync(
  path.join(repo, 'src', 'main', 'ipc-registration.ts'),
  'utf8',
);
const main = fs.readFileSync(path.join(repo, 'src', 'main', 'main.ts'), 'utf8');

const domains = [
  ['project.ts', 'registerProjectIpc', 'EDITOR_FLUSH_RESULT', 'FILE_SHOW_IN_FOLDER', 27],
  ['integration.ts', 'registerIntegrationIpc', 'CATALOG_STATUS', 'VASTAI_RESOLVE_SSH', 25],
  [
    'execution.ts',
    'registerExecutionIpc',
    'WORKFLOW_COMPILE',
    'EXECUTION_RESTART_FROM_SCRATCH',
    19,
  ],
  ['image.ts', 'registerImageIpc', 'FINAL_ARTIFACT_STATUS', 'MARKETPLACE_PICKER_COMMIT_RESULT', 50],
  ['storage.ts', 'registerStorageIpc', 'R2_SETTINGS', 'CLIPBOARD_WRITE_TEXT', 25],
  ['assistant.ts', 'registerAssistantIpc', 'ASSISTANT_GET_PROVIDER', 'GROK_OPEN_EXTERNAL', 28],
];

assert.deepEqual(
  registrationModules,
  domains.map(([file]) => file),
  'test aggregation order must follow production registration order',
);

const allHandlers = [];
for (const [file, registerName, firstChannel, lastChannel, expectedCount] of domains) {
  const source = fs.readFileSync(path.join(repo, 'src', 'main', 'ipc-registration', file), 'utf8');
  assert.match(source, new RegExp(`export function ${registerName}\\(`));
  assert.doesNotMatch(
    source,
    /from ['"]\.\.\/main\.js['"]/,
    `${file} must not have a runtime dependency back to main.ts`,
  );
  assert.match(
    source,
    /import type \{ IpcRegistrationDependencies \} from '\.\.\/ipc-registration\.js';/,
    `${file} must receive its Main dependencies explicitly`,
  );
  const handlers = [...source.matchAll(/handleIpc\(\s*IPC\.([A-Z0-9_]+)/g)].map(
    (match) => match[1],
  );
  assert.equal(handlers.length, expectedCount, `${file} handler count changed`);
  assert.equal(handlers[0], firstChannel, `${file} first registration changed`);
  assert.equal(handlers.at(-1), lastChannel, `${file} last registration changed`);
  allHandlers.push(...handlers);
}

assert.equal(allHandlers.length, 174, 'all invoke handlers must remain registered');
assert.equal(
  new Set(allHandlers).size,
  allHandlers.length,
  'domain registration modules must not register duplicate IPC handlers',
);
assert.doesNotMatch(
  rootRegistration,
  /handleIpc\(\s*IPC\./,
  'root registration module must only compose domain registrars',
);
assert.match(
  rootRegistration,
  /registerProjectIpc\(dependencies\)[\s\S]*registerIntegrationIpc\(dependencies\)[\s\S]*registerExecutionIpc\(dependencies\)[\s\S]*registerImageIpc\(dependencies\)[\s\S]*registerStorageIpc\(dependencies\)[\s\S]*registerAssistantIpc\(dependencies\)/,
  'domain registrars must preserve the historical registration order',
);
assert.match(
  main,
  /registerIpc\(createIpcRegistrationDependencies\(\)\)/,
  'main.ts must expose one traceable IPC registration entrypoint',
);
assert.match(
  main,
  /window\.on\('closed',[\s\S]*thumbnailPickerWindows\.delete\(contentsId\)/,
  'thumbnail picker registry must be cleaned when its Window closes',
);
assert.match(
  main,
  /window\.on\('closed',[\s\S]*marketplacePickerWindows\.delete\(contentsId\)/,
  'marketplace picker registry must be cleaned when its Window closes',
);
assert.match(
  main,
  /window\.on\('closed',[\s\S]*standaloneToolWindows\.delete\(tool\)/,
  'standalone integration Window registry must be cleaned on close',
);
assert.match(
  readMainProcessSource(repo),
  /handleIpc\(\s*IPC\.EDITOR_FLUSH_RESULT/,
  'aggregated Main source must include domain registration modules',
);

console.log('IPC domain registration, ordering, uniqueness and Window cleanup checks passed.');
