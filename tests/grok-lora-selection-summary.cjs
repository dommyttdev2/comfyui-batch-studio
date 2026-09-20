const assert = require('node:assert/strict');
const { matchCode, doesNotMatchCode } = require('./source-match.cjs');
const fs = require('node:fs');
const path = require('node:path');
const stages = fs.readFileSync(path.resolve(__dirname, '../src/renderer/GrokStages.tsx'), 'utf8');
const historyUi = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/GrokLoraHistory.tsx'),
  'utf8',
);
const historyService = fs.readFileSync(
  path.resolve(__dirname, '../src/main/grok-lora-history.ts'),
  'utf8',
);
const artifactService = fs.readFileSync(
  path.resolve(__dirname, '../src/main/artifact-service.ts'),
  'utf8',
);
const availability = fs.readFileSync(
  path.resolve(__dirname, '../src/main/availability.ts'),
  'utf8',
);
const preload = fs.readFileSync(path.resolve(__dirname, '../src/preload/index.cjs'), 'utf8');
const main = fs.readFileSync(path.resolve(__dirname, '../src/main/main.ts'), 'utf8');

matchCode(
  stages,
  /import \{ GrokLoraHistory \}/,
  'Models stage must use the persisted LoRA history component',
);
matchCode(
  stages,
  /stage="models" title="LoRAを選定"[\s\S]*?<GrokLoraHistory project=\{project\} stage="models"/,
  'initial selection history must render directly below the provider-neutral initial stage',
);
matchCode(
  stages,
  /stage="models-fix" title="LoRAを再選定"[\s\S]*?<GrokLoraHistory project=\{project\} stage="models-fix"/,
  'reselection history must render directly below the provider-neutral reselection stage',
);
matchCode(
  stages,
  /onImport=\{raw=>importModels\(raw,'models'\)\}/,
  'initial import must explicitly persist to the initial selection stage',
);
matchCode(
  stages,
  /onImport=\{raw=>importModels\(raw,'models-fix'\)\}/,
  'reselection import must explicitly persist to the reselection stage',
);
matchCode(
  stages,
  /artifact\.importGrok\(project\.rootPath,'models',raw,stage\)/,
  'LoRA import must forward the explicit Grok stage',
);
matchCode(
  stages,
  /setHistoryRevision\(x=>x\+1\)/,
  'history must refresh immediately after importing a Grok return file',
);
doesNotMatchCode(
  stages,
  /function SelectedLorasPanel/,
  'single current-selection panel must be removed',
);

matchCode(
  historyUi,
  /artifact\.grokLoraHistory\(project\.rootPath\)/,
  'history must reload from persisted project data',
);
matchCode(
  historyUi,
  /function visibleStageEntries/,
  'history must have explicit stage visibility semantics',
);
matchCode(
  historyUi,
  /stage==='models'&&matching\.length\?matching\.slice\(-1\):matching/,
  'initial selection must show the latest imported result as selection 1 while reselections keep their progression',
);
matchCode(
  historyUi,
  /stage==='models'\?'選定':'再選定'/,
  'history must label initial and reselection progression separately',
);
matchCode(
  historyUi,
  /再取り込み時はこの「選定 1」を更新します/,
  'initial selection copy must explain that repeated imports replace selection 1',
);
matchCode(historyUi, /lora\.fileName/, 'history must show each selected file name');
matchCode(
  historyUi,
  /catalog\.openModel\(\s*`https:\/\/civitai\.com\/models\/\$\{lora\.modelId\}\?modelVersionId=\$\{lora\.versionId\}\`/,
  'each selected and reselected LoRA must link to its exact Civitai model version',
);
matchCode(
  stages,
  /catalog\.openModel\(\s*`https:\/\/civitai\.com\/models\/\$\{value\.modelId\}\?modelVersionId=\$\{value\.versionId\}\`/,
  'selected base model must link to its exact Civitai model version',
);
matchCode(historyUi, /thumbnailUrl/, 'history must resolve a Civitai thumbnail');
matchCode(historyUi, /ローカル/, 'history must expose local presence');
matchCode(historyUi, /\bR2\b/, 'history must expose R2 presence');
matchCode(historyUi, /Civitai Collection/, 'history must expose Civitai Collection presence');
matchCode(historyUi, /いずれにもない/, 'history must expose the nowhere indicator');
matchCode(
  historyUi,
  /item\.modelId!==lora\.modelId/,
  'Civitai presence must match the selected model identity',
);
matchCode(
  historyUi,
  /v=>v\.versionId===lora\.versionId/,
  'Civitai presence must match the selected version identity',
);
matchCode(
  historyUi,
  /f=>f\.id===lora\.fileId&&f\.name===lora\.fileName/,
  'Civitai presence must match the selected file identity',
);
matchCode(
  historyUi,
  /availability\.checkLoraFiles\(project\.rootPath,fileNames\)/,
  'historical LoRAs must use current local/R2 availability',
);
matchCode(
  historyUi,
  /catalog\?\.generation,catalog\?\.generatedAt/,
  'history must re-evaluate when a Civitai catalog sync changes the current catalog',
);
matchCode(
  historyUi,
  /setPlacements\(null\)/,
  'history must mark placement state stale while re-evaluating after catalog refresh',
);

matchCode(
  historyService,
  /grok-responses/,
  'history must use persisted Grok responses as its source',
);
matchCode(
  historyService,
  /readStage\(root,'models'\)/,
  'initial selections must be restored after restart',
);
matchCode(
  historyService,
  /readStage\(root,'models-fix'\)/,
  'reselection history must be restored after restart',
);
matchCode(
  historyService,
  /payload\.loras\.every\(validLora\)/,
  'invalid responses must not become selection history',
);
matchCode(
  artifactService,
  /stageOverride\?:GrokResponseStage/,
  'artifact import must accept an explicit response stage',
);
matchCode(
  artifactService,
  /stageMatchesKey\(key,stage\)/,
  'artifact import must reject a stage that belongs to another artifact',
);
matchCode(
  artifactService,
  /stageOverride\?\?inferred/,
  'legacy imports must retain the existing inferred-stage fallback',
);
matchCode(
  preload,
  /importGrok:\(r,k,x,s\)=>ipcRenderer\.invoke\(I\.ARTIFACT_IMPORT_GROK,r,k,x,s\)/,
  'preload must forward the explicit Grok stage',
);
matchCode(preload, /ARTIFACT_GROK_LORA_HISTORY/, 'preload must expose persisted history');
matchCode(
  preload,
  /AVAILABILITY_CHECK_LORA_FILES/,
  'preload must expose historical placement checks',
);
matchCode(
  main,
  /stage!==undefined&&stage!=='models'&&stage!=='models-fix'/,
  'main process must validate the explicit LoRA Grok stage',
);
matchCode(
  main,
  /importGrok\(root,key,raw,stage\)/,
  'main process must forward the explicit LoRA Grok stage',
);
matchCode(main, /readGrokLoraSelectionHistory/, 'main process must serve persisted history');
matchCode(
  main,
  /checkLoraFileAvailability/,
  'main process must serve current placement for historical LoRAs',
);
matchCode(
  availability,
  /export async function checkLoraFileAvailability/,
  'availability service must support historical LoRA files',
);
matchCode(
  availability,
  /\._batch_studio/,
  'availability checks must inspect the draft models artifact',
);
matchCode(
  availability,
  /draftModels\?\?/,
  'draft models must take precedence over confirmed models',
);
console.log('Grok LoRA selection history tests passed.');
