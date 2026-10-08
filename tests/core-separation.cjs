const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const load = (name) => import(pathToFileURL(path.resolve(__dirname, '../dist-core', name)).href);

test('the shared assistant command gate prevents chat/task races and session changes during a task', async () => {
  const { AssistantCommands } = await load('application/assistant-commands.js');
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let active = false,
    chats = 0,
    changes = 0;
  const task = {
    isBusy: () => active,
    run: async () => {
      await gate;
      active = true;
      return { turnId: 'task' };
    },
    stop: async () => {
      active = false;
    },
  };
  const commands = new AssistantCommands({
    rootKey: (root) => root,
    conversation: {
      isBusy: () => false,
      send: async () => {
        chats++;
      },
      stop: async () => {},
    },
    tasks: { codex: task, grok: task },
    sessions: {
      clearActive: async () => {
        changes++;
      },
      activate: async () => {
        changes++;
      },
    },
  });
  const context = { root: 'p', stage: 'story', provider: 'codex' };
  const starting = commands.startTask('p', 'codex', 'story-initial', '');
  const chat = commands.send(context, 'message');
  const clearing = commands.newConversation(context);
  release();
  await starting;
  await assert.rejects(() => chat);
  await assert.rejects(() => clearing);
  assert.equal(chats, 0);
  assert.equal(changes, 0);
  await commands.stopTask('p', 'codex', 'story-initial');
  await commands.newConversation(context);
  assert.equal(changes, 1);
});

test('actual chat and CLI task entry points reserve before the first await and release failed starts', async () => {
  for (const [file, factory, provider, chat] of [
    ['agent-conversation-runner', 'createAgentConversationRunner', 'codex', true],
    ['codex-cli-task-runner', 'createCodexCliTaskRunner', 'codex', false],
    ['grok-cli-task-runner', 'createGrokCliTaskRunner', 'grok', false],
  ]) {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    let probes = 0;
    const adapter = {
      provider,
      checkAvailability: async () => {
        probes++;
        await gate;
        return { state: 'missing' };
      },
    };
    const ports = {
      path,
      caseInsensitivePaths: false,
      now: Date.now,
      isCancelled: () => false,
    };
    const module = await load(`application/${file}.js`);
    const Runner = module[factory](ports);
    const runner = new Runner({
      adapter: chat ? () => adapter : adapter,
      sessions: {},
      conversations: {},
      model: async () => undefined,
      userDataPath: 'workspace',
      onEvent: () => {},
      onArtifact: () => {},
    });
    const start = () =>
      chat
        ? runner.send('p', 'story', provider, 'message')
        : runner.run('p', 'story', 'story-initial');
    const first = start();
    assert.equal(chat ? runner.isBusy('p', 'story', provider) : runner.isBusy('p', 'story'), true);
    await assert.rejects(start);
    assert.equal(probes, 1);
    release();
    await assert.rejects(() => first);
    assert.equal(chat ? runner.isBusy('p', 'story', provider) : runner.isBusy('p', 'story'), false);
    await assert.rejects(start);
    assert.equal(probes, 2);
  }
});

test('public execution start persists launch failure; only known non-acceptance permits a new Run', async () => {
  const { MemoryExecution } = require('./core-support/memory-ports.cjs');
  const { ExecutionUseCases } = await load('application/execution-use-cases.js');
  const { ExecutionLaunchFailure } = await load('domain/execution-launch-policy.js');
  const actor = {
    userId: 'u',
    sessionId: 's',
    requestId: 'r',
    projectIds: ['p'],
    permissions: ['execute'],
  };
  for (const known of [true, false]) {
    const memory = new MemoryExecution({
      id: 'old',
      target: 'local',
      lifecycle: 'COMPLETED',
      phase: 'EXECUTING',
      recovery: 'known',
      finalization: 'not-required',
    });
    const original = memory.creation.bind(memory);
    let counter = 0;
    memory.creation = async (...args) => {
      const ports = await original(...args);
      return {
        ...ports,
        current: async () => memory.rawRun ?? null,
        nextId: () => `run-${++counter}`,
      };
    };
    memory.launch = async () => {
      throw known ? new ExecutionLaunchFailure('busy', 'not-started') : new Error('response lost');
    };
    const app = new ExecutionUseCases(memory);
    await assert.rejects(() => app.start(actor, { projectId: 'p' }));
    assert.equal(memory.rawRun.lifecycle, 'FAILED');
    assert.equal(memory.rawRun.controls.scheduling, 'STOPPED');
    assert.equal(memory.rawRun.error.retryable, known);
    memory.launch = async () => {};
    if (known) assert.equal((await app.start(actor, { projectId: 'p' })).id, 'run-2');
    else {
      await assert.rejects(() => app.start(actor, { projectId: 'p' }));
      assert.equal(counter, 1);
    }
  }
});

test('RENT cancellation and changed quote never create an instance', async () => {
  const { VastOfferUseCases } = await load('application/vast-offer-use-cases.js');
  let created = 0,
    price = 1;
  const template = { hashId: 'template', recommendedDiskSpaceGb: 10 };
  const service = new VastOfferUseCases({
    templates: async () => [template],
    offers: async () => [{ id: 8, hourlyCost: price }],
    rent: async () => {
      created++;
      return 11;
    },
    rememberCreated: () => {},
  });
  const input = { offerId: 8, storageGb: 10, templateHashId: 'template' };
  assert.equal(await service.confirmAndRent(input, async () => false), null);
  await assert.rejects(
    () =>
      service.confirmAndRent(input, async () => {
        price++;
        return true;
      }),
    /changed/,
  );
  await assert.rejects(() => service.confirmAndRent({ ...input, storageGb: 9 }, async () => true));
  assert.equal(created, 0);
  assert.equal(await service.confirmAndRent(input, async () => true), 11);
  assert.equal(created, 1);
});

test('Remote preparation rejects foreign endpoint and closes stopped or unhealthy sessions', async () => {
  const { connectRemoteControlPlane } = await load('application/remote-control-preparation.js');
  for (const condition of ['foreign', 'paused', 'unhealthy', 'ready']) {
    let closed = 0,
      installed = 0,
      connected = 0;
    const run = {
      runId: 'r',
      executionTarget: 'remote',
      lifecycle: 'RUNNING',
      remote: { provider: 'vastai', instanceId: 3 },
    };
    const endpoint = {
      provider: 'vastai',
      instanceId: condition === 'foreign' ? 4 : 3,
      host: 'host',
      port: 22,
      user: 'u',
      privateKeyPath: 'key',
      comfyUiDirectory: 'dir',
      comfyUiPort: 8188,
    };
    const ports = {
      load: async () => run,
      mutate: async (_p, _id, work) => {
        work(run);
        return run;
      },
      resolveEndpoint: async () => endpoint,
      connect: async () => {
        connected++;
        if (condition === 'paused') run.lifecycle = 'PAUSED';
        return { close: () => closed++ };
      },
      deploy: async () => ({}),
      request: async () => ({ response: { ok: condition !== 'unhealthy' } }),
      install: () => installed++,
    };
    if (condition === 'ready') {
      await connectRemoteControlPlane(ports, 'p', 'r');
      assert.equal(installed, 1);
      assert.equal(closed, 0);
    } else {
      await assert.rejects(() => connectRemoteControlPlane(ports, 'p', 'r'));
      assert.equal(installed, 0);
      assert.equal(closed, condition === 'foreign' ? 0 : 1);
    }
    if (condition === 'foreign') assert.equal(connected, 0);
  }
});

test('editor stale saves cannot overwrite newer revisions; equal revision is a conflict', async () => {
  const { editorSaveDecision } = await load('domain/editor-save-policy.js');
  const current = { saveRevision: 4, text: 'new' };
  assert.equal(
    editorSaveDecision(current, { saveRevision: 3, text: 'old' }, () => 5),
    current,
  );
  assert.throws(
    () => editorSaveDecision(current, { saveRevision: 4, text: 'different' }, () => 5),
    /CONFLICT/,
  );
  assert.deepEqual(
    editorSaveDecision(current, { text: 'next' }, () => 5),
    { saveRevision: 5, text: 'next' },
  );
});

test('legacy upload without source fingerprint is rejected before multipart sends', async () => {
  const { R2TransferRuntime } = await load('application/r2-transfer-runtime.js');
  let sends = 0;
  const job = {
    id: 'j',
    kind: 'upload',
    filePath: 'source',
    status: 'paused',
    size: 20,
    partSize: 5,
    completedParts: {},
    transferredBytes: 0,
    uploadId: 'u',
  };
  const runtime = new R2TransferRuntime({
    jobs: async () => [job],
    save: async () => {},
    exists: async () => true,
    stat: async () => ({ size: 20 }),
    request: async () => {
      sends++;
      return {};
    },
    now: () => 'now',
    nextId: () => 'id',
  });
  await assert.rejects(() => runtime.resumeUpload('j'), /R2_UPLOAD_SOURCE_CHANGED/);
  assert.equal(sends, 0);
});

test('provider capabilities reject stale models and undeclared reasoning strength', async () => {
  const { selectAvailableAgentModel } = await load('domain/agent-model-policy.js');
  const facts = { models: [{ id: 'current' }], defaultModelId: 'current' };
  assert.throws(() =>
    selectAvailableAgentModel({ model: 'removed', reasoningEffort: null }, facts),
  );
  assert.throws(() =>
    selectAvailableAgentModel({ model: 'current', reasoningEffort: 'high' }, facts),
  );
  assert.equal(
    selectAvailableAgentModel({ model: null, reasoningEffort: null }, facts).model,
    null,
  );
  const { chooseObservedAgentModel } = await load('application/observed-agent-model-selection.js');
  const writes = [];
  const ports = { capabilities: async () => facts, save: async (value) => writes.push(value) };
  await assert.rejects(() =>
    chooseObservedAgentModel(ports, { model: 'removed', reasoningEffort: null }),
  );
  await assert.rejects(() =>
    chooseObservedAgentModel(ports, { model: 'current', reasoningEffort: 'high' }),
  );
  assert.equal(writes.length, 0);
  await chooseObservedAgentModel(ports, { model: 'current', reasoningEffort: null });
  assert.deepEqual(writes, [{ model: 'current', reasoningEffort: null }]);
});

test('launch failure persists a stopped Run and distinguishes uncertain acceptance', async () => {
  const { launchExecution } = await load('application/execution-launch.js');
  const { ExecutionLaunchFailure } = await load('domain/execution-launch-policy.js');
  for (const [error, code, retryable] of [
    [new ExecutionLaunchFailure('busy', 'not-started'), 'EXECUTION_RESOURCE_BUSY', true],
    [
      new Error('lost response https://private.invalid/token'),
      'EXECUTION_RECOVERY_UNCERTAIN',
      false,
    ],
  ]) {
    const run = {
      runId: 'r',
      lifecycle: 'RUNNING',
      phase: 'EXECUTING',
      controls: { scheduling: 'ACTIVE' },
      errorHistory: [],
    };
    await assert.rejects(
      () =>
        launchExecution(
          {
            submit: async () => {
              throw error;
            },
            mutate: async (_p, _id, work) => {
              work(run);
              return run;
            },
            now: () => 'now',
            safeError: (e) => e.message,
          },
          'p',
          run,
        ),
      error,
    );
    assert.equal(run.lifecycle, 'FAILED');
    assert.equal(run.controls.scheduling, 'STOPPED');
    assert.equal(run.error.code, code);
    assert.equal(run.error.retryable, retryable);
    assert.equal(run.errorHistory.length, 1);
    assert.ok(!run.error.message.includes('private.invalid'));
  }
});

test('submission rejects a missing remote identity before external effects', async () => {
  const { submitExecution } = await load('application/execution-launch.js');
  const calls = [];
  const ports = {
    local: async () => calls.push('local'),
    remote: async (_p, _r, provider, id) => calls.push([provider, id]),
  };
  await assert.rejects(() =>
    submitExecution(ports, 'p', {
      executionTarget: 'remote',
      remote: { provider: 'vastai', instanceId: 0 },
    }),
  );
  assert.deepEqual(calls, []);
  await submitExecution(ports, 'p', { executionTarget: 'local' });
  await submitExecution(ports, 'p', {
    executionTarget: 'remote',
    remote: { provider: 'vastai', instanceId: 7 },
  });
  assert.deepEqual(calls, ['local', ['vastai', 7]]);
});

test('Run commands bind storage observations to the requested logical project identity', async () => {
  const { ExecutionCommands } = await load('application/execution-commands.js');
  let effects = 0;
  const commands = new ExecutionCommands({
    runProjectIdentity: async () => 'logical-project',
    getExecutionRun: async () => ({
      projectId: 'other',
      runId: 'r',
      error: { code: 'EXECUTION_RECOVERY_UNCERTAIN' },
    }),
    mutateExecutionRun: async () => {
      effects++;
    },
    reconcilePersistedExecutionRuns: async () => {},
  });
  await assert.rejects(
    () => commands.recheck('opaque-storage-reference', 'r'),
    (e) => e.code === 'FORBIDDEN',
  );
  assert.equal(effects, 0);
});

test('thumbnail removal commits revision and selection before optional cleanup', async () => {
  const { deleteThumbnailDocument } = await load('application/thumbnail-document-use-cases.js');
  let state = {
    schemaVersion: 1,
    activeDocumentId: 2,
    nextDocumentId: 4,
    saveRevision: 5,
    documents: [1, 2, 3].map((id) => ({ id, slots: {} })),
  };
  const calls = [];
  const ports = {
    exclusive: async (_p, work) => work(),
    load: async () => structuredClone(state),
    write: async (_p, next) => {
      calls.push('commit');
      state = next;
    },
    deleteOutputs: async () => {
      calls.push('cleanup');
      throw new Error('offline');
    },
  };
  await assert.rejects(
    () => deleteThumbnailDocument(ports, 'p', { id: 2, expectedRevision: 4, deleteOutputs: true }),
    (e) => e.code === 'REVISION_CONFLICT',
  );
  assert.deepEqual(calls, []);
  const result = await deleteThumbnailDocument(ports, 'p', {
    id: 2,
    expectedRevision: 5,
    deleteOutputs: true,
  });
  assert.deepEqual(calls, ['commit', 'cleanup']);
  assert.equal(state.activeDocumentId, 3);
  assert.equal(state.saveRevision, 6);
  assert.equal(result.cleanupWarning, 'offline');
  state.documents = [state.documents[0]];
  await assert.rejects(() =>
    deleteThumbnailDocument(ports, 'p', { id: 1, expectedRevision: 6, deleteOutputs: false }),
  );
});

test('thumbnail source rejects removed documents and obsolete tracked extensions', async () => {
  const { assertEligibleThumbnailSource } = await load('domain/thumbnail-source-policy.js');
  const facts = { documentIds: [2], outputs: { 2: { fileName: 'thumbnail-02.png' } } };
  assert.throws(() => assertEligibleThumbnailSource('thumbnail-01.png', facts));
  assert.throws(() => assertEligibleThumbnailSource('thumbnail-02.jpg', facts));
  assert.doesNotThrow(() => assertEligibleThumbnailSource('thumbnail-02.png', facts));
});

test('configuration verification and encryption failures cannot commit credentials', async () => {
  const { R2ConnectionUseCases } = await load('application/r2-connection-use-cases.js');
  const account = 'a'.repeat(32);
  let stored = {
    schemaVersion: 1,
    accountId: account,
    accessKeyId: 'key',
    encryptedSecret: 'enc:saved',
    encryptedMetricsToken: 'enc:metrics',
  };
  let reads = 0,
    writes = 0,
    failEncryption = false;
  const useCases = new R2ConnectionUseCases({
    exclusive: (work) => work(),
    read: async () => {
      reads++;
      return structuredClone(stored);
    },
    write: async (next) => {
      writes++;
      stored = next;
    },
    decrypt: (value) => value?.slice(4) ?? '',
    encrypt: (value) => {
      if (failEncryption) throw new Error('crypto');
      return 'enc:' + value;
    },
  });
  await assert.rejects(() =>
    useCases.save({ accountId: account, accessKeyId: 'key' }, async (value) => {
      assert.equal(value.secretAccessKey, 'saved');
      throw new Error('provider');
    }),
  );
  assert.equal(writes, 0);
  assert.equal(reads, 1);
  await assert.rejects(() =>
    useCases.save({ accountId: 'b'.repeat(32), accessKeyId: 'key' }, async () => {}),
  );
  assert.equal(writes, 0);
  failEncryption = true;
  await assert.rejects(() =>
    useCases.save(
      { accountId: account, accessKeyId: 'new', secretAccessKey: 'new-secret' },
      async () => {},
    ),
  );
  assert.equal(writes, 0);
  failEncryption = false;
  await useCases.save(
    { accountId: 'b'.repeat(32), accessKeyId: 'new', secretAccessKey: 'new-secret' },
    async (value) => assert.equal(value.cloudflareApiToken, ''),
  );
  assert.equal(writes, 1);
  assert.equal(stored.encryptedMetricsToken, undefined);
});

test('explicit recovery refuses healthy and missing stores and preserves failed restoration', async () => {
  const { recoverCurrentFormat } = await load('application/current-format-recovery.js');
  let state = 'healthy',
    effects = 0;
  const ports = {
    exclusive: (work) => work(),
    load: async () => {
      if (state !== 'healthy') throw new Error(state);
      return { valid: true };
    },
    corruption: (e) => (e.message === 'corrupt' ? 'corrupt' : 'missing'),
    restore: async () => {
      effects++;
      state = 'healthy';
    },
    initialize: async () => {
      effects++;
      state = 'healthy';
    },
  };
  await assert.rejects(() => recoverCurrentFormat(ports, 'restore'));
  state = 'missing';
  await assert.rejects(() => recoverCurrentFormat(ports, 'initialize'));
  assert.equal(effects, 0);
  state = 'corrupt';
  assert.deepEqual(await recoverCurrentFormat(ports, 'restore'), { valid: true });
  assert.equal(effects, 1);
});

test('template updates preserve creation identity and reject cross-bucket changes', async () => {
  const { saveR2Template } = await load('domain/saved-template-policy.js');
  const existing = [
    {
      id: 't',
      bucket: 'b',
      name: 'First',
      createdAt: 'old',
      updatedAt: 'old',
      objects: [{ key: 'one', name: 'one' }],
    },
  ];
  assert.throws(() =>
    saveR2Template(
      existing,
      { name: 'FIRST', bucket: 'b', objects: existing[0].objects },
      'now',
      () => 'next',
    ),
  );
  assert.throws(() =>
    saveR2Template(
      existing,
      { id: 't', name: 'Next', bucket: 'other', objects: existing[0].objects },
      'now',
      () => 'next',
    ),
  );
  const [next] = saveR2Template(
    existing,
    { id: 't', name: 'Next', bucket: 'b', objects: existing[0].objects },
    'now',
    () => 'next',
  );
  assert.equal(next.createdAt, 'old');
  assert.equal(next.updatedAt, 'now');
});

test('R2 move never deletes source after a failed copy', async () => {
  const { R2TransferRuntime } = await load('application/r2-transfer-runtime.js');
  for (const failCopy of [false, true]) {
    const operations = [],
      jobs = [];
    let finish;
    const done = new Promise((resolve) => {
      finish = resolve;
    });
    const runtime = new R2TransferRuntime({
      request: async (op, input) => {
        operations.push(op);
        if (op === 'HeadObject') {
          if (input.Key === 'dest') throw Object.assign(new Error('missing'), { name: 'NotFound' });
          return { ContentLength: 1 };
        }
        if (op === 'CopyObject' && failCopy) throw new Error('copy failed');
        return {};
      },
      save: async (job) => {
        jobs.push(structuredClone(job));
        if (['complete', 'failed'].includes(job.status)) finish();
      },
      now: () => 'now',
      nextId: () => 'job',
      syncIndex: () => {},
    });
    await runtime.move('bucket', 'source', 'dest');
    await done;
    assert.equal(operations.includes('DeleteObject'), !failCopy);
    assert.equal(jobs.at(-1).status, failCopy ? 'failed' : 'complete');
    if (!failCopy) assert.ok(operations.indexOf('DeleteObject') > operations.indexOf('CopyObject'));
  }
});
