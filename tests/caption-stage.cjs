const fs = require('node:fs');
const path = require('node:path');
const { matchCode, doesNotMatchCode } = require('./source-match.cjs');

const service = fs.readFileSync(path.resolve(__dirname, '../src/main/caption-service.ts'), 'utf8');
const grok = fs.readFileSync(path.resolve(__dirname, '../src/main/grok-context.ts'), 'utf8');
const ui = fs.readFileSync(path.resolve(__dirname, '../src/renderer/ui.tsx'), 'utf8');
const stage = fs.readFileSync(path.resolve(__dirname, '../src/renderer/CaptionStage.tsx'), 'utf8');

matchCode(
  ui,
  /'実行',\s*'最終成果物',\s*'キャプション'/,
  'caption stage must appear after the final artifact stage',
);
matchCode(
  ui,
  /キャプション: 'caption'/,
  'caption stage must use its own Grok conversation context',
);
matchCode(
  service,
  /getFinalArtifactStatus\(root\)/,
  'caption image count must come from the shared final artifact service',
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
  /build\.renderInputSha256 !== expectedInputHash/,
  'caption render inputs include the fan-work flag',
);
matchCode(
  service,
  /build\.outputSha256 !== sha256\(actualCaption \?\? ''\)/,
  'caption external modifications must be detected',
);
matchCode(service, /!captionExists/, 'a missing previously built caption must be stale');

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
  /if \(copyrightedCharacter\) japanese\.push\('※二次創作です。公式とは無関係です。'\);\s*japanese\.push\('※AI生成作品です。'/,
  'fan-work disclaimer must appear immediately before the AI-generated disclaimer',
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
  /最初の説明文は作品内容に沿った官能的な短いストーリーとし、200文字以内で簡潔にまとめてください/,
  'Grok caption prompt must request a concise sensual opening story',
);
matchCode(
  grok,
  /description\.ja\[0\] \/ description\.en\[0\].*各200文字以内/,
  'Grok caption shape must constrain the first localized description to 200 characters',
);
matchCode(grok, /定型注意書きは出力しません/, 'Grok must not own deterministic disclaimers');
doesNotMatchCode(
  stage,
  /caption\.selectSourceDirectory/,
  'caption UI must not own final artifact directory selection',
);
matchCode(stage, /caption\.status/, 'caption UI must rescan the shared final artifact input');
matchCode(
  stage,
  /<h3>2\. Pixiv用タイトル<\/h3>/,
  'Pixiv title editor must be the second caption step',
);
matchCode(stage, /<h3>3\. caption\.txt<\/h3>/, 'caption.txt must become the third caption step');
matchCode(stage, /caption\.savePixivTitle/, 'Pixiv title edits must persist via IPC');
matchCode(stage, /clipboard\.writeText\(pixivJa\)/, 'Japanese Pixiv title must be copyable');
matchCode(stage, /clipboard\.writeText\(pixivEn\)/, 'English Pixiv title must be copyable');
matchCode(stage, /caption\.generate/, 'caption UI must generate caption.txt deterministically');

matchCode(
  grok,
  /"pixivTitle": \{ "ja": "\.\.\.", "en": "\.\.\." \}/,
  'Grok must request two localized Pixiv titles',
);
matchCode(
  grok,
  /pixivTitle\.ja \/ pixivTitle\.en は各32文字以内/,
  'Grok must enforce 32 characters',
);
matchCode(service, /captionBodyContent\(content\)/, 'Pixiv title must not invalidate caption.txt');
matchCode(service, /export async function savePixivTitle/, 'Pixiv title edit service must exist');
console.log('Caption stage contract tests passed.');
