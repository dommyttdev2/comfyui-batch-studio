const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const validationSrc = fs.readFileSync(path.resolve(__dirname, '../src/main/validation.ts'), 'utf8');
const uiSrc = fs.readFileSync(path.resolve(__dirname, '../src/renderer/ui.tsx'), 'utf8');
const promptPlanSrc = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/PromptPlanStage.tsx'),
  'utf8',
);

assert.ok(
  validationSrc.includes('function annotatePromptPlanLeafLocations('),
  'Prompt Plan validation must attach display locations at the validator boundary',
);
assert.ok(
  validationSrc.includes('`Matrix ${leafIndex + 1}行目`'),
  'Prompt Plan validation locations must use 1-based Matrix rows',
);
assert.ok(
  validationSrc.includes('annotatePromptPlanLeafLocations(i, branches)'),
  'Prompt Plan v2 validation must annotate issues before returning them',
);
assert.ok(
  uiSrc.includes("i.location ? `[${i.location}] ` : ''"),
  'Generic issue rendering must show validator-provided locations',
);
assert.ok(
  promptPlanSrc.includes('issuesView(validation)'),
  'Prompt Plan must use the same generic issue renderer as Grok import results',
);
assert.ok(
  !promptPlanSrc.includes('function promptPlanIssueLocation('),
  'Prompt Plan must not depend on a stage-local location formatter',
);

console.log('Prompt Plan warning location tests passed.');
