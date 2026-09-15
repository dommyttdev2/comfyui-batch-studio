const fs = require('node:fs');
const path = require('node:path');
const { matchCode, doesNotMatchCode } = require('./source-match.cjs');

const repo = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(repo, 'src', 'renderer', 'ui.tsx'), 'utf8');
const app = fs.readFileSync(path.join(repo, 'src', 'renderer', 'App.tsx'), 'utf8');
const stage = fs.readFileSync(path.join(repo, 'src', 'renderer', 'FinalArtifactStage.tsx'), 'utf8');
const service = fs.readFileSync(
  path.join(repo, 'src', 'main', 'final-artifact-service.ts'),
  'utf8',
);
const caption = fs.readFileSync(path.join(repo, 'src', 'main', 'caption-service.ts'), 'utf8');
const main = fs.readFileSync(path.join(repo, 'src', 'main', 'main.ts'), 'utf8');
const preload = fs.readFileSync(path.join(repo, 'src', 'preload', 'index.cjs'), 'utf8');
const types = fs.readFileSync(path.join(repo, 'src', 'shared', 'types.ts'), 'utf8');

matchCode(
  ui,
  /'実行',\s*'最終成果物',\s*'キャプション'/,
  'final artifact stage must sit between execution and caption',
);
matchCode(
  app,
  /case '最終成果物':\s*return <FinalArtifactStage/,
  'final artifact stage must render',
);
matchCode(
  types,
  /finalArtifactDirectory\?: string/,
  'final artifact directory must have a project-level setting',
);
matchCode(
  service,
  /finalArtifactDirectory\?\.trim\(\)[\s\S]*captionSourceDirectory\?\.trim\(\)/,
  'legacy caption source settings must remain readable',
);
matchCode(
  service,
  /new Set\(\['\.png', '\.jpg', '\.jpeg', '\.webp'\]\)/,
  'final artifact image count must use supported image extensions',
);
doesNotMatchCode(
  service,
  /entry\.isDirectory\(\)/,
  'final artifact image count must only count direct child files',
);
matchCode(
  stage,
  /finalArtifact\.selectDirectory/,
  'final artifact stage must own directory selection',
);
matchCode(stage, /finalArtifact\.status/, 'final artifact stage must support rescanning');
matchCode(main, /IPC\.FINAL_ARTIFACT_STATUS/, 'main process must expose final artifact status');
matchCode(
  main,
  /saveProjectSettings\(root, \{ finalArtifactDirectory: result\.filePaths\[0\] \}\)/,
  'directory selection must persist the final artifact setting',
);
matchCode(
  preload,
  /finalArtifact:[\s\S]*status:[\s\S]*selectDirectory:/,
  'preload must expose the final artifact API',
);
matchCode(
  caption,
  /getFinalArtifactStatus\(root\)/,
  'caption must read its image source from the final artifact service',
);

console.log('Final artifact stage contract tests passed.');
