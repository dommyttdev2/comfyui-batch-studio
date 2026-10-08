const { matchCode, doesNotMatchCode } = require('./source-match.cjs');
const fs = require('node:fs');
const path = require('node:path');
const repo = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(repo, p), 'utf8');
const { readMainProcessSource } = require('./main-process-source.cjs');

const appSettings = read('src/main/app-settings.ts');

const artifactService =
  read('src/main/artifact-service.ts') + read('src/application/artifact-file-service.ts');
matchCode(artifactService, /createArtifactFileService/);
const environmentSettings = read('src/renderer/EnvironmentSettings.tsx');
const app = read('src/renderer/App.tsx');
const projectStages = read('src/renderer/ProjectStages.tsx');
const main = readMainProcessSource(repo);

matchCode(appSettings, /interface StoredAppSettingsV7/, '環境設定schema v7を持つ');
doesNotMatchCode(
  appSettings,
  /remoteCustomNodes|workflow-custom-nodes/,
  'custom node dependencies must be absent',
);
matchCode(appSettings, /BATCH_STUDIO_GITHUB_PAT/, 'GitHub PATの環境変数fallbackを持つ');
matchCode(appSettings, /safeStorage/, 'GitHub PATをOSの暗号化ストレージへ保存する');
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
  /mkdir\(artifactOutputPath\)/,
  '成果物側のプロジェクトフォルダを作成する',
);
matchCode(
  artifactService,
  /initializeProjectMeta\(root,artifactOutputPath\?\{artifactOutputPath\}:\{\}\)/,
  '成果物フォルダを直列化されたproject meta初期化処理へ記録する',
);

console.log('Project/artifact root tests passed.');
