const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-navigation-'));
const tscBin = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(process.execPath, [tscBin, '-p', path.join(repo, 'tsconfig.electron.json'), '--outDir', runtime], {
  cwd: repo,
  stdio: 'inherit'
});

(async () => {
  const navigation = await import(pathToFileURL(path.join(runtime, 'main', 'grok-navigation.js')).href);

  assert.equal(navigation.isGrokNavigationUrl('https://grok.com/'), true);
  assert.equal(navigation.isGrokNavigationUrl('https://accounts.google.com/o/oauth2/v2/auth'), true);
  assert.equal(navigation.isGrokNavigationUrl('https://x.ai/'), true);
  assert.equal(navigation.isGrokNavigationUrl('https://auth.x.ai/callback'), true);
  assert.equal(navigation.isGrokNavigationUrl('https://example.com/callback'), false);

  assert.equal(navigation.isOAuthPopupUrl('https://accounts.google.com/o/oauth2/v2/auth'), true);
  assert.equal(navigation.isOAuthPopupUrl('https://example.com/'), false);

  assert.equal(navigation.isSecureWebUrl('https://example.com/oauth/callback'), true,
    'an OAuth popup must be able to follow HTTPS redirects without opening the OS browser');
  assert.equal(navigation.isSecureWebUrl('http://example.com/oauth/callback'), false,
    'OAuth redirect chains must remain HTTPS-only');
  assert.equal(navigation.isSecureWebUrl('javascript:alert(1)'), false);

  console.log('Grok OAuth navigation tests passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
