const assert = require('node:assert/strict');
const { matchCode, doesNotMatchCode } = require('./source-match.cjs');
const fs = require('node:fs');
const path = require('node:path');
const repo = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(repo, p), 'utf8');

const appSettings = read('src/main/app-settings.ts');
const workflowCustomNodes = JSON.parse(read('src/shared/workflow-custom-nodes.json'));
const artifactService = read('src/main/artifact-service.ts');
const environmentSettings = read('src/renderer/EnvironmentSettings.tsx');
const app = read('src/renderer/App.tsx');
const projectStages = read('src/renderer/ProjectStages.tsx');
const main = read('src/main/main.ts');

matchCode(appSettings, /interface StoredAppSettingsV7/, '環境設定schema v7を持つ');
matchCode(
  appSettings,
  /workflow-custom-nodes\.json/,
  'Workflow依存custom_nodesはJSON定義を正本として読み込む',
);
assert.equal(workflowCustomNodes.schemaVersion, 1, 'Workflow custom_nodes定義のschemaを固定する');
assert.equal(
  workflowCustomNodes.repositories.length,
  2,
  'Batch Studioが完全依存する2件のcustom_nodesをJSONで定義する',
);
for (const node of workflowCustomNodes.repositories)
  assert.match(
    node.repository,
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/,
    'repositoryはowner/repo形式にする',
  );
matchCode(
  appSettings,
  /migrateRemoteCustomNodes\(raw\.remoteCustomNodes\)/,
  'schema v6以前の設定へ既定Workflow依存を移行時に補完する',
);
matchCode(appSettings, /BATCH_STUDIO_GITHUB_PAT/, 'GitHub PATの環境変数fallbackを持つ');
matchCode(appSettings, /safeStorage/, 'GitHub PATをOSの暗号化ストレージへ保存する');
matchCode(appSettings, /remoteCustomNodes/, 'Remote custom_nodes設定を永続化する');
matchCode(appSettings, /projectRoot:string/, 'Project rootを永続化する');
matchCode(appSettings, /artifactRoot:string/, '成果物配置rootを永続化する');
matchCode(appSettings, /BATCH_STUDIO_PROJECT_ROOT/, 'Project rootをruntime設定へ反映する');
matchCode(appSettings, /BATCH_STUDIO_ARTIFACT_ROOT/, '成果物配置rootをruntime設定へ反映する');
matchCode(
  appSettings,
  /normalizeRootDirectory\('Project root'/,
  'Project rootを絶対パスの既存ディレクトリとして検証する',
);
matchCode(
  appSettings,
  /normalizeRootDirectory\('成果物配置 root'/,
  '成果物配置rootを絶対パスの既存ディレクトリとして検証する',
);

matchCode(
  environmentSettings,
  /Project root.*BATCH_STUDIO_PROJECT_ROOT/s,
  '環境設定にProject root入力と環境設定IDを表示する',
);
matchCode(
  environmentSettings,
  /成果物配置 root（生成画像）/,
  '環境設定に成果物配置root入力を表示する',
);
matchCode(environmentSettings, /chooseRoot\('projectRoot'\)/, 'Project rootをフォルダ選択できる');
matchCode(
  environmentSettings,
  /chooseRoot\('artifactRoot'\)/,
  '成果物配置rootをフォルダ選択できる',
);
matchCode(
  environmentSettings,
  /Workflow依存 custom_nodes/,
  '環境設定でRemote custom_nodesを編集できる',
);
matchCode(environmentSettings, /Clone URL/, '各custom_nodeにGitHub clone URLを表示する');
matchCode(
  environmentSettings,
  /https:\/\/github\.com\/\$\{nameWithOwner\}\.git/,
  'clone URLはowner/repositoryから導出する',
);
matchCode(environmentSettings, /GitHub PAT/, '環境設定でGitHub PATを設定できる');

matchCode(
  app,
  /projectRoot.*setParent\(projectRoot\)/s,
  '新規プロジェクト作成先の初期値へProject rootを反映する',
);
matchCode(app, /selectParent\(parent\)/, '新規プロジェクトの作成先選択へ現在の入力済みパスを渡す');
matchCode(app, /Project root/, '新規プロジェクトの作成先ラベルをProject rootと表示する');
matchCode(
  app,
  /プロジェクトID \(フォルダ名\)/,
  '新規プロジェクトのIDがフォルダ名であることを明示する',
);
matchCode(
  projectStages,
  /プロジェクトID \(フォルダ名\)/,
  '基本設定でもプロジェクトIDがフォルダ名であることを明示する',
);
matchCode(
  main,
  /PROJECT_SELECT_PARENT.*defaultPath.*showOpenDialog\(\{.*defaultPath: initialDirectory/s,
  '新規プロジェクトの作成先選択は入力済みパスを初期表示に使う',
);
matchCode(
  artifactService,
  /BATCH_STUDIO_ARTIFACT_ROOT/,
  'プロジェクト作成時に成果物配置rootを参照する',
);
matchCode(
  artifactService,
  /path\.join\(artifactRoot,brief\.project\.id\)/,
  '成果物配置root直下へprojectIdのフォルダを割り当てる',
);
matchCode(
  artifactService,
  /mkdir\(artifactOutputPath,\{recursive:true\}\)/,
  '成果物側のプロジェクトフォルダを作成する',
);
matchCode(
  artifactService,
  /settings:artifactOutputPath\?\{artifactOutputPath\}:\{\}/,
  '成果物フォルダをproject metaへ記録する',
);

console.log('Project/artifact root tests passed.');
