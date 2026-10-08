import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentStore } from '../dist-server/server/agent-store.js';
const actor = {
  userId: 'operator',
  sessionId: 'browser',
  requestId: 'req',
  projectIds: ['project'],
  permissions: ['read', 'edit', 'execute'],
};
const scope = { projectId: 'project', stage: 'story', provider: 'codex' };
test('agent history is durable, scoped, idempotent and fenced', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'web-agent-store-'));
  try {
    const s = new AgentStore(dir);
    await s.initialize();
    const c = await s.select(actor, scope, 'new', null);
    assert.deepEqual(await s.select(actor, scope, 'new', null), c);
    await s.begin(actor, scope, 'job', c.conversationId, 'hello', null, null);
    await s.update(actor, scope, 'job', {
      type: 'session.started',
      at: 1,
      sessionId: 'cli-session',
    });
    await s.update(actor, scope, 'job', { type: 'message.delta', at: 2, text: 'answer' });
    await s.finish(actor, scope, 'job', 'completed');
    await assert.rejects(
      s.update(actor, scope, 'job', { type: 'message.delta', at: 3, text: 'late' }),
    );
    const restored = new AgentStore(dir);
    await restored.initialize();
    assert.equal(restored.resolve(actor, scope, c.conversationId), 'cli-session');
    assert.equal(restored.history(actor, scope).messages[1].text, 'answer');
    assert.throws(() => restored.history({ ...actor, userId: 'other' }, scope, c.conversationId));
    assert.throws(() => restored.resolve(actor, { ...scope, provider: 'grok' }, c.conversationId));
    assert.throws(() => restored.history({ ...actor, projectIds: [] }, scope));
    await assert.rejects(restored.select(actor, scope, 'new', c.conversationId));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('unknown stores and oversized conversation updates rejected without overwrite', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'web-agent-store-'));
  try {
    await writeFile(path.join(dir, 'agents.json'), JSON.stringify({ schema: 'old' }));
    await assert.rejects(new AgentStore(dir).initialize());
    await rm(path.join(dir, 'agents.json'));
    const s = new AgentStore(dir);
    await s.initialize();
    await s.begin(actor, scope, 'job', null, 'hello', null, null);
    await assert.rejects(
      s.update(actor, scope, 'job', {
        type: 'message.completed',
        at: 1,
        text: 'x'.repeat(1024 * 1024),
      }),
    );
    assert.equal(s.history(actor, scope).messages[1].text, '');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
