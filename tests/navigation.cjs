const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const uiSource=fs.readFileSync(path.join(repo,'src','renderer','ui.tsx'),'utf8');
const appSource=fs.readFileSync(path.join(repo,'src','renderer','App.tsx'),'utf8');
const executionSource=fs.readFileSync(path.join(repo,'src','renderer','ExecutionStages.tsx'),'utf8');
const mainSource=fs.readFileSync(path.join(repo,'src','main','main.ts'),'utf8');
assert.match(uiSource,/実行前チェック','実行'/,'Project navigation must place 実行 after 実行前チェック');
assert.match(appSource,/case'実行':return <ExecutionStage/,'実行 stage must render ExecutionStage');
assert.match(executionSource,/execution\.status\(project\.rootPath\)/,'ExecutionStage must restore and poll the persistent current Run');
assert.match(executionSource,/Stop scheduling/);
assert.match(executionSource,/Force interrupt/);
assert.match(executionSource,/current\.controls\.scheduling!=='STOPPED'/,'Stop scheduling must remain available until the Run has actually stopped scheduling');
assert.match(executionSource,/current\.controls\.interrupt!=='INTERRUPTED'/,'Force interrupt must remain available until interruption is confirmed');
assert.match(executionSource,/current\.phase==='EXECUTING'/,'Force interrupt must only be enabled during EXECUTING');
assert.match(executionSource,/canStopScheduling/,'Stop scheduling availability must be derived explicitly from Run phase');
assert.match(mainSource,/isRemotePreGenerationPhase\(run\.phase\)/,'pre-generation remote Stop scheduling must be handled locally');
assert.match(mainSource,/r\.lifecycle='PAUSED'/,'pre-generation remote Stop scheduling must pause the Run');
assert.match(mainSource,/Force interrupt is only available while Remote Execution is EXECUTING/,'pre-generation Force interrupt must be rejected without contacting the worker');
assert.match(executionSource,/REMOTE_COMFYUI_RELEASE_CHECKING/,'ComfyUI release lookup must be visible as its own Execution phase');
assert.match(executionSource,/REMOTE_COMFYUI_RELEASE_FETCHING/,'ComfyUI release fetch must be visible as its own Execution phase');
assert.match(executionSource,/REMOTE_COMFYUI_CHECKING_OUT/,'ComfyUI checkout must be visible as its own Execution phase');
assert.match(executionSource,/REMOTE_COMFYUI_REQUIREMENTS_INSTALLING/,'ComfyUI requirements installation must be visible as its own Execution phase');
assert.match(executionSource,/REMOTE_COMFYUI_MANAGER_CONFIGURING/,'ComfyUI Manager configuration must be visible as its own Execution phase');
assert.match(executionSource,/CLOUD INSTANCE STARTING · SCHEDULING/,'scheduling provider state must be visible in the current phase label');
assert.match(executionSource,/Vast\.ai status: scheduling · GPU Instanceの割り当て待ちです。/,'scheduling provider state must explain that the Instance is waiting for allocation');
assert.match(executionSource,/remoteLifecycle\?\.latest\?\.status/,'cloud lifecycle status display must use the persisted provider snapshot');
assert.match(executionSource,/Artifact delivery completed/,'generation completion and artifact delivery completion must remain distinct');
assert.match(executionSource,/Startできない理由/,'blocked Preflight reason must be visible');
assert.match(executionSource,/既存Runが実行中のため新規Startできません/,'READY banner must not claim Start is possible while a Run is active');
assert.match(executionSource,/既存Runが未完了です。新規StartではなくResumeで再開してください/,'paused or interrupted Runs must direct the user to Resume');
assert.match(executionSource,/preflight '\+\(canStart\?'ready':'blocked'\)/,'banner styling must use the same canStart decision as the Start button');
assert.match(executionSource,/current\?\.lifecycle!==\'COMPLETED\'/,'output directory action must remain gated until completion');
assert.match(executionSource,/artifactOutputPath\?\?project\.rootPath/,'completed Run must open the configured local artifact output directory with a legacy fallback');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-navigation-'));
const tscBin = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(process.execPath, [tscBin, '-p', path.join(repo, 'tsconfig.electron.json'), '--outDir', runtime], {
  cwd: repo,
  stdio: 'inherit'
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

(async () => {
  const navigation = await import(pathToFileURL(path.join(runtime, 'main', 'grok-navigation.js')).href);
  const queueModule = await import(pathToFileURL(path.join(runtime, 'main', 'grok-navigation-queue.js')).href);

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

  assert.equal(
    navigation.canonicalGrokConversationUrl('https://grok.com/c/cb299d7e-9036-4d0f-abd7-299a70165fbd?rid=fb6b2d18-3388-4826-8b76-700b4a130131'),
    'https://grok.com/c/cb299d7e-9036-4d0f-abd7-299a70165fbd',
    'conversation restore state must not retain rid/query parameters'
  );
  assert.equal(navigation.canonicalGrokConversationUrl('https://grok.com/'), null);
  assert.equal(navigation.canonicalGrokConversationUrl('https://grok.com/share/example'), null);
  assert.equal(navigation.canonicalGrokConversationUrl('https://example.com/c/example'), null);

  assert.equal(queueModule.isNavigationAbortedError(Object.assign(new Error('ERR_ABORTED'), { code: -3 })), true);
  assert.equal(queueModule.isNavigationAbortedError(new Error("(-3) loading 'https://grok.com/c/example'")), true);
  assert.equal(queueModule.isNavigationAbortedError(Object.assign(new Error('ERR_NAME_NOT_RESOLVED'), { code: -105 })), false);

  {
    const queue = new queueModule.GrokNavigationQueue();
    let current = 'https://grok.com/';
    let calls = 0;
    const gate = deferred();
    const contents = {
      getURL: () => current,
      loadURL: async target => {
        calls += 1;
        await gate.promise;
        current = target;
      }
    };
    const target = 'https://grok.com/c/38723657-88b2-4e2e-842b-ce0342d32fa3';
    const first = queue.navigate(contents, target);
    const duplicate = queue.navigate(contents, target);
    assert.strictEqual(duplicate, first, 'duplicate navigation to the same conversation must share one pending request');
    gate.resolve();
    await Promise.all([first, duplicate]);
    assert.equal(calls, 1, 'duplicate navigation must call loadURL only once');
  }

  {
    const queue = new queueModule.GrokNavigationQueue();
    let current = 'https://grok.com/';
    const firstGate = deferred();
    const calls = [];
    const contents = {
      getURL: () => current,
      loadURL: async target => {
        calls.push(target);
        if (calls.length === 1) await firstGate.promise;
        current = target;
      }
    };
    const first = queue.navigate(contents, 'https://grok.com/c/story');
    const second = queue.navigate(contents, 'https://grok.com/c/models');
    await Promise.resolve();
    assert.deepEqual(calls, ['https://grok.com/c/story'], 'different conversation loads must be serialized');
    firstGate.resolve();
    await Promise.all([first, second]);
    assert.deepEqual(calls, ['https://grok.com/c/story', 'https://grok.com/c/models']);
  }

  {
    const queue = new queueModule.GrokNavigationQueue();
    let current = 'https://grok.com/';
    const target = 'https://grok.com/c/arrived';
    const contents = {
      getURL: () => current,
      loadURL: async () => {
        current = `${target}?rid=redirected`;
        throw Object.assign(new Error('ERR_ABORTED'), { code: -3 });
      }
    };
    await queue.navigate(contents, target);
  }

  {
    const queue = new queueModule.GrokNavigationQueue();
    const contents = {
      getURL: () => 'https://grok.com/',
      loadURL: async () => { throw Object.assign(new Error('ERR_ABORTED'), { code: -3 }); }
    };
    await assert.rejects(
      queue.navigate(contents, 'https://grok.com/c/not-arrived'),
      error => error?.code === -3,
      'ERR_ABORTED must remain visible when the requested destination was not reached'
    );
  }

  {
    const queue = new queueModule.LatestGrokContextQueue();
    let calls = 0;
    const gate = deferred();
    const first = queue.run('project\0story', async isLatest => {
      calls += 1;
      await gate.promise;
      return isLatest() ? 'story-current' : 'story-superseded';
    });
    const duplicate = queue.run('project\0story', async () => {
      calls += 1;
      return 'unexpected';
    });
    assert.strictEqual(duplicate, first, 'duplicate set-context requests must share the pending operation');
    gate.resolve();
    assert.equal(await first, 'story-current');
    assert.equal(calls, 1);
  }

  {
    const queue = new queueModule.LatestGrokContextQueue();
    const gate = deferred();
    const events = [];
    const story = queue.run('project\0story', async isLatest => {
      events.push('story-start');
      await gate.promise;
      events.push(isLatest() ? 'story-current' : 'story-superseded');
      return 'story';
    });
    await Promise.resolve();
    const models = queue.run('project\0models', async isLatest => {
      events.push(isLatest() ? 'models-current' : 'models-superseded');
      return 'models';
    });
    gate.resolve();
    await Promise.all([story, models]);
    assert.deepEqual(events, ['story-start', 'story-superseded', 'models-current'],
      'a rapid stage switch must mark the older context request stale before the newer request runs');
  }

  console.log('Grok OAuth/navigation tests passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
