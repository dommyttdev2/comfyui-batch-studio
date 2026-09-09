const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.resolve(__dirname,'../src/renderer/GrokStages.tsx'),'utf8');

for(const [stage,fileName] of [
  ['story-finalize','story.md'],
  ['story-fix','story.md'],
  ['models','model_loras.json'],
  ['models-fix','model_loras.json'],
  ['prompt-plan','prompt_plan.json'],
  ['prompt-plan-fix','prompt_plan.json']
]){
  const escapedStage=stage.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const escapedFile=fileName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  assert.match(src,new RegExp(`['\"]?${escapedStage}['\"]?:\\{name:['\"]${escapedFile}['\"]`),`${stage} must import the Grok return file ${fileName}`);
}
assert.match(src,/type="file"/,'file-generating Grok stages must expose a file explorer picker');
assert.match(src,/onDrop=/,'file-generating Grok stages must accept drag and drop');
assert.match(src,/selectedFile\.text\(\)/,'selected Grok files must be read through the browser File API');
assert.match(src,/Grok返却ファイルを添付/,'file-generating stages must tell the user to attach the Grok return file');
assert.match(src,/ファイルを選択/,'file-generating stages must expose an explicit file selection button');
assert.match(src,/ファイルを解析・取り込む/,'file import must require an explicit import action after selection');
assert.match(src,/Grokの回答を貼り付け/,'non-file response support must remain available for conversational stages');
console.log('Grok file return UI tests passed.');
