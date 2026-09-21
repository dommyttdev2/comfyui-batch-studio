const assert = require('node:assert/strict');
const { matchCode, doesNotMatchCode } = require('./source-match.cjs');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.resolve(__dirname, '../src/main/grok-context.ts'), 'utf8');
for (const heading of [
  '## 作品コンセプト',
  '## 登場人物',
  '## 共通設定',
  '## 全体進行',
  '## シーン構成',
  '## 生成上の一貫性メモ',
])
  matchCode(
    src,
    new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `story output contract must include ${heading}`,
  );
matchCode(
  src,
  /artifactFileOutputRules\('story\.md'\)/,
  'story artifact must be returned as story.md file',
);
matchCode(
  src,
  /artifactFileOutputRules\('model_loras\.json'\)/,
  'Grok model selection must return the LoRA-only model_loras.json file',
);
matchCode(
  src,
  /artifactFileOutputRules\('prompt_plan\.json'\)/,
  'Prompt Plan artifact must be returned as prompt_plan.json file',
);
matchCode(
  src,
  /artifactFileOutputRules\('caption_content\.json'\)/,
  'Caption semantic content must be returned as caption_content.json file',
);
matchCode(
  src,
  /画像枚数、収録枚数、生成枚数は出力しません/,
  'Grok caption output must leave actual image count to Batch Studio',
);
matchCode(
  src,
  /ダウンロード可能なファイルとして生成・添付/,
  'final artifact outputs must be downloadable files',
);
matchCode(
  src,
  /添付ファイルがある場合、ファイル内容をチャット本文、code block、引用、要約へ再掲しません/,
  'artifact file contents must not be repeated when a downloadable file exists',
);
matchCode(
  src,
  /実際に添付ファイルを提供できない場合に限り、代替として完全なファイル本文/,
  'when file attachment is unavailable, require the complete content as a code block',
);
matchCode(
  src,
  /ファイルを作成したと報告するだけでは納品になりません/,
  'a completion-only message with no file or full content must not be considered a deliverable',
);
matchCode(
  src,
  /stage === 'story-initial'[\\s\\S]*storyDiscussionShape[\\s\\S]*stage === 'story-finalize' \\|\\| stage === 'story-fix'/,
  'discussion and final story stages must build distinct prompts',
);
matchCode(
  src,
  /検討案・質問ではなく、画像生成計画へ展開可能な完成版 story\\.md の全文を納品/,
  'finalization must request the complete story rather than another discussion',
);
matchCode(
  src,
  /JSONとしてparse可能な厳密な構文/,
  'JSON artifacts must require strict parseable JSON',
);
matchCode(
  src,
  /missingRequirements/,
  'models draft output must define missingRequirements behavior',
);
matchCode(
  src,
  /promptFallbacks/,
  'models draft output must define resolved prompt fallback behavior',
);
matchCode(
  src,
  /Checkpoint、Text Encoder、VAE、modelFamily は出力しません/,
  'Grok must not override user-selected base models',
);
matchCode(
  src,
  /modelType が LoRA \/ LoCon \/ DoRA/,
  'Grok LoRA selection must be catalog-type constrained',
);
matchCode(src, /civitai\.red/, 'missing catalog LoRAs must be searched on civitai.red');
matchCode(src, /civitai\.com/, 'missing catalog LoRAs must be searched on civitai.com');
matchCode(
  src,
  /複数LoRAを組み合わせて要件を分解・実現/,
  'Grok must investigate multi-LoRA composition after external alternatives fail',
);
matchCode(
  src,
  /positive \/ negative prompt で十分に代替可能か判断/,
  'Grok must evaluate prompt-only fallback after multi-LoRA composition fails',
);
matchCode(
  src,
  /Promptだけで十分に代替可能[\s\S]*missingRequirements へ入れません/,
  'prompt-resolved requirements must not remain blocking missing requirements',
);
matchCode(
  src,
  /Civitai Collectionへ追加してカタログ再同期が必要/,
  'external models outside the catalog must remain explicit catalog-add requirements',
);
matchCode(
  src,
  /model_prompt_fallbacks\.json/,
  'Prompt Plan must receive persisted prompt fallback decisions',
);
matchCode(
  src,
  /Prompt記法 — Anima[\s\S]*looking at viewer/,
  'Anima prompts must use space-separated normal tags',
);
matchCode(
  src,
  /Prompt記法 — Illustrious[\s\S]*looking_at_viewer/,
  'Illustrious prompts must use underscore normal tags',
);
matchCode(src, /trainedWords は例外[\s\S]*1文字も変更せず/, 'trainedWords must remain exact');
matchCode(src, /1 Leaf = 1 image/, 'Prompt Plan output must preserve leaf cardinality');
matchCode(src, /schemaVersion": 2/, 'new Prompt Plan output must use schemaVersion 2');
matchCode(
  src,
  /common[\s\S]*branch\.prompt[\s\S]*leaf\.prompt/,
  'Prompt Plan must define common/branch/leaf prompt scopes',
);
matchCode(
  src,
  /triggerWordsMode は必ず "selected"/,
  'New Prompt Plans must opt into explicit trigger selection',
);
matchCode(
  src,
  /候補を全件選択したり、最低1語選択したりする義務はありません/,
  'Grok may choose no trigger words',
);
matchCode(
  src,
  /どのscopeでも選択しなかった候補は最終Promptに加えません/,
  'Unselected trigger candidates must never be injected',
);
matchCode(
  src,
  /subject, identity, appearance, style, outfit, expression, action, pose, camera, environment, lighting, effects/,
  'Prompt Plan positive categories must be explicit',
);
matchCode(
  src,
  /pov, angle, framing, gaze, focus/,
  'Prompt Plan camera categories must be explicit',
);
matchCode(src, /positiveTags \/ negativeTags/, 'Prompt fallback contract must use tag arrays');
matchCode(src, /const danbooruTagRules=/, 'Danbooru tag selection policy must be defined');
matchCode(
  src,
  /positive \/ negative prompt の通常タグ[\s\S]*Danbooruで実在するタグ/,
  'generated image prompts must require real Danbooru tags',
);
matchCode(
  src,
  /canonical tag[\s\S]*alias先のcanonical tag/,
  'Danbooru aliases must prefer canonical tags',
);
matchCode(
  src,
  /post_countが多いタグを優先/,
  'semantically equivalent Danbooru tags must prefer higher post counts',
);
matchCode(
  src,
  /低頻度タグしか正確に意味を表現できない場合は使用可能/,
  'rare tags must remain allowed when they are the only semantically accurate choice',
);
matchCode(
  src,
  /post_countを確認できない場合、件数を捏造してはいけません/,
  'unknown Danbooru post counts must never be invented',
);
matchCode(
  src,
  /Illustriousではcanonical nameをunderscore形式[\s\S]*Animaでは同じcanonical tag[\s\S]*underscoreをspaceへ変換/,
  'Danbooru canonical tags must honor model-family prompt dialects',
);
matchCode(
  src,
  /trainedWords[\s\S]*Danbooruタグ制約を適用しません/,
  'trainedWords must be exempt from Danbooru validation',
);
const danbooruRuleUses = (src.match(/\$\{danbooruTagRules\}/g) || []).length;
assert.equal(
  danbooruRuleUses,
  2,
  'Danbooru tag policy must be injected into both LoRA fallback selection and Prompt Plan generation',
);
matchCode(
  src,
  /positive promptへ追加するDanbooru実在タグ/,
  'LoRA prompt fallback positive must require Danbooru tags',
);
matchCode(
  src,
  /negative promptへ追加するDanbooru実在タグ/,
  'LoRA prompt fallback negative must require Danbooru tags',
);
matchCode(
  src,
  /const storyDiscussionShape=/,
  'story discussion must have a defined response format',
);
doesNotMatchCode(
  src,
  /最終成果物は指定された code block 1個だけ/,
  'final artifacts must no longer be requested inline as code blocks',
);
for (const rule of [
  /全Branchで id、非空のlabel、loras配列、leaves配列/,
  /使用LoRAが無いBranchも必ず"loras": \[\]/,
  /全Leafで id、非空のname、prompt/,
  /Common→Branch→Leafを合成した最終画像/,
  /各画像で構図・視線が変わるなら/,
  /Negativeに許されるキー/,
  /ファイル出力前の全件チェック/,
  /const fixContext =/,
  /validatePromptPlan\(planToFix, modelData\)/,
  /現在のPrompt Plan（修正対象）/,
])
  matchCode(
    src,
    rule,
    'Shared Grok/Codex Prompt Plan contract must cover recurring validation errors',
  );
const mainSrc = fs.readFileSync(path.resolve(__dirname, '../src/main/main.ts'), 'utf8');
matchCode(
  mainSrc,
  /const task = await buildGrokTask\(context\.root, stage, extra\)/,
  'Codex and Grok must use the same task builder',
);
matchCode(
  mainSrc,
  /\.replace\(artifactFileOutputRules\(codexReturnFile\[context\.stage\]\), ''\)/,
  'Codex may remove only the exact file output instructions, not the JSON schema example',
);
doesNotMatchCode(
  mainSrc,
  /replace\(\/## 出力契約/,
  'Codex must not strip arbitrary content up to the next heading',
);
console.log('Grok output contract tests passed.');
