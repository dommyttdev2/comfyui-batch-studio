import assert from 'node:assert/strict';
import { test } from 'node:test';
import { request } from 'node:http';
import { fixture, token, writeAuth } from './server-fixtures.mjs';

test('session authentication, scope, CSRF, expiry and revocation protect loopback', async () => {
  let clock = 100;
  let calls = 0;
  const f = await fixture({ commands: new Map([['probe', { permission: 'edit', validate: () => {}, execute: async () => { calls++; return { accepted: true }; } }]]) }, () => clock);
  const post = (extra = {}, project = 'A') => fetch(f.runtime.origin + `/api/v1/projects/${project}/commands/probe`, { method: 'POST', headers: { ...f.headers, ...extra }, body: '{}' });
  try {
    assert.equal((await post()).status, 200);
    assert.equal((await post({ cookie: '' })).status, 401);
    assert.equal((await post({ 'x-csrf-token': '' })).status, 403);
    assert.equal((await post({ origin: 'http://evil.invalid' })).status, 403);
    assert.equal(await new Promise((resolve, reject) => { const req = request(f.runtime.origin + '/api/v1/health', { headers: { host: 'evil.invalid' } }, (res) => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end(); }), 403);
    assert.equal((await post({}, 'C')).status, 403);
    assert.equal(calls, 1);
    const health = await fetch(f.runtime.origin + '/api/v1/health');
    assert.equal((await health.text()).includes(token), false);
    await writeAuth(f.dir, ['B']);
    assert.equal((await post()).status, 401);
    clock += 100_000;
    assert.equal((await post()).status, 401);
  } finally { await f.close(); }
});

test('login rejects foreign origins, overlarge/unknown input and limits attempts', async () => {
  const f = await fixture();
  const login = (extra = {}, body = '{}') => fetch(f.runtime.origin + '/api/v1/session', { method: 'POST', headers: { ...f.baseHeaders, authorization: 'Bearer ' + 'x'.repeat(40), ...extra }, body });
  try {
    assert.equal((await login({ origin: 'http://foreign.invalid' })).status, 403);
    assert.equal((await login({}, '{"role":"admin"}')).status, 400);
    assert.equal((await login({}, JSON.stringify({ x: 'x'.repeat(5000) }))).status, 413);
    for (let i = 0; i < 5; i++) assert.equal((await login()).status, 401);
    assert.equal((await login()).status, 429);
  } finally { await f.close(); }
});
