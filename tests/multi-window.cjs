const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { matchCode, doesNotMatchCode } = require('./source-match.cjs');

const repo = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(repo, 'src', 'main', 'main.ts'), 'utf8');
const app = fs.readFileSync(path.join(repo, 'src', 'renderer', 'App.tsx'), 'utf8');
const preload = fs.readFileSync(path.join(repo, 'src', 'preload', 'index.cjs'), 'utf8');

matchCode(main, /const projectWindows=new Map<number,ProjectWindowState>\(\)/);
matchCode(main, /function projectWindowForSender\(contents:WebContents\)/);
matchCode(main, /projectWindowForSender\(event\.sender\)/);
matchCode(main, /function projectWindowForRoot\(/);
matchCode(main, /createProjectWindow\(\{restoreLastProject:true\}\)/);
matchCode(main, /rememberMostRecentOpenProject\(false\)/);
matchCode(main, /const windowId=window\.id/);
matchCode(main, /projectWindows\.delete\(windowId\)/);
doesNotMatchCode(
  main,
  /window\.on\('closed',[\s\S]*?projectWindows\.delete\(window\.id\)/,
  'Closed handlers must not access BaseWindow properties after Electron destroys the native window',
);
matchCode(main, /app\.requestSingleInstanceLock\(\)/);
matchCode(main, /app\.on\('second-instance'/);
matchCode(main, /executionCoordinator\.hasActiveRuns\(\)/);
matchCode(main, /executionCoordinator\.startLocal/);
matchCode(main, /executionCoordinator\.startRemote/);
matchCode(main, /IPC\.PROJECT_MENU_COMMAND/);
matchCode(app, /project\.onMenuCommand/);
matchCode(preload, /PROJECT_MENU_COMMAND/);
matchCode(main, /label: 'ファイル'/);
matchCode(main, /label: '編集'/);
matchCode(main, /label: '表示'/);
matchCode(main, /label: 'ウィンドウ'/);
matchCode(main, /label: 'R2 File Manager'/);
matchCode(main, /label: 'Civit Explorer'/);
matchCode(main, /label: 'Vast.ai'/);
matchCode(main, /label: '現在のフォルダを開く'/);
matchCode(main, /label: '設定'/);
matchCode(main, /label: 'プロジェクトを閉じる'/);
matchCode(main, /RECENT_PROJECT_MENU_LIMIT=5/, 'ネイティブの履歴メニューは最大5件');
matchCode(
  main,
  /recentRoots\.slice\(0,RECENT_PROJECT_MENU_LIMIT\)/,
  '保存件数とは独立して5件に制限する',
);
matchCode(
  main,
  /label:'最近開いたプロジェクト',submenu:recentProjectSubmenu\.length\?recentProjectSubmenu/,
  '「最近開いたプロジェクト」は右側に展開するネイティブサブメニューとする',
);
matchCode(main, /最近開いたプロジェクトはありません.*?enabled:false/, '履歴が空なら無効状態を表示');
matchCode(main, /openRecentProjectFromMenu\(root\)/, '履歴からプロジェクトを開く');
matchCode(
  main,
  /projectWindowForRoot\(root\).*?focusProjectWindow\(existing\)/s,
  '既存のWindowに切り替える',
);
matchCode(main, /chooseProjectOpeningTarget\(\)/, '既存のWindow選択方法を共用する');
matchCode(
  main,
  /await refreshRecentProjectMenu\(\);createProjectWindow\(\{restoreLastProject:true\}\)/,
  '起動時に履歴メニューを表示',
);
matchCode(
  main,
  /IPC\.PROJECT_REMOVE_RECENT.*?refreshRecentProjectMenu\(\)/s,
  'ホームの履歴削除をメニューへ反映',
);
doesNotMatchCode(main, /role: 'viewMenu'/, 'View menu must be explicitly localized');
doesNotMatchCode(main, /toggleDevTools/, 'Developer Tools must not be exposed in the native menu');
matchCode(app, /command === 'settings'/);
matchCode(app, /command === 'close'/);
doesNotMatchCode(app, />開く<\/button>/, 'Header must not duplicate the native Open command');
doesNotMatchCode(app, />新規作成<\/button>/, 'Header must not duplicate the native New command');
doesNotMatchCode(app, />環境設定<\/button>/, 'Settings must live in the native File menu');
doesNotMatchCode(app, />フォルダー<\/button>/, 'Open folder must live in the native File menu');
doesNotMatchCode(
  app,
  />プロジェクトを閉じる<\/button>/,
  'Close Project must live in the native File menu',
);

doesNotMatchCode(
  main,
  /let mainWindow:/,
  'Project windows must not use a single global mainWindow',
);
doesNotMatchCode(main, /let grokView:/, 'Legacy Grok Web views must be removed');
doesNotMatchCode(main, /let codexView:/, 'Legacy Codex views must be removed');
doesNotMatchCode(main, /grokLoadingView|GROK_PARTITION|GrokNavigationQueue/);

matchCode(
  main,
  /assistantView:WebContentsView/,
  'Project windows must own one provider-neutral AssistantPane view',
);
matchCode(
  main,
  /window\.contentView\.addChildView\(localView\).*?window\.contentView\.addChildView\(assistantView\)/s,
  'Project windows must contain the local UI and one AssistantPane view',
);
matchCode(
  main,
  /state\.assistantView\.setBounds/,
  'Project window layout must size the common AssistantPane',
);
matchCode(
  main,
  /loadRenderer\(assistantView,'assistant-pane'\)/,
  'The right pane must load the common AssistantPane renderer',
);
matchCode(
  app,
  /assistant\.setVisible\(true\).*?assistant\.setContext\(project\.rootPath,context\)/s,
  'Renderer must reserve the AssistantPane and select the common context',
);

matchCode(
  main,
  /executionCoordinator\.startRemote\(ref,provider,instanceId,\(\)=>prepareRemoteExecution\(root,run\.runId\)\)/,
  'Remote resource lock must be acquired by the coordinator before remote preparation starts',
);

console.log('Multi-window architecture tests passed.');
