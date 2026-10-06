const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { inspectCore } = require('../scripts/check-core-boundaries.cjs');
const {
  MemoryProjects,
  MemoryAgent,
  MemoryExecution,
  MemoryConfirmations,
} = require('./core-support/memory-ports.cjs');
const repo = path.resolve(__dirname, '..');
const load = (file) => import(pathToFileURL(path.join(repo, 'dist-core', file)).href);
const modules = Promise.all([
  load('application/core.js'),
  load('domain/contracts.js'),
  load('domain/execution-policy.js'),
]);
const actor = {
  userId: 'u1',
  sessionId: 's1',
  requestId: 'r1',
  projectIds: ['p1'],
  permissions: ['read', 'edit', 'execute', 'admin'],
};
const run = {
  id: 'run-1',
  target: 'local',
  lifecycle: 'RUNNING',
  phase: 'EXECUTING',
  recovery: 'known',
  finalization: 'not-required',
};
const project = () => ({
  schema: 'web-project/1',
  id: 'p1',
  revision: 0,
  lease: { id: 'lease-1', userId: 'u1', sessionId: 's1', expiresAt: 60000 },
  artifacts: {},
  drafts: {},
  runs: [],
});
const mutation = { projectId: 'p1', expectedRevision: 0, leaseId: 'lease-1' };
const agentCommand = {
  projectId: 'p1',
  provider: 'codex',
  stage: 'story',
  kind: 'chat',
  text: 'Hello',
  sessionId: null,
};
async function fixture() {
  const [{ createBusinessCore }, { BusinessError }, policy] = await modules;
  const clock = {
    value: 100,
    now() {
      return this.value;
    },
  };
  let counter = 0;
  const projects = new MemoryProjects(project(), BusinessError);
  const agents = new MemoryAgent(BusinessError),
    execution = new MemoryExecution(run),
    confirmations = new MemoryConfirmations(BusinessError);
  const validator = {
    validate: async (key, content) => ({
      valid: content !== 'invalid',
      issues: content === 'invalid' ? [{ code: 'INVALID', message: 'Rejected' }] : [],
    }),
  };
  const secrets = {
    calls: 0,
    read: async () => {
      secrets.calls++;
      return 'credential';
    },
  };
  const resources = {
    calls: 0,
    read: async () => {
      resources.calls++;
      return new Uint8Array([1]);
    },
  };
  const images = {
    calls: 0,
    render: async () => {
      images.calls++;
      return new Uint8Array([2]);
    },
  };
  const core = createBusinessCore({
    projects,
    validator,
    clock,
    ids: { next: () => 'id-' + ++counter },
    agents,
    execution,
    confirmations,
    secrets,
    resources,
    images,
  });
  return {
    core,
    projects,
    agents,
    execution,
    confirmations,
    clock,
    validator,
    secrets,
    resources,
    images,
    policy,
    BusinessError,
  };
}
const rejects = (promise, code) => assert.rejects(promise, (error) => error.code === code);
test('core graph forbids runtime and type-only platform dependencies', () => {
  assert.deepEqual(inspectCore(), []);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'business-boundary-'));
  try {
    fs.mkdirSync(path.join(temporary, 'src/domain'), { recursive: true });
    fs.mkdirSync(path.join(temporary, 'src/application'));
    for (const source of [
      "import type { X } from '../../main/main.js';",
      "import type { X } from 'electron';",
      'const x = import("node:fs");',
      'const x = window.batchStudio;',
      "import type X = import('node:fs');",
      "export { x } from '../application/core.js';",
    ]) {
      fs.writeFileSync(path.join(temporary, 'src/domain/probe.ts'), source);
      assert.ok(inspectCore(temporary).length, source);
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
test('authorization rejects foreign projects and read-only actors before persistence', async () => {
  const { core, projects } = await fixture();
  await rejects(
    core.projects.saveDraft(
      { ...actor, permissions: ['read'] },
      { ...mutation, key: 'story', content: 'story' },
    ),
    'FORBIDDEN',
  );
  await rejects(core.projects.read(actor, { projectId: 'foreign' }), 'FORBIDDEN');
  assert.equal(projects.events.length, 0);
});
test('current schema and server revision are mandatory without migration', async () => {
  const { core, projects } = await fixture();
  projects.state.schema = 'desktop/1';
  await rejects(core.projects.read(actor, { projectId: 'p1' }), 'INVALID_INPUT');
  projects.state.schema = 'web-project/1';
  await rejects(
    core.projects.saveDraft(actor, {
      ...mutation,
      expectedRevision: undefined,
      key: 'story',
      content: 'story',
    }),
    'INVALID_INPUT',
  );
});
test('save is atomic with server revision and audit event; caller snapshots cannot mutate storage', async () => {
  const { core, projects } = await fixture();
  const result = await core.projects.saveDraft(actor, {
    ...mutation,
    key: 'story',
    content: 'story',
  });
  assert.equal(result.revision, 1);
  assert.equal(projects.events[0].requestId, 'r1');
  result.drafts.story.content = 'tampered';
  assert.equal(projects.state.drafts.story.content, 'story');
});
test('concurrent mutations with same revision yield one commit and one explicit conflict', async () => {
  const { core, projects } = await fixture();
  const outcomes = await Promise.allSettled([
    core.projects.saveDraft(actor, { ...mutation, key: 'story', content: 'first' }),
    core.projects.saveDraft(actor, { ...mutation, key: 'story', content: 'second' }),
  ]);
  assert.equal(outcomes.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find((x) => x.status === 'rejected').reason.code, 'REVISION_CONFLICT');
  assert.equal(projects.events.length, 1);
});
test('failed persistence rolls back state and outbox', async () => {
  const { core, projects } = await fixture();
  projects.failCommit = true;
  await assert.rejects(
    core.projects.saveDraft(actor, { ...mutation, key: 'story', content: 'story' }),
    /Persistence unavailable/,
  );
  assert.equal(projects.state.revision, 0);
  assert.deepEqual(projects.state.artifacts, {});
  assert.equal(projects.events.length, 0);
});
test('expired, foreign, missing and superseded leases reject edits', async () => {
  for (const change of [
    (p) => {
      p.lease.expiresAt = 50;
    },
    (p) => {
      p.lease.sessionId = 'other';
    },
    (p) => {
      p.lease = null;
    },
    (p) => {
      p.lease.id = 'new';
    },
  ]) {
    const { core, projects } = await fixture();
    change(projects.state);
    await rejects(
      core.projects.saveDraft(actor, { ...mutation, key: 'story', content: 'story' }),
      'LEASE_REQUIRED',
    );
  }
});
test('another browser can view but cannot acquire a live edit lease; expired lease can be replaced', async () => {
  const { core, clock } = await fixture();
  const other = { ...actor, sessionId: 's2' };
  await core.projects.read(other, { projectId: 'p1' });
  await rejects(core.projects.acquireLease(other, { projectId: 'p1' }), 'LEASE_REQUIRED');
  clock.value = 60001;
  const state = await core.projects.acquireLease(other, { projectId: 'p1' });
  assert.equal(state.lease.sessionId, 's2');
  assert.equal(state.revision, 1);
});
test('confirm revalidates content and invalidates downstream artifacts', async () => {
  const { core, projects, validator } = await fixture();
  await core.projects.saveDraft(actor, { ...mutation, key: 'story', content: 'story' });
  projects.state.artifacts.promptPlan = {
    key: 'promptPlan',
    content: 'plan',
    status: 'confirmed',
    validation: { valid: true, issues: [] },
  };
  validator.validate = async () => ({ valid: false, issues: [] });
  await rejects(
    core.projects.confirm(actor, { ...mutation, expectedRevision: 1, key: 'story' }),
    'INVALID_ARTIFACT',
  );
  validator.validate = async () => ({ valid: true, issues: [] });
  const state = await core.projects.confirm(actor, {
    ...mutation,
    expectedRevision: 1,
    key: 'story',
  });
  assert.equal(state.artifacts.story.status, 'confirmed');
  assert.equal(state.artifacts.promptPlan.status, 'stale');
});
test('missing or invalid drafts cannot be confirmed and reset makes dependants stale', async () => {
  const { core, projects } = await fixture();
  await rejects(core.projects.confirm(actor, { ...mutation, key: 'story' }), 'INVALID_ARTIFACT');
  await core.projects.saveDraft(actor, { ...mutation, key: 'story', content: 'invalid' });
  await rejects(
    core.projects.confirm(actor, { ...mutation, expectedRevision: 1, key: 'story' }),
    'INVALID_ARTIFACT',
  );
  projects.state.artifacts.models = {
    key: 'models',
    content: 'models',
    status: 'confirmed',
    validation: { valid: true, issues: [] },
  };
  const state = await core.projects.reset(actor, {
    ...mutation,
    expectedRevision: 1,
    key: 'story',
  });
  assert.equal(state.artifacts.story, undefined);
  assert.equal(state.artifacts.models.status, 'stale');
});
test('Run write guard covers running, uncertain and unfinalized remote owners', async () => {
  const { core, projects, policy } = await fixture();
  for (const state of [
    { ...run },
    { ...run, lifecycle: 'FAILED', recovery: 'uncertain' },
    { ...run, target: 'remote', lifecycle: 'PAUSED', finalization: 'pending' },
    { ...run, target: 'remote', lifecycle: 'FAILED', finalization: 'failed' },
  ]) {
    projects.state.runs = [state];
    assert.equal(policy.blocksProjectEdit(state), true);
    await rejects(
      core.projects.saveDraft(actor, { ...mutation, key: 'story', content: 'story' }),
      'PROJECT_BUSY',
    );
  }
  projects.state.runs = [
    { ...run, target: 'remote', lifecycle: 'PAUSED', finalization: 'stopped' },
  ];
  await core.projects.saveDraft(actor, { ...mutation, key: 'story', content: 'story' });
});
test('browser leave and Project switch never stop runtime', async () => {
  const { core, execution } = await fixture();
  assert.deepEqual(core.projects.leave(actor, { projectId: 'p1' }), { runtimeContinues: true });
  assert.deepEqual(execution.calls, []);
});
test('graceful stop and force interrupt retain their distinct semantics', async () => {
  for (const mode of ['graceful', 'interrupt']) {
    const { core, execution } = await fixture();
    await core.execution.stop(actor, { projectId: 'p1', runId: 'run-1', mode });
    assert.deepEqual(
      execution.calls,
      mode === 'graceful' ? ['schedule-stop', 'wait'] : ['schedule-stop', 'interrupt', 'wait'],
    );
  }
});
test('remote preparation is paused then finalized without sending new Prompts', async () => {
  const { core, execution } = await fixture();
  Object.assign(execution.run, {
    target: 'remote',
    phase: 'SSH_CONNECTING',
    finalization: 'pending',
  });
  await core.execution.stop(actor, { projectId: 'p1', runId: 'run-1', mode: 'interrupt' });
  assert.deepEqual(execution.calls, ['pause', 'wait', 'finalize']);
});
test('remote output processing and uncertain ownership never imply safe stop', async () => {
  for (const change of [{ phase: 'OUTPUT_RETRIEVING' }, { recovery: 'uncertain' }]) {
    const { core, execution } = await fixture();
    Object.assign(execution.run, { target: 'remote', finalization: 'pending', ...change });
    await rejects(
      core.execution.stop(actor, { projectId: 'p1', runId: 'run-1', mode: 'graceful' }),
      change.recovery ? 'RUNTIME_UNCERTAIN' : 'RUNTIME_BUSY',
    );
    assert.deepEqual(execution.calls, []);
  }
});
test('unconfirmed stop and failed remote billing finalization are explicit errors', async () => {
  const first = await fixture();
  first.execution.stalls = true;
  await rejects(
    first.core.execution.stop(actor, { projectId: 'p1', runId: 'run-1', mode: 'graceful' }),
    'RUNTIME_UNCERTAIN',
  );
  const second = await fixture();
  Object.assign(second.execution.run, { target: 'remote', finalization: 'pending' });
  second.execution.finalizationFails = true;
  await rejects(
    second.core.execution.stop(actor, { projectId: 'p1', runId: 'run-1', mode: 'graceful' }),
    'RUNTIME_UNCERTAIN',
  );
});
test('local uncertain Run uses reconciliation-specific stop path', async () => {
  const { core, execution } = await fixture();
  execution.run.recovery = 'uncertain';
  await core.execution.stop(actor, { projectId: 'p1', runId: 'run-1', mode: 'graceful' });
  assert.deepEqual(execution.calls, ['recover-local', 'wait']);
});
test('parallel Run stop commands serialize ownership and do not duplicate interrupt', async () => {
  const { core, execution } = await fixture();
  await Promise.all([
    core.execution.stop(actor, { projectId: 'p1', runId: 'run-1', mode: 'interrupt' }),
    core.execution.stop(actor, { projectId: 'p1', runId: 'run-1', mode: 'interrupt' }),
  ]);
  assert.equal(execution.calls.filter((x) => x === 'interrupt').length, 1);
});
test('AI reservations precede async availability; parallel chat/task cannot both launch', async () => {
  const { core, agents } = await fixture();
  let release;
  agents.availableGate = new Promise((resolve) => {
    release = resolve;
  });
  const first = core.agents.start(actor, agentCommand);
  await rejects(
    core.agents.start({ ...actor, requestId: 'r2' }, { ...agentCommand, kind: 'task' }),
    'RUNTIME_BUSY',
  );
  release();
  await first;
  assert.equal(agents.launches.length, 1);
});
test('idempotent pending and running AI requests do not relaunch; changed input rejects', async () => {
  const { core, agents } = await fixture();
  let release;
  agents.availableGate = new Promise((resolve) => {
    release = resolve;
  });
  const first = core.agents.start(actor, agentCommand);
  const pending = await core.agents.start(actor, agentCommand);
  assert.equal(pending.status, 'reserved');
  release();
  const running = await first;
  assert.equal((await core.agents.start(actor, agentCommand)).id, running.id);
  assert.equal(agents.launches.length, 1);
  await rejects(core.agents.start(actor, { ...agentCommand, text: 'different' }), 'INVALID_INPUT');
});
test('provider availability failure releases reservation; no provider fallback', async () => {
  const { core, agents } = await fixture();
  agents.isAvailable = false;
  await rejects(core.agents.start(actor, agentCommand), 'DEPENDENCY_UNAVAILABLE');
  assert.equal(agents.launches.length, 0);
  agents.isAvailable = true;
  await core.agents.start({ ...actor, requestId: 'r2' }, agentCommand);
});
test('resume is explicit and job cancellation verifies provider/stage ownership', async () => {
  const { core, agents } = await fixture();
  const job = await core.agents.start(actor, { ...agentCommand, sessionId: 'session-1' });
  assert.equal(agents.launches[0].input.sessionId, 'session-1');
  await rejects(
    core.agents.stop(actor, { ...agentCommand, provider: 'grok', jobId: job.id }),
    'FORBIDDEN',
  );
  assert.equal(
    (await core.agents.stop(actor, { ...agentCommand, jobId: job.id })).status,
    'cancelled',
  );
});
test('confirmation is actor-bound, expires, checks changed conditions and consumes once', async () => {
  const { core, confirmations, clock } = await fixture();
  const command = { projectId: 'p1', operation: 'rent-instance', targetId: 'offer-1' };
  const token = await core.confirmations.prepare(actor, command);
  const confirm = { ...command, confirmationId: token.id };
  await rejects(
    core.confirmations.confirm({ ...actor, sessionId: 'foreign' }, confirm),
    'FORBIDDEN',
  );
  confirmations.current.fingerprint = 'new-price';
  await rejects(core.confirmations.confirm(actor, confirm), 'TARGET_CHANGED');
  confirmations.current.fingerprint = 'price-1';
  clock.value = token.expiresAt;
  await rejects(core.confirmations.confirm(actor, confirm), 'CONFIRMATION_EXPIRED');
  clock.value = 101;
  await core.confirmations.confirm(actor, confirm);
  await rejects(core.confirmations.confirm(actor, confirm), 'CONFIRMATION_REQUIRED');
  assert.equal(confirmations.effects, 1);
});
test('client confirmed flag does not replace a server token', async () => {
  const { core } = await fixture();
  await rejects(
    core.confirmations.confirm(actor, {
      projectId: 'p1',
      operation: 'delete-instance',
      targetId: 'i1',
      confirmed: true,
      confirmationId: '',
    }),
    'INVALID_INPUT',
  );
});
test('image contracts reject oversized/crop-invalid input before resource loading', async () => {
  const { core, resources } = await fixture();
  const command = {
    projectId: 'p1',
    assetId: 'asset1',
    format: 'png',
    size: {
      sourceWidth: 100,
      sourceHeight: 100,
      cropWidth: 100,
      cropHeight: 100,
      outputWidth: 100,
      outputHeight: 100,
    },
  };
  assert.deepEqual(await core.platform.render(actor, command), new Uint8Array([2]));
  await rejects(
    core.platform.render(actor, { ...command, size: { ...command.size, outputWidth: 10000000 } }),
    'INVALID_INPUT',
  );
  await rejects(
    core.platform.render(actor, { ...command, size: { ...command.size, cropWidth: 101 } }),
    'INVALID_INPUT',
  );
  assert.equal(resources.calls, 1);
});
test('configured SecretStore and codec failures propagate without alternate routes', async () => {
  const { core, secrets, images, resources } = await fixture();
  secrets.read = async () => {
    throw new Error('store unavailable');
  };
  await assert.rejects(
    core.platform.withCredential('configured', async () => 'ok'),
    /store unavailable/,
  );
  secrets.read = async () => '';
  await rejects(
    core.platform.withCredential('configured', async () => 'ok'),
    'DEPENDENCY_UNAVAILABLE',
  );
  images.render = async () => {
    throw new Error('codec unavailable');
  };
  await assert.rejects(
    core.platform.render(actor, {
      projectId: 'p1',
      assetId: 'asset1',
      format: 'png',
      size: {
        sourceWidth: 100,
        sourceHeight: 100,
        cropWidth: 100,
        cropHeight: 100,
        outputWidth: 100,
        outputHeight: 100,
      },
    }),
    /codec unavailable/,
  );
  assert.equal(resources.calls, 1);
});

test('confirmation ignores forged condition fields supplied outside the command contract', async () => {
  const { core, confirmations } = await fixture();
  const command = {
    projectId: 'p1',
    operation: 'rent-instance',
    targetId: 'offer-1',
    fingerprint: 'forged',
    revision: 999,
  };
  const token = await core.confirmations.prepare(actor, command);
  assert.equal(token.fingerprint, 'price-1');
  assert.equal(token.revision, 1);
  confirmations.current.fingerprint = 'price-2';
  await rejects(
    core.confirmations.confirm(actor, {
      ...command,
      fingerprint: 'price-1',
      revision: 1,
      confirmationId: token.id,
    }),
    'TARGET_CHANGED',
  );
  assert.equal(confirmations.effects, 0);
});
test('malformed current state is rejected rather than treated as empty or safe', async () => {
  for (const change of [
    (p) => {
      delete p.runs;
    },
    (p) => {
      delete p.lease;
    },
    (p) => {
      p.runs = [{ ...run, lifecycle: 'UNKNOWN' }];
    },
    (p) => {
      p.artifacts.legacyPromptTree = { key: 'legacyPromptTree' };
    },
  ]) {
    const { core, projects } = await fixture();
    change(projects.state);
    await rejects(core.projects.read(actor, { projectId: 'p1' }), 'INVALID_INPUT');
  }
});

test('remote stop confirmation does not repeat already settled finalization', async () => {
  const { core, execution } = await fixture();
  Object.assign(execution.run, { target: 'remote', lifecycle: 'PAUSED', finalization: 'stopped' });
  await core.execution.stop(actor, { projectId: 'p1', runId: 'run-1', mode: 'graceful' });
  assert.equal(execution.calls.includes('finalize'), false);
});
test('run scope mismatch from infrastructure is rejected before controlling it', async () => {
  const { core, execution } = await fixture();
  execution.load = async () => ({ ...run, id: 'other-run' });
  await rejects(
    core.execution.stop(actor, { projectId: 'p1', runId: 'run-1', mode: 'graceful' }),
    'FORBIDDEN',
  );
  assert.deepEqual(execution.calls, []);
});

test('unknown AI launch retains reservation and idempotent retry cannot launch again', async () => {
  const { core, agents } = await fixture();
  agents.launch = async () => {
    agents.launches.push({ accepted: true });
    throw new Error('lost response');
  };
  await rejects(core.agents.start(actor, agentCommand), 'RUNTIME_UNCERTAIN');
  assert.equal((await core.agents.start(actor, agentCommand)).status, 'unknown');
  await rejects(core.agents.start({ ...actor, requestId: 'r2' }, agentCommand), 'RUNTIME_BUSY');
  assert.equal(agents.launches.length, 1);
});

test('saving an invalid draft preserves the confirmed artifact until explicit valid confirmation', async () => {
  const { core, projects } = await fixture();
  projects.state.artifacts.story = {
    key: 'story',
    content: 'confirmed story',
    status: 'confirmed',
    validation: { valid: true, issues: [] },
  };
  const state = await core.projects.saveDraft(actor, {
    ...mutation,
    key: 'story',
    content: 'invalid',
  });
  assert.equal(state.artifacts.story.content, 'confirmed story');
  assert.equal(state.artifacts.story.status, 'confirmed');
  assert.equal(state.drafts.story.validation.valid, false);
  await rejects(
    core.projects.confirm(actor, { ...mutation, expectedRevision: 1, key: 'story' }),
    'INVALID_ARTIFACT',
  );
  assert.equal(projects.state.artifacts.story.content, 'confirmed story');
});

test('begin edit copies confirmed state once without overwriting an existing draft', async () => {
  const { core, projects } = await fixture();
  projects.state.artifacts.story = {
    key: 'story',
    content: 'confirmed',
    status: 'confirmed',
    validation: { valid: true, issues: [] },
  };
  const state = await core.projects.beginEdit(actor, { ...mutation, key: 'story' });
  assert.equal(state.drafts.story.content, 'confirmed');
  assert.equal(state.artifacts.story.status, 'confirmed');
  await rejects(
    core.projects.beginEdit(actor, { ...mutation, expectedRevision: 1, key: 'story' }),
    'REVISION_CONFLICT',
  );
});

test('Run ownership is checked again after waiting before remote finalization', async () => {
  const { core, execution } = await fixture();
  let reads = 0;
  execution.load = async () => ({
    ...run,
    target: 'remote',
    finalization: 'pending',
    lifecycle: reads++ ? 'PAUSED' : 'RUNNING',
    id: reads > 1 ? 'foreign' : 'run-1',
  });
  await rejects(
    core.execution.stop(actor, { projectId: 'p1', runId: 'run-1', mode: 'graceful' }),
    'FORBIDDEN',
  );
  assert.equal(execution.calls.includes('finalize'), false);
});
