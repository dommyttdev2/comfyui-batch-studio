const { matchCode, doesNotMatchCode } = require('./source-match.cjs');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.resolve(__dirname, '../src/renderer/GrokStages.tsx'), 'utf8');

for (const [stage, fileName] of [
  ['story-finalize', 'story.md'],
  ['story-fix', 'story.md'],
  ['models', 'model_loras.json'],
  ['models-fix', 'model_loras.json'],
  ['prompt-plan', 'prompt_plan.json'],
  ['prompt-plan-fix', 'prompt_plan.json'],
  ['caption', 'caption_content.json'],
]) {
  const escapedStage = stage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedFile = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  matchCode(
    src,
    new RegExp(`['\"]?${escapedStage}['\"]?:\\{name:['\"]${escapedFile}['\"]`),
    `${stage} must import the AI return file ${fileName}`,
  );
}
matchCode(src, /type="file"/, 'file-generating AI stages must expose a file explorer picker');
matchCode(src, /onDrop=/, 'file-generating AI stages must accept drag and drop');
matchCode(
  src,
  /selectedFile\.text\(\)/,
  'selected AI files must be read through the browser File API',
);
matchCode(
  src,
  /成果物ファイルを取り込む/,
  'file-generating stages must expose a provider-neutral manual artifact fallback',
);
matchCode(
  src,
  /ファイルを選択/,
  'file-generating stages must expose an explicit file selection button',
);
matchCode(
  src,
  /ファイルを解析・取り込む/,
  'file import must require an explicit import action after selection',
);
matchCode(src, /AgentStageBridge/, 'AI stage controls must use a provider-neutral component');
matchCode(
  src,
  /window\.batchStudio\.assistant\.startTask/,
  'AI tasks must start from the left pane through the shared assistant API',
);
matchCode(
  src,
  /window\.batchStudio\.assistant\.stopTask/,
  'AI tasks must stop from the left pane through the shared assistant API',
);
doesNotMatchCode(
  src,
  /window\.batchStudio\.clipboard\.writeText/,
  'Grok clipboard task delivery must be removed from stage UI',
);
doesNotMatchCode(
  src,
  /window\.batchStudio\.codex\.selectStageTask/,
  'Codex right-pane task selection must be removed from stage UI',
);
doesNotMatchCode(
  src,
  /window\.batchStudio\.grokTask\.build/,
  'stage UI must not generate a prompt just to copy it into Grok Web',
);
console.log('Provider-neutral AI stage and manual artifact fallback UI tests passed.');
