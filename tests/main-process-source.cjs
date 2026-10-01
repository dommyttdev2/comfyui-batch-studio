const fs = require('node:fs');
const path = require('node:path');

const registrationModules = [
  'project.ts',
  'integration.ts',
  'execution.ts',
  'image.ts',
  'storage.ts',
  'assistant.ts',
];

function readMainProcessSource(repo) {
  const sources = [
    path.join(repo, 'src', 'main', 'main.ts'),
    path.join(repo, 'src', 'main', 'ipc-registration.ts'),
    ...registrationModules.map((file) =>
      path.join(repo, 'src', 'main', 'ipc-registration', file),
    ),
  ];
  return sources.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
}

module.exports = { readMainProcessSource, registrationModules };
