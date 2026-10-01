const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
  source('src/main/main.ts') + source('src/main/ipc-registration.ts'),
  /handleIpc\(IPC\.CODEX_GET_PROVIDER/,
  'The main process must register the provider lookup channel',
);
assert.match(
  app,
  /missingHandler: \/No handler registered for/,
  'A missing provider IPC handler should be recognized as a version mismatch',
);
assert.match(
  app,
  /providerRestoreFailure\?\.key === providerKey/,
  'Provider restoration failure must replace the infinite loading indicator',
);
assert.match(
  app,
  /if \(providerRestoreFailure\.missingHandler\) return;/,
  'Do not offer a futile IPC retry when the main process has no handler',
);
assert.match(
  app,
  /!providerRestoreFailure\.missingHandler && \([\s\S]*?onClick=\{retryProviderRestore\}/,
  'Only retry transient errors, not main-process version mismatches',
);
assert.match(
  app,
  /setProviderRestoreRevision\(\(revision\) => revision \+ 1\)/,
  'Retryable provider lookup failures must trigger a new request',
);
assert.match(
  app,
  /providerRestoreAttempts\.count > 0[\s\S]*?AIエージェントを再試行中/,
  'Show visible progress when reattempting a transient failure',
);
assert.match(
  app,
  /再試行\$\{providerRestoreAttempts\.count\}回目も失敗しました/,
  'Show a distinct, counted retry failure when the request fails again',
);
assert.match(
  app,
  /このエラーは再試行では解消しません/,
  'Tell the user that restarting the main process is required for missing IPC handlers',
);
assert.match(
  app,
  /setTemporaryGrokKey\(providerKey\)/,
  'An outdated main process must allow a temporary, explicit Grok stage view',
);
assert.match(
  app,
  /temporaryGrokKey !== null && temporaryGrokKey === providerKey/,
  'Temporary Grok must be scoped to a real AI stage and stay hidden when both keys are null',
);
assert.match(
  app,
  /const recoverTemporaryProvider = async \(\) =>[\s\S]*?getAssistantProvider\(contextStage\)[\s\S]*?setTemporaryGrokKey\(null\)/,
  'Temporary Grok must allow the saved provider to be restored without another app restart',
);
assert.match(
  app,
  /onClick=\{\(\) => void recoverTemporaryProvider\(\)\}/,
  'Temporary Grok warning must expose an in-place provider recovery action',
);
assert.match(
  app,
  /disabled=\{\s*paneProviderRoot !== providerKey \|\|\s*switchingProvider \|\|\s*temporaryGrokKey === providerKey\s*\}/,
  'Temporary Grok must not be silently persisted through the provider selector',
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
