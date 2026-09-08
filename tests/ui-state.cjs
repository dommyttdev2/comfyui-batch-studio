const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {execFileSync}=require('node:child_process');

const repo=path.resolve(__dirname,'..');
const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'batch-studio-ui-state-runtime-'));
const tscBin=path.join(repo,'node_modules','typescript','bin','tsc');
execFileSync(process.execPath,[tscBin,'-p',path.join(repo,'tsconfig.electron.json'),'--outDir',runtime],{cwd:repo,stdio:'inherit'});
const load=relative=>import(pathToFileURL(path.join(runtime,'main',relative)).href);

(async()=>{
  const {UiStateStore}=await load('ui-state.js');
  const userData=fs.mkdtempSync(path.join(os.tmpdir(),'batch-studio-ui-state-'));
  const project=path.join(userData,'project');
  fs.mkdirSync(project,{recursive:true});
  const store=new UiStateStore(userData);
  await store.rememberProject(project);
  assert.equal(await store.lastProjectPath(),path.resolve(project));
  await store.clearProject();
  assert.equal(await store.lastProjectPath(),null);
  console.log('UI state tests passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
