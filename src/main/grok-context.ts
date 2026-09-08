import path from 'node:path';
import type { GrokTask } from '../shared/types.js';
import { exists, readJson } from './fs-utils.js';
import { catalogPathFor } from './model-catalog.js';

async function attachment(name:string,p:string,purpose:string){return {name,path:p,purpose,exists:await exists(p)}}
const common=`あなたは ComfyUI Batch Studio の企画工程を支援します。
Batch Studio と Grok の責務境界を守ってください。
- あなたは意味・創作上の判断を担当します。
- ComfyUI Workflow JSON、node ID、link ID、group ID、node position、widgets_values は生成しません。
- 添付ファイルに存在しない Model / Version / File identity を捏造しません。
- 最終成果物以外の説明を付ける場合でも、成果物は指定された code block 1個に明確に分離してください。`;

const modelsShape=`最終出力は JSON code block で、次の形だけを返してください。
{
  "schemaVersion": 1,
  "catalog": { "schemaVersion": <catalogと同じ>, "generation": <catalogと同じ>, "generatedAt": <catalogと同じ> },
  "checkpoint": {
    "ref": "checkpoint.main",
    "modelId": <integer>, "modelName": "...", "versionId": <integer>, "versionName": "...",
    "fileId": <integer>, "fileName": "...", "modelUrl": "...", "trainedWords": ["..."], "reason": "..."
  },
  "loras": [
    {
      "ref": "lora.<semantic-id>",
      "modelId": <integer>, "modelName": "...", "versionId": <integer>, "versionName": "...",
      "fileId": <integer>, "fileName": "...", "modelUrl": "...", "trainedWords": ["..."], "reason": "...",
      "strengthBaseline": <catalogの選択versionに存在する場合だけ、そのobjectを値・provenanceとも変更せずコピー>
    }
  ]
}
- ref は project 全体で一意にしてください。LoRA ref は ^lora\\.[a-z][a-z0-9._-]{0,58}$ に従います。
- ID / name / URL / trainedWords / strengthBaseline は model_catalog.json から正確に転記してください。
- カタログに必要モデルが無い場合は、上記に加えて root の missingRequirements 配列へ {"role":"...","requirement":"...","reason":"..."} を記載してください。架空の選定で埋めないでください。
- 不足が無い場合は missingRequirements を出力しません。
- 定義されていない追加フィールドを出力しません。`;

const planShape=`最終出力は JSON code block で、次の形だけを返してください。
{
  "schemaVersion": 1,
  "common": { "positive": "...", "negative": "..." },
  "rootLoras": [ { "modelRef": "lora.xxx", "strengthModel": 0.0, "strengthClip": 0.0 } ],
  "branches": [
    {
      "id": "b01", "label": "人間向け表示名",
      "loras": [ { "modelRef": "lora.xxx", "strengthModel": 0.0, "strengthClip": 0.0 } ],
      "leaves": [ { "id": "s1-01-c1", "name": "...", "positive": "...", "negative": "..." } ]
    }
  ]
}
- Branch / Leaf id は ^[a-z][a-z0-9._-]{0,63}$ に従い、各々project全体で一意にしてください。
- 配列順が生成順です。order field は追加しません。
- 1 Leaf = 1 image です。目標画像枚数に近づくようLeaf数を設計してください。ただし意味上必要なら目標と完全一致しなくても構いません。
- modelRef は models.json に存在する LoRA ref だけを使ってください。checkpoint.main はLoRA適用に使いません。
- models.json に strengthBaseline.value = w があるLoRAは、初期値として strengthModel=w / strengthClip=w を使用してください。
- strengthBaseline が無いLoRAも strengthModel / strengthClip は必須です。1.0や0.7等の暗黙defaultで埋めず、Storyと用途から明示的に値を決めてください。
- common / rootLoras / branches / leaves の意味情報だけを出力し、Workflow内部fieldや未知fieldを追加しません。`;

export async function buildGrokTask(root:string,stage:GrokTask['stage'],extra=''):Promise<GrokTask>{
  const brief=path.join(root,'project_brief.json'),story=path.join(root,'story.md'),models=path.join(root,'models.json');
  const catalog=await catalogPathFor(root);
  if(stage==='story-initial')return {stage,title:'ストーリー検討',prompt:`${common}\n\n## Task\n添付した project_brief.json を基に、まだ story.md を確定せず、ユーザーとの対話用に次を提示してください。\n1. 公開情報を調査して前提を整理する。版権キャラクターの不確かな設定は推測で確定しない。\n2. 大まかなStory案を複数提示する。\n3. 各案について画像化しやすさ・展開上の特徴を示す。\n4. ユーザーが決めるべき点や不足情報を質問する。${extra?`\n\nユーザー追加入力:\n${extra}`:''}`,attachments:[await attachment('project_brief.json',brief,'基本設定')]};
  if(stage==='story-finalize'||stage==='story-fix')return {stage,title:stage==='story-finalize'?'ストーリー完成版':'ストーリー修正',prompt:`${common}\n\n## Task\nこれまでのGrok上の会話と添付された基本設定${stage==='story-fix'?'・現在の story.md':''}を基に、画像生成計画へ展開可能な完成 story.md を作成してください。章・場面・進行が追える構造にし、Prompt PlanそのものやComfyUI内部情報は書かないでください。\n最終成果物は markdown code block 1個で story.md 本文を返してください。${extra?`\n\n修正意図:\n${extra}`:''}`,attachments:[await attachment('project_brief.json',brief,'基本設定'),...(stage==='story-fix'?[await attachment('story.md',story,'現在の確定ストーリー')]:[])]};
  if(stage==='models'||stage==='models-fix')return {stage,title:stage==='models'?'モデル選定':'モデル再選定',prompt:`${common}\n\n## Task\n確定済み story.md を満たすため、添付した model_catalog.json の中だけから Checkpoint 1件と必要なLoRAを、Model / Version / Fileまで選定してください。trained words、採用理由、用途も考慮してください。\n${modelsShape}${extra?`\n\n再選定条件:\n${extra}`:''}`,attachments:[await attachment('story.md',story,'確定ストーリー'),...(catalog?[await attachment('model_catalog.json',path.resolve(catalog),'モデルカタログ')]:[])]};
  const briefData=await readJson<any>(brief);const target=briefData?.generation?.target_image_count;
  return {stage,title:stage==='prompt-plan'?'プロンプト設計':'プロンプト設計修正',prompt:`${common}\n\n## Task\n確定済み story.md と models.json を基に、Workflow Compilerへ渡す意味データとして Prompt Plan を作成してください。共通Prompt、全体共通LoRA、意味的なBranch分割、Branch LoRA、各Leafのpositive/negative差分を設計してください。${Number.isInteger(target)?`\n計画上の目標画像枚数は ${target} 枚です。`:''}\n${planShape}${extra?`\n\n修正条件:\n${extra}`:''}`,attachments:[await attachment('project_brief.json',brief,'画像枚数などの計画条件'),await attachment('story.md',story,'確定ストーリー'),await attachment('models.json',models,'確定モデル')]};
}
