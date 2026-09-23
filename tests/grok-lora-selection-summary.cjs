const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { matchCode, doesNotMatchCode } = require('./source-match.cjs');

const read = (file) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
const stages = read('src/renderer/GrokStages.tsx');
const cards = read('src/renderer/SelectedModelCards.tsx');
const historyService = read('src/main/grok-lora-history.ts');
const artifactService = read('src/main/artifact-service.ts');
const notifications = read('src/renderer/ArtifactImportToast.tsx');
const app = read('src/renderer/App.tsx');
const autoImport = read('src/main/agent-artifact-import.ts');

matchCode(stages, /<SelectedModelCards/, 'current model selections must use Civitai cards');
doesNotMatchCode(
  stages,
  /<GrokLoraHistory/,
  'initial and revised selection histories must not appear in the model selection screen',
);
matchCode(stages, /projectRoot=\{project\.rootPath\}/, 'cards must check the current project');
matchCode(
  stages,
  /artifact\.importGrok\(project\.rootPath,'models',raw,stage\)/,
  'initial and revised LoRA imports must retain their explicit stage',
);
matchCode(
  artifactService,
  /const merged:any=\{\.\.\.base,loras:payload\.loras\}/,
  'each import must replace the prior selection rather than append to it',
);
matchCode(
  artifactService,
  /options\.automatic\|\|key==='models'/,
  'invalid manual LoRA imports must retain the previously selected models draft',
);
matchCode(
  stages,
  /if\(!r\.validation\.valid\)return r;/,
  'invalid manual LoRA imports must not replace the visible current selection',
);
matchCode(cards, /models\.loras\.map\(/, 'cards must show current models.json selections only');
matchCode(cards, /最終選定LoRA/, 'the single current LoRA list must have a clear heading');
matchCode(
  cards,
  /checkLoraFiles\(projectRoot,fileNames\)/,
  'current selected LoRA cards must check local and R2 availability',
);
matchCode(
  cards,
  /candidate\.id===selection\.fileId&&candidate\.name===selection\.fileName/,
  'Civitai presence must match the exact selected file',
);
matchCode(cards, /選定理由/, 'current Civitai cards must include selection rationale');
matchCode(cards, /配置確認中/, 'current cards must distinguish pending placement from missing');
matchCode(cards, /role==='lora'/, 'availability and reasons must only be shown for LoRAs');
matchCode(
  cards,
  /selection\.versionName/,
  'saved version must remain visible if catalog is missing',
);
matchCode(cards, /selection\.fileName/, 'saved filename must remain visible if catalog is missing');
matchCode(
  historyService,
  /readStage\(root,'models'\)/,
  'historical responses must remain available for stage state and diagnostics',
);
matchCode(
  historyService,
  /readStage\(root,'models-fix'\)/,
  'reselection history must remain stored without rendering it',
);

matchCode(stages, /useImportNotice\(\)/, 'manual imports must use the shared completion toast');
matchCode(
  stages,
  /imported\.validation\.valid&&imported\.missingRequirements\.length===0/,
  'invalid manual imports must never show a success toast',
);
matchCode(
  autoImport,
  /summary:result\.summary/,
  'automatic imports must retain the actual summary',
);
matchCode(
  app,
  /event\.phase!=='imported'/,
  'only newly imported automatic artifacts should trigger a success toast',
);
matchCode(
  app,
  /seenAutoImports\.current\.has\(key\)/,
  'replayed import events must not show duplicate toasts',
);
matchCode(
  app,
  /window\.batchStudio\.project\.scan\(notice\.root\)/,
  'the project must be refreshed before success is announced',
);
matchCode(notifications, /role="status"/, 'success notifications must be accessible');
matchCode(
  notifications,
  /下書きに保存しました（未確定）/,
  'import completion must not imply artifact confirmation',
);
matchCode(notifications, /5000/, 'success notices should disappear automatically');
assert.ok(notifications.includes("models: 'モデル選定'"));
assert.ok(notifications.includes("'models-fix': 'モデル再選定'"));
console.log('Latest LoRA cards and shared import notifications tests passed.');
