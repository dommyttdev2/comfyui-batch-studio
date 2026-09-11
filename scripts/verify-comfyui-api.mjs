import fs from 'node:fs';
import path from 'node:path';

function usage(){
 console.error('Usage: npm run verify:comfyui -- <project-root> [comfyui-url]');
 console.error('Example: npm run verify:comfyui -- "D:\\BatchProjects\\my-project" http://127.0.0.1:8188');
 process.exit(2);
}

const root=process.argv[2]?path.resolve(process.argv[2]):null;
const baseUrl=(process.argv[3]||process.env.COMFYUI_URL||'http://127.0.0.1:8188').replace(/\/$/,'');
if(!root)usage();

function readJson(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
function object(value){return value&&typeof value==='object'&&!Array.isArray(value);}
function isLink(value){return Array.isArray(value)&&value.length===2&&typeof value[0]==='string'&&Number.isInteger(value[1]);}
function inputDefinition(info,name){
 const input=info?.input||{};
 return input.required?.[name]??input.optional?.[name]??null;
}
function inputNames(info){
 return new Set([...Object.keys(info?.input?.required||{}),...Object.keys(info?.input?.optional||{})]);
}
function requiredNames(info){return Object.keys(info?.input?.required||{});}
function expectedType(def){
 if(!Array.isArray(def)||def.length===0)return null;
 return typeof def[0]==='string'?def[0]:null;
}
function enumValues(def){
 if(!Array.isArray(def)||def.length===0||!Array.isArray(def[0]))return null;
 return def[0];
}
function literalValid(def,value){
 const values=enumValues(def);
 if(values&&!values.some(item=>Object.is(item,value)))return `value is not in ComfyUI choices (${String(value)})`;
 const type=expectedType(def);
 if(type==='INT'&&(!Number.isInteger(value)))return 'expected INT';
 if(type==='FLOAT'&&typeof value!=='number')return 'expected FLOAT';
 if(type==='BOOLEAN'&&typeof value!=='boolean')return 'expected BOOLEAN';
 if(type==='STRING'&&typeof value!=='string')return 'expected STRING';
 return null;
}

const metaPath=path.join(root,'project_meta.json');
if(!fs.existsSync(metaPath))throw new Error(`project_meta.json not found: ${metaPath}`);
const meta=readJson(metaPath);
const apiRelative=meta?.workflowBuild?.apiOutputPath??meta?.workflowBuild?.outputs?.api?.path;
if(!apiRelative)throw new Error('workflowBuild does not contain apiOutputPath. Compile the workflow first.');
const apiPath=path.join(root,String(apiRelative));
if(!fs.existsSync(apiPath))throw new Error(`API graph not found: ${apiPath}`);
const graph=readJson(apiPath);

async function getJson(url){
 const response=await fetch(url,{headers:{accept:'application/json'}});
 if(!response.ok)throw new Error(`${response.status} ${response.statusText}: ${url}`);
 return response.json();
}

let stats,objectInfo;
try{
 [stats,objectInfo]=await Promise.all([getJson(`${baseUrl}/system_stats`),getJson(`${baseUrl}/object_info`)]);
}catch(error){
 console.error(`[FAIL] ComfyUIに接続できません: ${baseUrl}`);
 console.error(error instanceof Error?error.message:String(error));
 process.exit(1);
}

const errors=[];
const warnings=[];
for(const [nodeId,node] of Object.entries(graph)){
 if(!object(node)||typeof node.class_type!=='string'||!object(node.inputs)){
  errors.push(`${nodeId}: invalid API graph node`);
  continue;
 }
 const info=objectInfo[node.class_type];
 if(!info){
  errors.push(`${nodeId} ${node.class_type}: class_type is not registered on this ComfyUI`);
  continue;
 }
 const names=inputNames(info);
 for(const name of requiredNames(info)){
  if(!(name in node.inputs))errors.push(`${nodeId} ${node.class_type}: required input missing: ${name}`);
 }
 for(const [name,value] of Object.entries(node.inputs)){
  const def=inputDefinition(info,name);
  if(!def){
   errors.push(`${nodeId} ${node.class_type}: input is not exposed by /object_info: ${name}`);
   continue;
  }
  if(isLink(value)){
   const [originId,slot]=value;
   const origin=graph[originId];
   if(!origin){errors.push(`${nodeId}.${name}: missing origin node ${originId}`);continue;}
   const originInfo=objectInfo[origin.class_type];
   const outputType=originInfo?.output?.[slot];
   const inputType=expectedType(def);
   if(outputType==null)errors.push(`${nodeId}.${name}: origin output slot ${originId}[${slot}] does not exist`);
   else if(inputType&&inputType!=='*'&&outputType!=='*'&&inputType!==outputType)errors.push(`${nodeId}.${name}: link type mismatch ${outputType} -> ${inputType}`);
   continue;
  }
  const literalError=literalValid(def,value);
  if(literalError)errors.push(`${nodeId} ${node.class_type}.${name}: ${literalError}`);
 }
 for(const name of names){
  const def=inputDefinition(info,name);
  const config=Array.isArray(def)&&object(def[1])?def[1]:null;
  if(config?.deprecated&&name in node.inputs)warnings.push(`${nodeId} ${node.class_type}.${name}: deprecated input`);
 }
}

const system=stats?.system||{};
console.log(`ComfyUI: ${baseUrl}`);
if(system.comfyui_version)console.log(`ComfyUI version: ${system.comfyui_version}`);
if(system.os)console.log(`OS: ${system.os}`);
if(Array.isArray(stats?.devices))for(const device of stats.devices)console.log(`Device: ${device?.name||'unknown'}`);
console.log(`API graph: ${apiPath}`);
console.log(`Nodes checked: ${Object.keys(graph).length}`);
if(warnings.length){
 console.log('\nWarnings:');
 for(const warning of warnings)console.log(`  - ${warning}`);
}
if(errors.length){
 console.error(`\n[FAIL] ${errors.length} contract error(s)`);
 for(const error of errors)console.error(`  - ${error}`);
 process.exit(1);
}
console.log('\n[PASS] API graph is compatible with this ComfyUI /object_info contract.');
