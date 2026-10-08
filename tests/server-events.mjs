import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import WebSocket from 'ws';
import { EventBroker, attachEvents } from '../dist-server/server/events.js';
import { fixture, writeAuth } from './server-fixtures.mjs';

const actor = {
  userId: 'operator',
  sessionId: 'session',
  requestId: 'request',
  projectIds: ['A', 'B'],
  permissions: ['read'],
};
const job = (revision, projectId = 'A') => ({
  id: 'job',
  projectId,
  kind: 'probe',
  state: 'running',
  stage: 'story',
  provider: 'codex',
  sessionId: 'public-session',
  turnId: 'turn',
  progress: 0.5,
  revision,
});

test('snapshot/subscription boundary and bounded persistent replay are atomic and scoped', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'batch-events-'));
  const broker = new EventBroker(dir, () => [job(0)], 3);
  try {
    await broker.initialize();
    const received = [];
    const off = await broker.subscribe(actor, ['A'], undefined, (packet) => {
      received.push(packet);
      return true;
    });
    await Promise.all([broker.append(job(1)), broker.append(job(2, 'B')), broker.append(job(3))]);
    assert.deepEqual(
      received.map((p) => p.sequence),
      [0, 1, 3],
    );
    assert.equal(received[0].type, 'snapshot');
    off();
    const replay = [];
    const offReplay = await broker.subscribe(actor, ['A'], 1, (packet) => {
      replay.push(packet);
      return true;
    });
    assert.deepEqual(
      replay.map((p) => p.sequence),
      [3, 3],
    );
    assert.equal(replay.at(-1).type, 'replay.complete');
    offReplay();
    await broker.append(job(4));
    await assert.rejects(
      broker.subscribe(actor, ['A'], 0, () => true),
      /REPLAY_UNAVAILABLE/,
    );
    await assert.rejects(
      broker.subscribe({ ...actor, projectIds: [] }, ['A'], undefined, () => true),
    );
    await assert.rejects(broker.append({ ...job(5), rawReasoning: 'secret' }));
    let sent = 0;
    const slow = await broker.subscribe(actor, ['A'], undefined, () => {
      sent++;
      return sent === 1;
    });
    await broker.append(job(5));
    await broker.append(job(6));
    assert.equal(sent, 2);
    slow();
    const reopened = new EventBroker(dir, () => [job(6)], 3);
    await reopened.initialize();
    const restored = [];
    const offRestored = await reopened.subscribe(actor, ['A'], 5, (p) => {
      restored.push(p);
      return true;
    });
    assert.equal(restored[0].sequence, 6);
    offRestored();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('real WebSocket validates handshake, scope, replay and permission changes', {
  timeout: 10_000,
}, async () => {
  const f = await fixture();
  const broker = new EventBroker(f.dir, () => [job(0)]);
  await broker.initialize();
  const events = attachEvents(f.runtime.server, f.config, f.security, broker);
  const protocol = 'batch.v1.' + f.config.buildId;
  const url = f.runtime.origin.replace('http:', 'ws:') + '/api/v1/events?projectId=A';
  const options = { origin: f.runtime.origin, headers: { cookie: f.headers.cookie } };
  const sockets = [];
  function connect(target = url, extra = {}, selected = protocol) {
    const ws = new WebSocket(target, selected, { ...options, ...extra });
    sockets.push(ws);
    return ws;
  }
  async function rejected(target = url, extra = {}, selected = protocol) {
    const ws = connect(target, extra, selected);
    ws.on('error', () => {});
    const result = await new Promise((resolve) =>
      ws.once('unexpected-response', (_req, res) => {
        res.resume();
        ws.terminate();
        resolve(res.statusCode);
      }),
    );
    return result;
  }
  try {
    assert.equal(await rejected(url, { origin: 'http://evil.invalid' }), 403);
    assert.equal(await rejected(url, { headers: {} }), 401);
    assert.equal(await rejected(url.replace('projectId=A', 'projectId=C')), 403);
    assert.equal(await rejected(url, {}, 'batch.v1.old'), 403);
    const ws = connect();
    const snapshot = once(ws, 'message');
    await once(ws, 'open');
    assert.equal(JSON.parse((await snapshot)[0]).type, 'snapshot');
    const update = once(ws, 'message');
    await broker.append(job(1));
    assert.equal(JSON.parse((await update)[0]).sequence, 1);
    ws.close();
    await once(ws, 'close');
    const replaySocket = connect(url + '&after=0');
    const replayMessages = [];
    replaySocket.on('message', (data) => replayMessages.push(JSON.parse(data)));
    await once(replaySocket, 'open');
    const deadline = Date.now() + 3000;
    while (replayMessages.length < 2) {
      if (Date.now() > deadline) throw new Error('Replay wait timed out');
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.deepEqual(
      replayMessages.map((p) => p.type),
      ['job.changed', 'replay.complete'],
    );
    const revoked = once(replaySocket, 'close');
    await writeAuth(f.dir, ['B']);
    await broker.append(job(2));
    assert.equal((await revoked)[0], 1008);
    assert.equal(replayMessages.length, 2);
  } finally {
    sockets.forEach((ws) => ws.terminate());
    await events.close();
    await f.close();
  }
});
