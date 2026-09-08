const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const src=fs.readFileSync(path.resolve(__dirname,'../src/main/grok-context.ts'),'utf8');

for(const heading of ['## 作品コンセプト','## 登場人物','## 共通設定','## 全体進行','## シーン構成','## 生成上の一貫性メモ']){
  assert.match(src,new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')),`story output contract must include ${heading}`);
}
assert.match(src,/code block 1個だけ/,'final artifact outputs must be exactly one code block');
assert.match(src,/code block の前後に説明/,'artifact outputs must prohibit surrounding prose');
assert.match(src,/JSONとしてparse可能な厳密な構文/,'JSON artifacts must require strict parseable JSON');
assert.match(src,/missingRequirements/,'models draft output must define missingRequirements behavior');
assert.match(src,/1 Leaf = 1 image/,'Prompt Plan output must preserve leaf cardinality');
assert.match(src,/^const storyDiscussionShape=/m,'story discussion must have a defined response format');

console.log('Grok output contract tests passed.');
