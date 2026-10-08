import assert from 'node:assert/strict';
import test from 'node:test';
import { containerArguments } from '../dist-server/server/agent-cli-runtime.js';
import { CodexCliEventParser } from '../dist-server/server/codex-cli-events.js';
import { GrokCliEventParser } from '../dist-server/server/grok-cli-events.js';
import path from 'node:path';
test('container boundary uses fixed image and only dedicated mounts', () => {
  const c = { docker: path.resolve('docker'), image: 'sha256:' + 'a'.repeat(64), provider: 'grok' };
  const args = containerArguments(
    c,
    'batch-agent-abcd',
    path.resolve('runtime/home'),
    path.resolve('runtime/job'),
  );
  assert.ok(args.includes('--read-only'));
  assert.ok(args.includes('--cap-drop=ALL'));
  assert.ok(args.includes('--user=1000:1000'));
  assert.equal(args.filter((v) => v === '--mount').length, 2);
  assert.ok(!args.some((v) => v.includes('docker.sock')));
  assert.throws(() =>
    containerArguments(
      { ...c, image: 'latest' },
      'batch-agent-abcd',
      path.resolve('a'),
      path.resolve('b'),
    ),
  );
  assert.throws(() => containerArguments(c, 'bad;name', path.resolve('a'), path.resolve('b')));
  assert.throws(() => containerArguments(c, 'batch-agent-abcd', 'relative', path.resolve('b')));
});
test('CLI session mismatch rejected and thought content not published', () => {
  const p = new GrokCliEventParser();
  const id = '33a63c10-fb8a-4a73-80e0-a09a34c44999';
  assert.ok(
    !JSON.stringify(
      p.parseLine(JSON.stringify({ type: 'thought', data: 'PRIVATE_REASONING' }), 'turn', id),
    ).includes('PRIVATE_REASONING'),
  );
  assert.throws(() =>
    p.parseLine(
      JSON.stringify({ type: 'end', sessionId: 'other', stopReason: 'end_turn' }),
      'turn',
      id,
    ),
  );
  assert.throws(() => new CodexCliEventParser().parseLine('garbage', 'turn'));
});
