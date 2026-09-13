const fs = require('node:fs');
const path = require('node:path');
const { matchCode, doesNotMatchCode } = require('./source-match.cjs');

const service = fs.readFileSync(path.resolve(__dirname, '../src/main/caption-service.ts'), 'utf8');
const grok = fs.readFileSync(path.resolve(__dirname, '../src/main/grok-context.ts'), 'utf8');
const ui = fs.readFileSync(path.resolve(__dirname, '../src/renderer/ui.tsx'), 'utf8');
const stage = fs.readFileSync(path.resolve(__dirname, '../src/renderer/CaptionStage.tsx'), 'utf8');
const types = fs.readFileSync(path.resolve(__dirname, '../src/shared/types.ts'), 'utf8');

matchCode(
  ui,
  /'実行',[\s\S]*'キャプション'/,
  'caption stage must appear after execution in project navigation',
);
matchCode(
  ui,
  /キャプション: 'caption'/,
  'caption stage must use its own Grok conversation context',
);
matchCode(
  types,
  /captionSourceDirectory\?: string/,
  'final artifact directory must be persisted in project settings',
);
matchCode(
  service,
  /new Set\(\['\.png', '\.jpg', '\.jpeg', '\.webp'\]\)/,
  'caption image count must use the agreed supported image extensions',
);
matchCode(
  service,
  /entry\.isDirectory\(\)\) count \+= await countImages\(full\)/,
  'caption image count must scan the selected directory tree',
);
matchCode(
  service,
  /build\.imageCount !== imageCount/,
  'caption status must become stale when the actual image count changes',
);
matchCode(
  service,
  /build\.contentSha256 !== contentHash\(draft\.content\)/,
  'caption status must become stale when Grok semantic content changes',
);
matchCode(
  service,
  /path\.join\(root, 'caption\.txt'\)/,
  'caption.txt must be generated as the project artifact',
);
matchCode(
  service,
  /if \(copyrightedCharacter\) japanese\.push\('※二次創作です。公式とは無関係です。'\)/,
  'fan-work disclaimer must be conditional on copyrighted-character projects',
);
matchCode(
  service,
  /japanese\.push\('※AI生成作品です。'/,
  'AI-generated disclaimer must be owned by Batch Studio',
);
doesNotMatchCode(
  service,
  /getCurrentExecutionRun|getExecutionRun|ExecutionRun/,
  'caption image count must not depend on Execution Run counts',
);
matchCode(
  grok,
  /artifactFileOutputRules\('caption_content\.json'\)/,
  'Grok caption output must be returned as caption_content.json',
);
matchCode(
  grok,
  /画像枚数、収録枚数、生成枚数は出力しません/,
  'Grok must not provide the final image count',
);
matchCode(
  grok,
  /定型注意書きは出力しません/,
  'Grok must not own deterministic disclaimers',
);
matchCode(
  stage,
  /caption\.selectSourceDirectory/,
  'caption UI must allow the user to select the final artifact directory',
);
matchCode(stage, /caption\.status/, 'caption UI must rescan actual image count');
matchCode(stage, /caption\.generate/, 'caption UI must generate caption.txt deterministically');

console.log('Caption stage contract tests passed.');
