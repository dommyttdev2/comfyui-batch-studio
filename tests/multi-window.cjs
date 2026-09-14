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
matchCode(main, /app\.requestSingleInstanceLock\(\)/);
matchCode(main, /app\.on\('second-instance'/);
matchCode(main, /executionCoordinator\.hasActiveRuns\(\)/);
matchCode(main, /executionCoordinator\.startLocal/);
matchCode(main, /executionCoordinator\.startRemote/);
matchCode(main, /IPC\.PROJECT_MENU_COMMAND/);
matchCode(app, /project\.onMenuCommand/);
matchCode(preload, /PROJECT_MENU_COMMAND/);

doesNotMatchCode(main, /let mainWindow:/, 'Project windows must not use a single global mainWindow');
doesNotMatchCode(main, /let grokView:/, 'Grok views must be Project Window-local');
doesNotMatchCode(main, /let activeGrokContext:/, 'Grok context must be Project Window-local');

assert.ok(
  main.indexOf('executionCoordinator.startRemote') <
    main.indexOf('prepareRemoteExecution(root, run.runId)'),
  'Remote resource lock must be acquired by the coordinator before remote preparation starts',
);

console.log('Multi-window architecture tests passed.');
