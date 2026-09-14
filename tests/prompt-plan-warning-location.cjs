const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.resolve(__dirname, '../src/renderer/PromptPlanStage.tsx'), 'utf8');

assert.match(
  src,
  /branches\\\.\\\(\\d\+\\\)\\\.leaves\\\.\\\(\\d\+\\\)/,
  'Prompt Plan validation locations must derive branch and leaf indexes from issue.path',
);
assert.match(
  src,
  /Matrix \\?\$\{leafIndex \+ 1\}行目/,
  'Prompt Plan validation locations must show the 1-based Matrix row',
);
assert.match(
  src,
  /Branch \\?\$\{branch\.id\}/,
  'Prompt Plan validation locations must show the branch id',
);
assert.match(
  src,
  /Leaf \\?\$\{leaf\.id\}/,
  'Prompt Plan validation locations must show the leaf id',
);
assert.match(
  src,
  /issuesView\(promptPlanIssues\(plan, validation\)\)/,
  'Prompt Plan warnings must be rendered with human-readable locations',
);

console.log('Prompt Plan warning location tests passed.');
