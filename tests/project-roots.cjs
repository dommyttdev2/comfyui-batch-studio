const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const repo=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(repo,p),'utf8');

const appSettings=read('src/main/app-settings.ts');
const artifactService=read('src/main/artifact-service.ts');
const environmentSettings=read('src/renderer/EnvironmentSettings.tsx');
const app=read('src/renderer/App.tsx');

assert.match(appSettings,/interface StoredAppSettingsV3/,'環境設定schema v3を持つ');
assert.match(appSettings,/projectRoot:string/,'Project rootを永続化する');
assert.match(appSettings,/artifactRoot:string/,'成果物配置rootを永続化する');
assert.match(appSettings,/BATCH_STUDIO_PROJECT_ROOT/,'Project rootをruntime設定へ反映する');
assert.match(appSettings,/BATCH_STUDIO_ARTIFACT_ROOT/,'成果物配置rootをruntime設定へ反映する');
assert.match(appSettings,/normalizeRootDirectory\('Project root'/,'Project rootを絶対パスの既存ディレクトリとして検証する');
assert.match(appSettings,/normalizeRootDirectory\('成果物配置 root'/,'成果物配置rootを絶対パスの既存ディレクトリとして検証する');

assert.match(environmentSettings,/>Project root</,'環境設定にProject root入力を表示する');
assert.match(environmentSettings,/成果物配置 root（生成画像）/,'環境設定に成果物配置root入力を表示する');
assert.match(environmentSettings,/chooseRoot\('projectRoot'\)/,'Project rootをフォルダ選択できる');
assert.match(environmentSettings,/chooseRoot\('artifactRoot'\)/,'成果物配置rootをフォルダ選択できる');

assert.match(app,/projectRoot.*setParent\(projectRoot\)/s,'新規プロジェクト作成先の初期値へProject rootを反映する');
assert.match(artifactService,/BATCH_STUDIO_ARTIFACT_ROOT/,'プロジェクト作成時に成果物配置rootを参照する');
assert.match(artifactService,/path\.join\(artifactRoot,brief\.project\.id\)/,'成果物配置root直下へprojectIdのフォルダを割り当てる');
assert.match(artifactService,/mkdir\(artifactOutputPath,\{recursive:true\}\)/,'成果物側のプロジェクトフォルダを作成する');
assert.match(artifactService,/settings:artifactOutputPath\?\{artifactOutputPath\}:\{\}/,'成果物フォルダをproject metaへ記録する');

console.log('Project/artifact root tests passed.');
