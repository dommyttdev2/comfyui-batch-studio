const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readMainProcessSource } = require('./main-process-source.cjs');

const root = path.resolve(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// Regression: a malformed draft may be valid JSON but lack fields used by React.
const plan = JSON.stringify({
  schemaVersion: 2,
  common: { positive: {}, negative: {} },
  rootLoras: [],
  branches: [
    {
      id: 'b01',
      prompt: { positive: {}, negative: {} },
      leaves: [{ id: 'b01.001', prompt: { positive: {}, negative: {} } }],
    },
  ],
});
const malformed = JSON.parse(plan);
assert.equal(malformed.branches[0].loras, undefined);
assert.equal(malformed.branches[0].leaves[0].name, undefined);

const renderer = source('src/renderer/PromptPlanStage.tsx');
assert.match(renderer, /function isRenderablePromptPlan\(value: unknown\)/);
assert.match(renderer, /!Array\.isArray\(branch\.loras\)/);
assert.match(renderer, /typeof entry\.name === 'string'/);
assert.match(renderer, /if \(isRenderablePromptPlan\(parsed\)\) setPlan\(parsed\)/);
assert.match(renderer, /setValidation\(source\.validation\.issues\)/);
assert.match(renderer, /loadError && \(\s*<div className="issue error"/);

const app = source('src/renderer/App.tsx');
const boundary = source('src/renderer/StageErrorBoundary.tsx');
assert.match(app, /<StageErrorBoundary/);
assert.match(app, /<StageView[\s\S]+?<\/StageErrorBoundary>/);
assert.match(app, /setStageReloadRevision\(\(revision\) => revision \+ 1\)/);
assert.match(
  readMainProcessSource(root),
  /handleIpc\(IPC\.ASSISTANT_GET_PROVIDER/,
  'The main process must register the provider-neutral lookup channel',
);
assert.match(boundary, /getDerivedStateFromError/);
assert.match(boundary, /this\.props\.onRetry/);

const settings = source('src/renderer/ProjectStages.tsx');
const models = source('src/renderer/GrokStages.tsx');
const availability = source('src/renderer/ExecutionStages.tsx');
assert.match(settings, /setValidation\(r\.validation\.issues\)/);
assert.match(settings, /typeof \(p\.project as Record<string, unknown>\)\.title/);
assert.match(models, /Array\.isArray\(model\.loras\)/);
assert.match(availability, /setModelFileError/);
console.log('Stage loading/recovery regression checks passed');
