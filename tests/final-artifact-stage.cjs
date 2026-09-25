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

async function testPreviewAuthorizationWithoutDirectoryScans() {
  const os = require('node:os');
  const promises = require('node:fs/promises');
  const source = fs.readFileSync(
    path.join(repo, 'src', 'main', 'final-artifact-image-service.ts'),
    'utf8',
  );
  const authorization = source
    .slice(
      source.indexOf('export async function assertFinalArtifactImage('),
      source.indexOf('\nexport async function readImageSource('),
    )
    .replace(/^export /, '')
    .replace(/: string/g, '');
  const temp = await promises.mkdtemp(
    path.join(require('node:os').tmpdir(), 'final-artifact-auth-'),
  );
  const directory = path.join(temp, 'output');
  const outside = path.join(temp, 'output2');
  let scans = 0;
  const fakeFs = {
    ...promises,
    readdir: (...args) => {
      scans += 1;
      return promises.readdir(...args);
    },
  };
  const authorize = new Function(
    'path',
    'readProjectMeta',
    'realpath',
    'lstat',
    'FINAL_ARTIFACT_IMAGE_MIME_TYPES',
    'pathKey',
    'listImageFiles',
    'getFinalArtifactStatus',
    `return ${authorization}; return assertFinalArtifactImage;`,
  )(
    path,
    async () => ({ settings: { finalArtifactDirectory: directory } }),
    fakeFs.realpath,
    fakeFs.lstat,
    { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' },
    (value) =>
      process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value),
    () => {
      throw new Error('full scan');
    },
    () => {
      throw new Error('full scan');
    },
  );
  try {
    await promises.mkdir(directory);
    await promises.mkdir(outside);
    const items = Array.from({ length: 500 }, (_, index) =>
      path.join(directory, `image-${index}.png`),
    );
    await Promise.all(items.map((file) => promises.writeFile(file, 'image')));
    for (const file of items)
      require('node:assert/strict').equal(await authorize(temp, file), file);
    require('node:assert/strict').equal(scans, 0, 'authorization must not enumerate the directory');
    const external = path.join(outside, 'outside.png');
    await promises.writeFile(external, 'image');
    await require('node:assert/strict').rejects(authorize(temp, external));
    await require('node:assert/strict').rejects(authorize(temp, directory));
    await require('node:assert/strict').rejects(
      authorize(temp, path.join(directory, 'missing.png')),
    );
    await require('node:assert/strict').rejects(
      authorize(temp, path.join(directory, 'image-0.txt')),
    );
    const link = path.join(directory, 'link.png');
    await promises.symlink(external, link);
    await require('node:assert/strict').rejects(authorize(temp, link));
    require('node:assert/strict').equal(scans, 0);
  } finally {
    await promises.rm(temp, { recursive: true, force: true });
  }
}

testPreviewAuthorizationWithoutDirectoryScans().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
