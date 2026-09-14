const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.resolve(__dirname, '../src/renderer/PromptPlanStage.tsx'), 'utf8');

assert.ok(
  src.includes('issue.path?.match(/^branches\\.(\\d+)\\.leaves\\.(\\d+)(?:\\.|$)/)'),
  'Prompt Plan validation locations must derive branch and leaf indexes from issue.path',
);
assert.ok(
  src.includes('`Matrix ${leafIndex + 1}行目`'),
  'Prompt Plan validation locations must show the 1-based Matrix row',
);
assert.ok(
  src.includes('`Branch ${branch.id}`'),
  'Prompt Plan validation locations must show the branch id',
);
assert.ok(
  src.includes('`Leaf ${leaf.id}`'),
  'Prompt Plan validation locations must show the leaf id',
);
assert.ok(
  src.includes('issuesView(promptPlanIssues(plan, validation))'),
  'Prompt Plan warnings must be rendered with human-readable locations',
);

console.log('Prompt Plan warning location tests passed.');
