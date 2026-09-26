const assert = require('node:assert/strict');
const { matchCode, doesNotMatchCode } = require('./source-match.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const uiSource = fs.readFileSync(path.join(repo, 'src', 'renderer', 'ui.tsx'), 'utf8');
const appSource = fs.readFileSync(path.join(repo, 'src', 'renderer', 'App.tsx'), 'utf8');
const resetMenuSource = fs.readFileSync(
  path.join(repo, 'src', 'renderer', 'StageResetMenu.tsx'),
  'utf8',
);
const stylesSource = fs.readFileSync(path.join(repo, 'src', 'renderer', 'styles.css'), 'utf8');
const executionSource = fs.readFileSync(
  path.join(repo, 'src', 'renderer', 'ExecutionStages.tsx'),
  'utf8',
);
const remoteExecutionSource = fs.readFileSync(
  path.join(repo, 'src', 'main', 'remote-execution.ts'),
  'utf8',
);
const localExecutionSource = fs.readFileSync(
  path.join(repo, 'src', 'main', 'local-execution.ts'),
  'utf8',
);
const progressSource = fs.readFileSync(
  path.join(repo, 'src', 'shared', 'execution-progress.ts'),
  'utf8',
);
const mainSource = fs.readFileSync(path.join(repo, 'src', 'main', 'main.ts'), 'utf8');
matchCode(
  uiSource,
  /実行前チェック','実行'/,
  'Project navigation must place 実行 after 実行前チェック',
);
matchCode(appSource, /case'実行':return <ExecutionStage/, '実行 stage must render ExecutionStage');
matchCode(
  resetMenuSource,
  /catch\(cause\)[\s\S]*setResetError[\s\S]*role="alert"[\s\S]*resetRecoveryHint/,
  'stage reset failures must stay visible in the confirmation dialog with recovery guidance',
);
matchCode(
  resetMenuSource,
  /if\(busy\)return[\s\S]*disabled=\{busy\}[\s\S]*resetError\?'再試行':'リセットする'/,
  'stage reset retry must remain single-flight and explicit',
);
matchCode(
  appSource,
  /await window\.batchStudio\.artifact\.resetFrom\(project\.rootPath,scope\)[\s\S]*setProject\(next\)[\s\S]*setResetRevision/,
  'reset revision and project view may advance only after the reset succeeds',
);
matchCode(
  stylesSource,
  /nav\{position:sticky;top:var\(--app-header-height\);align-self:start;height:calc\(100vh-var\(--app-header-height\)\);overflow-y:auto;/,
  'Project stage navigation must stay sticky below the app header and scroll internally when needed',
);
matchCode(
  executionSource,
  /execution\.status\(project\.rootPath\)/,
  'ExecutionStage must restore and poll the persistent current Run',
);
matchCode(
  executionSource,
  /preflightError[\s\S]*runStatusError[\s\S]*runStorageError/,
  'Preflight, Run monitor and Run storage failures must use independent state',
);
matchCode(
  executionSource,
  /setPreflight\(value\)[\s\S]*setPreflightError\(''\)/,
  'only a successful Preflight refresh may clear the Preflight error',
);
matchCode(
  executionSource,
  /setCurrent\(value\)[\s\S]*setRunStatusError\(''\)/,
  'only a successful Run status refresh may clear the Run monitor error',
);
matchCode(
  executionSource,
  /preflightGeneration[\s\S]*runStatusGeneration[\s\S]*generation !== preflightGeneration\.current[\s\S]*generation !== runStatusGeneration\.current/,
  'stale Preflight and Run status responses must be ignored independently',
);
matchCode(
  executionSource,
  /Preflightを再試行[\s\S]*Run監視を再試行/,
  'Preflight and Run monitor failures must expose separate retry actions',
);
matchCode(
  executionSource,
  /\{\(canStopScheduling\|\|pauseRequestInFlight\)&&current&&\(<button/,
  'Only show pause when available, retaining feedback while the request is in flight',
);
matchCode(
  executionSource,
  /\{canForceInterrupt&&\(<button/,
  'Only show Force interrupt during an interruptible generation phase',
);
assert.doesNotMatch(executionSource, /<details className="execution-advanced-actions">/);
matchCode(
  executionSource,
  /<details className="execution-technical-details">/,
  'Run technical diagnostics must be available on demand',
);
matchCode(
  executionSource,
  /<details className="sectioncheck" key=\{s.name\} open=\{!s.valid\}>/,
  'Preflight must expand failing checks while keeping passing check details collapsed',
);
matchCode(
  executionSource,
  /cloudInstanceStatusMessage\(current\)&&\(/,
  'Remote cloud instance state must stay visible outside technical details',
);
matchCode(executionSource, /一時停止/);
matchCode(executionSource, /Force interrupt/);
matchCode(
  executionSource,
  /current\.controls\.scheduling==='ACTIVE'/,
  'Pause can be requested only before one has already been requested',
);
matchCode(
  executionSource,
  /current\.controls\.interrupt!=='INTERRUPTED'/,
  'Force interrupt must remain available until interruption is confirmed',
);
matchCode(
  executionSource,
  /current\.phase==='EXECUTING'/,
  'Force interrupt must only be enabled during EXECUTING',
);
matchCode(
  executionSource,
  /canStopScheduling/,
  'Stop scheduling availability must be derived explicitly from Run phase',
);
matchCode(
  mainSource,
  /isRemotePreGenerationPhase\(run\.phase\)/,
  'pre-generation remote Stop scheduling must be handled locally',
);
matchCode(
  mainSource,
  /r\.lifecycle='PAUSED'/,
  'pre-generation remote Stop scheduling must pause the Run',
);
matchCode(
  mainSource,
  /Force interrupt is only available while Remote Execution is EXECUTING/,
  'pre-generation Force interrupt must be rejected without contacting the worker',
);
matchCode(
  executionSource,
  /REMOTE_COMFYUI_RELEASE_CHECKING/,
  'ComfyUI release lookup must be visible as its own Execution phase',
);
matchCode(
  executionSource,
  /REMOTE_COMFYUI_RELEASE_FETCHING/,
  'ComfyUI release fetch must be visible as its own Execution phase',
);
matchCode(
  executionSource,
  /REMOTE_COMFYUI_CHECKING_OUT/,
  'ComfyUI checkout must be visible as its own Execution phase',
);
matchCode(
  executionSource,
  /REMOTE_COMFYUI_REQUIREMENTS_INSTALLING/,
  'ComfyUI requirements installation must be visible as its own Execution phase',
);
matchCode(
  executionSource,
  /REMOTE_COMFYUI_MANAGER_CONFIGURING/,
  'ComfyUI Manager configuration must be visible as its own Execution phase',
);
matchCode(
  executionSource,
  /CLOUD INSTANCE STARTING · SCHEDULING/,
  'scheduling provider state must be visible in the current phase label',
);
matchCode(
  executionSource,
  /Vast\.ai status: scheduling · GPU Instanceの割り当て待ちです。/,
  'scheduling provider state must explain that the Instance is waiting for allocation',
);
matchCode(
  executionSource,
  /effectiveCloudInstanceStatus/,
  'cloud lifecycle status display must derive a user-facing provider state',
);
matchCode(
  executionSource,
  /lifecycle\?\.startRequestedAt/,
  'accepted Vast start requests must distinguish restart scheduling from a truly stopped Instance',
);
matchCode(
  executionSource,
  /next_state=/,
  'scheduling details must expose the raw provider state used for diagnosis',
);
matchCode(
  executionSource,
  /readyForNewRun/,
  'Execution UI must make Start available after safe discard without navigating',
);
matchCode(
  executionSource,
  /現在のRunを破棄/,
  'Execution UI must expose discard as an independent action',
);
assert.doesNotMatch(executionSource, /別のRunとして実行する/);
assert.doesNotMatch(executionSource, /execution\.restartRemote/);
assert.doesNotMatch(executionSource, /execution\.restartFromScratch/);
matchCode(executionSource, /一時停止を要求中…/, 'Pause action must provide immediate feedback');
matchCode(executionSource, /再開/, 'Resume action must use the user-facing Japanese label');
matchCode(
  mainSource,
  /IPC\.EXECUTION_RESTART_FROM_SCRATCH/,
  'Main Process must implement restart-from-scratch IPC',
);
matchCode(
  mainSource,
  /Localへ回収済みの成果物は削除しません/,
  'fresh restart confirmation must explicitly preserve local collected artifacts',
);
matchCode(
  mainSource,
  /discardExecutionRun/,
  'fresh restart must terminalize the old Run before creating a new Run',
);
matchCode(
  remoteExecutionSource,
  /discardArtifacts/,
  'fresh restart must clean old Remote\/R2 artifacts separately from Local output',
);
matchCode(
  remoteExecutionSource,
  /applyRemoteProgressEvent/,
  'Remote generation progress must be applied from streamed Worker progress events',
);
matchCode(
  remoteExecutionSource,
  /event\.type!==['"]progress['"]/,
  'Remote generation must ignore non-progress Worker events during live synchronization',
);
matchCode(
  remoteExecutionSource,
  /overallCompleted/,
  'Generation progress must synchronize the Remote Worker overallCompleted counter',
);
matchCode(
  executionSource,
  /推定残り時間/,
  'Generation progress must display an estimated remaining time',
);
matchCode(
  executionSource,
  /直近 \{generationSamples\} \/ 5枚の移動平均/,
  'Generation ETA must explain its five-image moving-average window',
);
matchCode(
  progressSource,
  /GENERATION_TIMING_WINDOW=5/,
  'generation ETA must use a five-image moving window',
);
matchCode(
  progressSource,
  /estimatedGenerationRemainingMs/,
  'shared progress logic must calculate remaining generation time',
);
matchCode(
  remoteExecutionSource,
  /markGenerationStarted\(run,promptId\)/,
  'Remote generation timing must start from streamed prompt submission',
);
matchCode(
  remoteExecutionSource,
  /markGenerationCompleted\(run\)/,
  'Remote generation timing must finish on prompt success',
);
matchCode(
  localExecutionSource,
  /markGenerationStarted\(r,lastPromptId\)/,
  'Local generation timing must start when a prompt is submitted',
);
matchCode(
  localExecutionSource,
  /markGenerationCompleted\(r\)/,
  'Local generation timing must finish on prompt success',
);
matchCode(
  mainSource,
  /IPC\.EXECUTION_RESTART_REMOTE/,
  'Main Process must implement replacement-Run IPC',
);
matchCode(
  mainSource,
  /REMOTE_INSTANCE_REPLACED/,
  'replacement must terminalize the old Run with an explicit history reason',
);
matchCode(
  mainSource,
  /isRemotePreGenerationPhase\(current\.phase\)/,
  'Instance replacement must be limited to pre-generation phases',
);
matchCode(
  executionSource,
  /Artifact delivery completed/,
  'generation completion and artifact delivery completion must remain distinct',
);
matchCode(executionSource, /Startできない理由/, 'blocked Preflight reason must be visible');
matchCode(
  executionSource,
  /生成中です。「一時停止」/,
  'READY banner must not claim Start is possible while a Run is active',
);
matchCode(
  executionSource,
  /既存Runは未完了です。生成を続ける場合は「再開」/,
  'paused or interrupted Runs must direct the user to Resume',
);
matchCode(
  executionSource,
  /preflight '\+\(canStart\?'ready':'blocked'\)/,
  'banner styling must use the same canStart decision as the Start button',
);
matchCode(
  executionSource,
  /current\?\.lifecycle!==\'COMPLETED\'/,
  'output directory action must remain gated until completion',
);
matchCode(
  executionSource,
  /artifactOutputPath\?\?project\.rootPath/,
  'completed Run must open the configured local artifact output directory with a legacy fallback',
);
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-navigation-'));
const tscBin = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(
  process.execPath,
  [tscBin, '-p', path.join(repo, 'tsconfig.electron.json'), '--outDir', runtime],
  {
    cwd: repo,
    stdio: 'inherit',
  },
);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

(async () => {
  const navigation = await import(
    pathToFileURL(path.join(runtime, 'main', 'grok-navigation.js')).href
  );
  const queueModule = await import(
    pathToFileURL(path.join(runtime, 'main', 'grok-navigation-queue.js')).href
  );

  assert.equal(navigation.isGrokNavigationUrl('https://grok.com/'), true);
  assert.equal(
    navigation.isGrokNavigationUrl('https://accounts.google.com/o/oauth2/v2/auth'),
    true,
  );
  assert.equal(navigation.isGrokNavigationUrl('https://x.ai/'), true);
  assert.equal(navigation.isGrokNavigationUrl('https://auth.x.ai/callback'), true);
  assert.equal(navigation.isGrokNavigationUrl('https://example.com/callback'), false);

  assert.equal(navigation.isOAuthPopupUrl('https://accounts.google.com/o/oauth2/v2/auth'), true);
  assert.equal(navigation.isOAuthPopupUrl('https://example.com/'), false);

  assert.equal(
    navigation.isSecureWebUrl('https://example.com/oauth/callback'),
    true,
    'an OAuth popup must be able to follow HTTPS redirects without opening the OS browser',
  );
  assert.equal(
    navigation.isSecureWebUrl('http://example.com/oauth/callback'),
    false,
    'OAuth redirect chains must remain HTTPS-only',
  );
  assert.equal(navigation.isSecureWebUrl('javascript:alert(1)'), false);

  assert.equal(
    navigation.canonicalGrokConversationUrl(
      'https://grok.com/c/cb299d7e-9036-4d0f-abd7-299a70165fbd?rid=fb6b2d18-3388-4826-8b76-700b4a130131',
    ),
    'https://grok.com/c/cb299d7e-9036-4d0f-abd7-299a70165fbd',
    'conversation restore state must not retain rid/query parameters',
  );
  assert.equal(navigation.canonicalGrokConversationUrl('https://grok.com/'), null);
  assert.equal(navigation.canonicalGrokConversationUrl('https://grok.com/share/example'), null);
  assert.equal(navigation.canonicalGrokConversationUrl('https://example.com/c/example'), null);

  assert.equal(
    queueModule.isNavigationAbortedError(Object.assign(new Error('ERR_ABORTED'), { code: -3 })),
    true,
  );
  assert.equal(
    queueModule.isNavigationAbortedError(new Error("(-3) loading 'https://grok.com/c/example'")),
    true,
  );
  assert.equal(
    queueModule.isNavigationAbortedError(
      Object.assign(new Error('ERR_NAME_NOT_RESOLVED'), { code: -105 }),
    ),
    false,
  );

  {
    const queue = new queueModule.GrokNavigationQueue();
    let current = 'https://grok.com/';
    let calls = 0;
    const gate = deferred();
    const contents = {
      getURL: () => current,
      loadURL: async (target) => {
        calls += 1;
        await gate.promise;
        current = target;
      },
    };
    const target = 'https://grok.com/c/38723657-88b2-4e2e-842b-ce0342d32fa3';
    const first = queue.navigate(contents, target);
    const duplicate = queue.navigate(contents, target);
    assert.strictEqual(
      duplicate,
      first,
      'duplicate navigation to the same conversation must share one pending request',
    );
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
      loadURL: async (target) => {
        calls.push(target);
        if (calls.length === 1) await firstGate.promise;
        current = target;
      },
    };
    const first = queue.navigate(contents, 'https://grok.com/c/story');
    const second = queue.navigate(contents, 'https://grok.com/c/models');
    await Promise.resolve();
    assert.deepEqual(
      calls,
      ['https://grok.com/c/story'],
      'different conversation loads must be serialized',
    );
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
      },
    };
    await queue.navigate(contents, target);
  }

  {
    const queue = new queueModule.GrokNavigationQueue();
    const contents = {
      getURL: () => 'https://grok.com/',
      loadURL: async () => {
        throw Object.assign(new Error('ERR_ABORTED'), { code: -3 });
      },
    };
    await assert.rejects(
      queue.navigate(contents, 'https://grok.com/c/not-arrived'),
      (error) => error?.code === -3,
      'ERR_ABORTED must remain visible when the requested destination was not reached',
    );
  }

  {
    const queue = new queueModule.LatestGrokContextQueue();
    let calls = 0;
    const gate = deferred();
    const first = queue.run('project\0story', async (isLatest) => {
      calls += 1;
      await gate.promise;
      return isLatest() ? 'story-current' : 'story-superseded';
    });
    const duplicate = queue.run('project\0story', async () => {
      calls += 1;
      return 'unexpected';
    });
    assert.strictEqual(
      duplicate,
      first,
      'duplicate set-context requests must share the pending operation',
    );
    gate.resolve();
    assert.equal(await first, 'story-current');
    assert.equal(calls, 1);
  }

  {
    const queue = new queueModule.LatestGrokContextQueue();
    const gate = deferred();
    const events = [];
    const story = queue.run('project\0story', async (isLatest) => {
      events.push('story-start');
      await gate.promise;
      events.push(isLatest() ? 'story-current' : 'story-superseded');
      return 'story';
    });
    await Promise.resolve();
    const models = queue.run('project\0models', async (isLatest) => {
      events.push(isLatest() ? 'models-current' : 'models-superseded');
      return 'models';
    });
    gate.resolve();
    await Promise.all([story, models]);
    assert.deepEqual(
      events,
      ['story-start', 'story-superseded', 'models-current'],
      'a rapid stage switch must mark the older context request stale before the newer request runs',
    );
  }

  console.log('Grok OAuth/navigation tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
