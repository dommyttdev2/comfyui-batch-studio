const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (process.platform !== 'win32') {
  console.log('update-release: skipped (requires Windows PowerShell)');
  process.exit(0);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-update-'));
const source = path.join(root, 'source');
const officialUrl = 'https://github.com/dommyttdev2/comfyui-batch-studio.git';
const updater = path.resolve(__dirname, '../scripts/update-release.ps1');
const env = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: path.join(root, 'empty-gitconfig'),
  GIT_AUTHOR_NAME: 'Updater Test',
  GIT_AUTHOR_EMAIL: 'updater@example.invalid',
  GIT_COMMITTER_NAME: 'Updater Test',
  GIT_COMMITTER_EMAIL: 'updater@example.invalid',
};

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout.trim();
}

function quote(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

let caseNumber = 0;
function fixture() {
  const checkout = path.join(root, `checkout ${++caseNumber}`);
  git(root, 'clone', '--no-tags', source, checkout);
  git(checkout, 'checkout', '--detach', oldCommit);
  // Exercise the real fetch/checkout with a local repository, without network.
  git(checkout, 'config', `url.${source.replaceAll('\\', '/')}.insteadOf`, officialUrl);
  return checkout;
}

function update(
  checkout,
  response = "@{ tag_name = 'v0.10.0'; draft = $false; prerelease = $false }",
) {
  const harness = path.join(root, 'invoke-update.ps1');
  fs.writeFileSync(
    harness,
    `function Invoke-RestMethod {
      param($Uri, $Headers, $TimeoutSec)
      if ($Uri -ne 'https://api.github.com/repos/dommyttdev2/comfyui-batch-studio/releases/latest') { throw 'Unexpected release API' }
      ${response}
    }
    & ${quote(path.join(checkout, 'scripts/update-release.ps1'))}
    exit $LASTEXITCODE
    `,
  );
  return spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', harness],
    {
      cwd: root,
      env,
      encoding: 'utf8',
      timeout: 30000,
    },
  );
}

function expectFailure(checkout, response, message) {
  const before = git(checkout, 'rev-parse', 'HEAD');
  const result = update(checkout, response);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, message);
  assert.equal(git(checkout, 'rev-parse', 'HEAD'), before);
}

let oldCommit;
try {
  fs.mkdirSync(path.join(source, 'scripts'), { recursive: true });
  fs.copyFileSync(updater, path.join(source, 'scripts/update-release.ps1'));
  fs.writeFileSync(path.join(source, 'version.txt'), 'old');
  git(source, 'init');
  git(source, 'add', '.');
  git(source, 'commit', '-m', 'old release');
  oldCommit = git(source, 'rev-parse', 'HEAD');
  git(source, 'tag', 'v0.9.0');
  fs.writeFileSync(path.join(source, 'version.txt'), 'stable');
  fs.writeFileSync(path.join(source, 'release-only.txt'), 'release file');
  git(source, 'add', '.');
  git(source, 'commit', '-m', 'stable release');
  const releaseCommit = git(source, 'rev-parse', 'HEAD');
  git(source, 'tag', '-a', 'v0.10.0', '-m', 'stable release');
  fs.writeFileSync(path.join(source, 'version.txt'), 'unreleased');
  git(source, 'add', '.');
  git(source, 'commit', '-m', 'unreleased development');
  git(source, 'tag', 'v0.11.0-rc.1');

  const clean = fixture();
  fs.writeFileSync(path.join(clean, 'user-data.txt'), 'keep me');
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = update(clean);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(git(clean, 'rev-parse', 'HEAD'), releaseCommit, result.stdout + result.stderr);
    assert.equal(git(clean, 'rev-parse', '--abbrev-ref', 'HEAD'), 'HEAD');
    assert.equal(fs.readFileSync(path.join(clean, 'version.txt'), 'utf8'), 'stable');
    assert.equal(fs.readFileSync(path.join(clean, 'user-data.txt'), 'utf8'), 'keep me');
  }

  const dirty = fixture();
  fs.writeFileSync(path.join(dirty, 'version.txt'), 'local edit');
  expectFailure(dirty, undefined, /Uncommitted changes/);
  assert.equal(fs.readFileSync(path.join(dirty, 'version.txt'), 'utf8'), 'local edit');
  git(dirty, 'add', 'version.txt');
  expectFailure(dirty, undefined, /Uncommitted changes/);

  const collision = fixture();
  fs.writeFileSync(path.join(collision, 'release-only.txt'), 'local data');
  expectFailure(collision, undefined, /checkout.*failed/);
  assert.equal(fs.readFileSync(path.join(collision, 'release-only.txt'), 'utf8'), 'local data');

  const errors = fixture();
  expectFailure(errors, "throw 'Release API unavailable'", /Release API unavailable/);
  for (const response of [
    "@{ tag_name = 'v0.10.0'; draft = $true }",
    "@{ tag_name = 'v0.11.0-rc.1'; prerelease = $true }",
    "@{ tag_name = '--invalid' }",
    "@{ tag_name = 'v0.010.0' }",
    '@{}',
  ]) {
    expectFailure(errors, response, /valid stable version tag/);
  }
  expectFailure(errors, "@{ tag_name = 'v0.99.0' }", /fetch.*failed/);
  git(errors, 'tag', 'v0.10.0');
  expectFailure(errors, undefined, /fetch.*failed/);
  assert.equal(git(errors, 'rev-parse', 'v0.10.0'), oldCommit);
  console.log(
    'update-release: passed (stable release, repeat update, local edits, collisions, API/tag failures)',
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
