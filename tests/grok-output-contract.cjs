const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const src=fs.readFileSync(path.resolve(__dirname,'../src/main/grok-context.ts'),'utf8');

for(const heading of ['## 作品コンセプト','## 登場人物','## 共通設定','## 全体進行','## シーン構成','## 生成上の一貫性メモ']){
  assert.match(src,new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')),`story output contract must include ${heading}`);
}
assert.match(src,/artifactFileOutputRules\('story\.md'\)/,'story artifact must be returned as story.md file');
assert.match(src,/artifactFileOutputRules\('models\.json'\)/,'models artifact must be returned as models.json file');
assert.match(src,/artifactFileOutputRules\('prompt_plan\.json'\)/,'Prompt Plan artifact must be returned as prompt_plan.json file');
assert.match(src,/ダウンロード可能なファイルとして生成・添付/,'final artifact outputs must be downloadable files');
assert.match(src,/ファイル内容をチャット本文、code block、引用、要約へ再掲しません/,'artifact file contents must not be repeated in chat');
assert.match(src,/JSONとしてparse可能な厳密な構文/,'JSON artifacts must require strict parseable JSON');
assert.match(src,/missingRequirements/,'models draft output must define missingRequirements behavior');
assert.match(src,/1 Leaf = 1 image/,'Prompt Plan output must preserve leaf cardinality');
assert.match(src,/models\.json の trainedWords はトリガーワードとして扱い/,'Prompt Plan must treat trainedWords as trigger words');
assert.match(src,/checkpoint\.main\.trainedWords と rootLoras[\s\S]*common\.positive/,'checkpoint and root LoRA trigger words must be applied to common positive');
assert.match(src,/Branch の loras[\s\S]*すべての Leaf の positive/,'branch LoRA trigger words must be applied to every leaf positive');
assert.match(src,/trainedWords が空配列ならトリガーワードを捏造しません/,'empty trainedWords must not be invented');
assert.match(src,/trainedWords を negative prompt へ入れません/,'trigger words must not be applied to negative prompts');
assert.match(src,/^const storyDiscussionShape=/m,'story discussion must have a defined response format');
assert.doesNotMatch(src,/最終成果物は指定された code block 1個だけ/,'final artifacts must no longer be requested inline as code blocks');

console.log('Grok output contract tests passed.');
