const assert = require('node:assert/strict');
const { matchCode, doesNotMatchCode } = require('./source-match.cjs');
const fs = require('node:fs');
const path = require('node:path');
const repo = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(repo, p), 'utf8');

const appSettings = read('src/main/app-settings.ts');
const artifactService = read('src/main/artifact-service.ts');
const environmentSettings = read('src/renderer/EnvironmentSettings.tsx');
const app = read('src/renderer/App.tsx');

matchCode(appSettings, /interface StoredAppSettingsV6/, '環境設定schema v6を持つ');
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
matchCode(environmentSettings, /GitHub PAT/, '環境設定でGitHub PATを設定できる');

matchCode(
  app,
  /projectRoot.*setParent\(projectRoot\)/s,
  '新規プロジェクト作成先の初期値へProject rootを反映する',
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
