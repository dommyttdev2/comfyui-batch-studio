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
  const vm = require('node:vm');
  const ts = require('typescript');
  const promises = require('node:fs/promises');
  const source = fs.readFileSync(
    path.join(repo, 'src', 'main', 'final-artifact-image-service.ts'),
    'utf8',
  );
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const temp = await promises.mkdtemp(path.join(os.tmpdir(), 'final-artifact-auth-'));
  const directory = path.join(temp, 'output');
  const outside = path.join(temp, 'output2');
  let scans = 0;
  const moduleExports = {};
  const fakeFs = {
    ...promises,
    readdir: (...args) => {
      scans += 1;
      return promises.readdir(...args);
    },
  };
  const context = {
    exports: moduleExports,
    module: { exports: moduleExports },
    process,
    require: (name) => {
      if (name === 'node:fs/promises') return fakeFs;
      if (name === 'node:path') return path;
      if (name === './project-meta.js')
        return {
          readProjectMeta: async () => ({
            settings: { finalArtifactDirectory: directory },
          }),
        };
      if (name === './final-artifact-service.js')
        return {
          getFinalArtifactStatus: () => {
            throw new Error('full scan');
          },
        };
      if (name === './image-pipeline.js') return {};
      throw new Error(`Unexpected import: ${name}`);
    },
  };
  vm.runInNewContext(js, context, { filename: 'final-artifact-image-service.js' });
  try {
    await promises.mkdir(directory);
    await promises.mkdir(outside);
    const items = Array.from({ length: 500 }, (_, index) =>
      path.join(directory, `image-${index}.png`),
    );
    await Promise.all(items.map((file) => promises.writeFile(file, 'image')));
    for (const file of items)
      require('node:assert/strict').equal(
        await context.module.exports.assertFinalArtifactImage(temp, file),
        file,
      );
    require('node:assert/strict').equal(scans, 0, 'authorization must not enumerate the directory');
    const external = path.join(outside, 'outside.png');
    await promises.writeFile(external, 'image');
    await require('node:assert/strict').rejects(
      context.module.exports.assertFinalArtifactImage(temp, external),
    );
    await require('node:assert/strict').rejects(
      context.module.exports.assertFinalArtifactImage(temp, directory),
    );
    await require('node:assert/strict').rejects(
      context.module.exports.assertFinalArtifactImage(temp, path.join(directory, 'missing.png')),
    );
    await require('node:assert/strict').rejects(
      context.module.exports.assertFinalArtifactImage(temp, path.join(directory, 'image-0.txt')),
    );
    const link = path.join(directory, 'link.png');
    await promises.symlink(external, link);
    await require('node:assert/strict').rejects(
      context.module.exports.assertFinalArtifactImage(temp, link),
    );
    require('node:assert/strict').equal(scans, 0);
  } finally {
    await promises.rm(temp, { recursive: true, force: true });
  }
}

testPreviewAuthorizationWithoutDirectoryScans().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
