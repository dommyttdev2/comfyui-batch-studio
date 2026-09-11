export interface SceneRunPrepareResult {
  run_handle:string;
  total_batches:number;
  total_images:number;
  presets?:unknown[];
  preset_graphs?:Record<string,unknown>;
}
export type SceneFinalizeState='pending'|'in_progress'|'finalized';

async function readJson(response:Response,label:string){
  const text=await response.text();let data:any={};
  if(text){try{data=JSON.parse(text)}catch{throw new Error(`${label}: invalid JSON response (HTTP ${response.status})`)}}
  if(!response.ok)throw new Error(`${label}: ${data?.error??data?.message??`HTTP ${response.status}`}`);
  return data;
}
function targetNodes(graph:{output?:Record<string,any>}){
  return Object.values(graph.output??{}).filter((node:any)=>['ScenePrompter','SceneMatrix','ScenePresetReference','ScenePrompterExpand'].includes(node?.class_type));
}
export function applySceneRunHandle(graph:{output:Record<string,any>},runHandle:string){
  for(const node of targetNodes(graph)){node.inputs=node.inputs??{};node.inputs.run_handle=runHandle;delete node.inputs.user_id}
  return graph;
}

export class ScenePromptRunClient {
  constructor(private readonly endpoint:string,private readonly fetchImpl:typeof fetch=fetch){}
  private async post(path:string,body:unknown,allowAccepted=false){
    const response=await this.fetchImpl(this.endpoint.replace(/\/$/,'')+path,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify(body)});
    if(allowAccepted&&response.status===202){const text=await response.text();return {response,data:text?JSON.parse(text):{}}}
    return {response,data:await readJson(response,`Scene Prompt Tools ${path} failed`)};
  }
  async prepare(graph:{output:Record<string,any>},expandNodeId:string,workflow:unknown,clientId:string):Promise<SceneRunPrepareResult>{
    const {data}=await this.post('/scene_prompt/runs/prepare',{api_graph:graph,expand_node_id:expandNodeId,workflow,client_id:clientId});
    if(!data?.run_handle)throw new Error('Scene Prompt Tools prepare returned no run_handle.');
    applySceneRunHandle(graph,String(data.run_handle));
    return data as SceneRunPrepareResult;
  }
  async claim(runHandle:string,promptId:string){
    const {data}=await this.post('/scene_prompt/runs/claim',{run_handle:runHandle,prompt_id:promptId});
    if(!data?.claimed)throw new Error('Scene Prompt Tools could not claim the submitted prompt.');
  }
  async finalize(runHandle:string,expandNodeId:string,promptId:string):Promise<SceneFinalizeState>{
    const {response,data}=await this.post('/scene_prompt/runs/finalize',{run_handle:runHandle,expand_node_id:expandNodeId,prompt_id:promptId},true);
    const state=String(data?.state??'');
    if(response.status===202||state==='pending'||state==='in_progress')return state==='in_progress'?'in_progress':'pending';
    if(state==='finalized')return 'finalized';
    throw new Error(data?.error??`Scene Prompt Tools finalize returned state ${state||'unknown'}.`);
  }
  async release(runHandle:string){
    let last:unknown=null;
    for(let attempt=0;attempt<3;attempt++){try{const {data}=await this.post('/scene_prompt/runs/release',{run_handle:runHandle});return Boolean(data?.released)}catch(error){last=error;if(attempt<2)await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)))}}
    throw last instanceof Error?last:new Error('Scene Prompt Tools release failed.');
  }
}
