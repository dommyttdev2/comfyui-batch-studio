import path from 'node:path';
import type { GrokTask } from '../shared/types.js';
import { exists } from './fs-utils.js';
import { catalogPathFor } from './model-catalog.js';

async function attachment(name:string,p:string,purpose:string){return {name,path:p,purpose,exists:await exists(p)}}
export async function buildGrokTask(root:string,stage:GrokTask['stage'],extra=''):Promise<GrokTask>{
  const brief=path.join(root,'project_brief.json'), story=path.join(root,'story.md'), models=path.join(root,'models.json');
  const catalog=await catalogPathFor(root);
  const base='ComfyUI Batch Studio の工程用依頼です。出力形式・既存Artifact・責務境界を維持し、ComfyUI内部Workflow JSONは生成しないでください。';
  if(stage==='story-initial') return {stage,title:'ストーリー検討',prompt:`${base}\n添付した基本設定を基に、ストーリー案を検討してください。ユーザーとの対話を前提にしてください。${extra?'\n'+extra:''}`,attachments:[await attachment('project_brief.json',brief,'基本設定')]};
  if(stage==='story-finalize') return {stage,title:'ストーリー完成版',prompt:`${base}\n現在のGrok上の検討内容を story.md として利用できる完成形に整理してください。`,attachments:[await attachment('project_brief.json',brief,'基本設定')]};
  if(stage==='story-fix') return {stage,title:'ストーリー修正',prompt:`${base}\n現在の story.md を修正し、完成形を返してください。${extra?'\n修正意図: '+extra:''}`,attachments:[await attachment('project_brief.json',brief,'基本設定'),await attachment('story.md',story,'現在の確定版')]};
  if(stage==='models'||stage==='models-fix') return {stage,title:'モデル選定',prompt:`${base}\nstory.md と model_catalog.json の中だけから、Checkpoint 1件と必要なLoRAを選定してください。存在しない必須モデルは missingRequirements として返し、架空のfileを作らないでください。${extra?'\n再選定条件: '+extra:''}`,attachments:[await attachment('story.md',story,'確定ストーリー'),...(catalog?[await attachment('model_catalog.json',path.resolve(catalog),'モデルカタログ')]:[])]};
  return {stage,title:stage==='prompt-plan'?'プロンプト設計':'プロンプト設計修正',prompt:`${base}\nstory.md と models.json を基に Prompt Plan JSON を作成してください。common/rootLoras/branches/leaves の意味データのみを返してください。${extra?'\n修正条件: '+extra:''}`,attachments:[await attachment('story.md',story,'確定ストーリー'),await attachment('models.json',models,'確定モデル')]};
}
