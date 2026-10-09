import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ssh2 from 'ssh2';
import { ExternalOperations } from '../dist-server/server/external-operations.js';
import { IntegrationSettings } from '../dist-server/server/integration-settings.js';
import { captureSshHostKey, probeSsh, SshResources } from '../dist-server/server/ssh-resources.js';
import { WebVastClient } from '../dist-server/server/vast-client.js';
import { VastService } from '../dist-server/server/vast-service.js';

const actor = {
  userId: 'operator',
  sessionId: 'session',
  requestId: 'request',
  projectIds: ['A'],
  permissions: ['read', 'execute', 'admin'],
};
const secret = 'fixture-private-vast-credential';
const response = (value) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const rent = { offerId: 7, storageGb: 50, templateHashId: 'template' };
const instance = () => ({
  id: 11,
  actual_status: 'running',
  intended_status: 'running',
  label: 'fixture',
  public_ipaddr: '203.0.113.7',
  ports: { '22/tcp': [{ HostPort: '2222' }], '18188/tcp': [{ HostPort: '18188' }] },
  dph_total: 0.2,
});
async function directory(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'web-vast-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
function api() {
  let price = 0.2,
    effects = 0,
    lost = false,
    status = 'running',
    token = null;
  const calls = [];
  const attached = new Map();
  return {
    calls,
    get effects() {
      return effects;
    },
    set price(value) {
      price = value;
    },
    set lost(value) {
      lost = value;
    },
    set status(value) {
      status = value;
    },
    set token(value) {
      token = value;
    },
    fetch: async (url, init) => {
      assert.equal(url.origin, 'https://console.vast.ai');
      assert.equal(init.headers.Authorization, 'Bearer ' + secret);
      assert.equal(init.redirect, 'error');
      calls.push({ path: url.pathname, method: init.method, body: init.body });
      if (url.pathname === '/api/v0/template/')
        return response({
          templates: [
            {
              id: 1,
              hash_id: 'template',
              name: 'ComfyUI',
              recommended_disk_space: 20,
              count_created: 3,
              extra_filters: {},
            },
          ],
        });
      if (url.pathname === '/api/v0/bundles/')
        return response({
          offers: [
            {
              id: 7,
              gpu_name: 'GPU',
              num_gpus: 1,
              machine_id: 3,
              dph_total: price,
              storage_cost: 0.01,
            },
          ],
        });
      if (url.pathname === '/api/v1/instances/')
        return response({
          instances: [{ ...instance(), actual_status: status, intended_status: status }],
          next_token: token,
        });
      if (url.pathname === '/api/v0/instances/11/' && init.method === 'GET')
        return response({
          instances: { ...instance(), actual_status: status, intended_status: status },
        });
      if (url.pathname === '/api/v0/ssh/' || url.pathname === '/api/v0/instances/11/ssh/') {
        if (init.method === 'GET') return response(attached.get(url.pathname) ?? []);
        attached.set(url.pathname, [{ ssh_key: JSON.parse(init.body).ssh_key }]);
        effects++;
        return response({ success: true });
      }
      effects++;
      if (lost) throw new Error('accepted response lost');
      return response({ success: true, new_contract: 11 });
    },
  };
}
async function setup(dir, provider) {
  const settings = new IntegrationSettings(dir, { BATCH_STUDIO_SECRET_VAST_API_KEY: secret });
  await settings.initialize();
  await settings.register('environment', { vast: {} });
  const service = new VastService(dir, settings, provider.fetch);
  await service.initialize();
  const operations = new ExternalOperations(dir, service.definitions());
  await operations.initialize();
  return { settings, service, operations };
}
test('fixed endpoints reuse offer policy, paginate current instances and never invent pending instances', async () => {
  const provider = api(),
    client = new WebVastClient(secret, provider.fetch);
  const result = await client.offers.search({
    storageGb: 50,
    minTflops: 0,
    gpuCount: 1,
    minReliability: 99,
    excludedCountries: ['CN'],
  });
  assert.equal(result.template.hashId, 'template');
  assert.equal(result.offers[0].id, 7);
  const criteria = JSON.parse(provider.calls.find((c) => c.path === '/api/v0/bundles/').body);
  assert.deepEqual(criteria.geolocation, { notin: ['CN'] });
  assert.deepEqual(criteria.verified, { eq: true });
  assert.equal((await client.instances())[0].sshPort, 2222);
  provider.token = 'repeat';
  await assert.rejects(client.instances(), { code: 'VAST_PROTOCOL' });
});
test('malformed identities, Secret echo, response size, auth and streaming deadline reject without retry', async () => {
  for (const value of [
    { instances: { id: 12, actual_status: 'running' } },
    { instances: { id: 11, status: 'running' } },
    { echo: secret },
  ]) {
    const client = new WebVastClient(secret, async () => response(value));
    await assert.rejects(client.instance(11));
  }
  let calls = 0;
  const client = new WebVastClient(secret, async () => {
    calls++;
    return new Response('private raw error', { status: 401 });
  });
  await assert.rejects(client.instances(), { code: 'VAST_REJECTED' });
  assert.equal(calls, 1);
  const large = new WebVastClient(secret, async () =>
    response({ data: 'x'.repeat(4 * 1024 * 1024) }),
  );
  await assert.rejects(large.instances(), { code: 'VAST_RESPONSE_LIMIT' });
  const deadline = new WebVastClient(
    secret,
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('{'));
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    15,
  );
  await assert.rejects(deadline.instances());
});
test('RENT changed quote, owner and operation mismatch refuse writes; confirmed reservation executes once', () =>
  directory(async (dir) => {
    const provider = api(),
      { service, operations } = await setup(dir, provider);
    const { targetId } = await service.createTarget(actor, { operation: 'rent-instance', rent });
    const prepared = await operations.prepare(actor, 'rent-instance', targetId);
    provider.price = 0.3;
    await assert.rejects(
      operations.confirm(actor, 'rent-instance', targetId, prepared.confirmationId),
      { code: 'TARGET_CHANGED' },
    );
    assert.equal(provider.effects, 0);
    await assert.rejects(
      operations.prepare({ ...actor, userId: 'other' }, 'rent-instance', targetId),
      { code: 'NOT_FOUND' },
    );
    await assert.rejects(operations.prepare(actor, 'delete-instance', targetId));
    const fresh = await operations.prepare(actor, 'rent-instance', targetId);
    const receipt = await operations.confirm(
      actor,
      'rent-instance',
      targetId,
      fresh.confirmationId,
    );
    await operations.drain();
    assert.equal(operations.read(actor, receipt.id).state, 'succeeded');
    assert.equal(provider.effects, 1);
    await assert.rejects(
      operations.confirm(actor, 'rent-instance', targetId, fresh.confirmationId),
      { code: 'CONFIRMATION_CONSUMED' },
    );
    assert.ok(!(await readFile(path.join(dir, 'vast.json'), 'utf8')).includes(secret));
  }));
test('accepted RENT with lost reply persists uncertain on restart, blocks another offer and never retries', () =>
  directory(async (dir) => {
    const provider = api(),
      { settings, service, operations } = await setup(dir, provider);
    provider.lost = true;
    const { targetId } = await service.createTarget(actor, { operation: 'rent-instance', rent });
    const prepared = await operations.prepare(actor, 'rent-instance', targetId);
    const receipt = await operations.confirm(
      actor,
      'rent-instance',
      targetId,
      prepared.confirmationId,
    );
    await operations.drain();
    assert.equal(operations.read(actor, receipt.id).state, 'uncertain');
    const restart = new VastService(dir, settings, provider.fetch);
    await restart.initialize();
    const store = new ExternalOperations(dir, restart.definitions());
    await store.initialize();
    assert.equal((await store.reconcile(actor, receipt.id)).state, 'uncertain');
    const next = await restart.createTarget(actor, { operation: 'rent-instance', rent });
    const confirmation = await store.prepare(actor, 'rent-instance', next.targetId);
    await assert.rejects(
      store.confirm(actor, 'rent-instance', next.targetId, confirmation.confirmationId),
      { code: 'EXTERNAL_SCOPE_BUSY' },
    );
    assert.equal(provider.effects, 1);
  }));
test('instance lifecycle confirms current state, rejects settings rotation and read-only reconciliation observes final state', () =>
  directory(async (dir) => {
    const provider = api(),
      { settings, service, operations } = await setup(dir, provider);
    const { targetId } = await service.createTarget(actor, {
      operation: 'stop-instance',
      instanceId: 11,
    });
    const prepared = await operations.prepare(actor, 'stop-instance', targetId);
    provider.lost = true;
    const receipt = await operations.confirm(
      actor,
      'stop-instance',
      targetId,
      prepared.confirmationId,
    );
    await operations.drain();
    provider.status = 'stopped';
    assert.equal((await operations.reconcile(actor, receipt.id)).state, 'succeeded');
    assert.equal(provider.effects, 1);
    await settings.update(actor, 'vast', 1, { enabled: false });
    await assert.rejects(operations.prepare(actor, 'stop-instance', targetId));
  }));
test('SSH new key resource validates pair; host change rejects before provisioning, confirm persists trust without public paths', () =>
  directory(async (dir) => {
    const provider = api(),
      { settings } = await setup(dir, provider);
    const root = await mkdtemp(path.join(os.tmpdir(), 'web-ssh-key-'));
    try {
      const pair = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
      });
      const parsed = ssh2.utils.parseKey(pair.privateKey);
      assert.ok(!(parsed instanceof Error));
      const privateFile = path.join(root, 'test-key'),
        publicFile = path.join(root, 'test-key.pub');
      await writeFile(privateFile, pair.privateKey, { mode: 0o600 });
      await writeFile(publicFile, parsed.type + ' ' + parsed.getPublicSSH().toString('base64'), {
        mode: 0o600,
      });
      let observed = 'SHA256:' + 'A'.repeat(43),
        probes = 0;
      const ssh = new SshResources(dir, settings, provider.fetch, async () => {
        probes++;
        return observed;
      });
      await ssh.initialize();
      await ssh.register({
        id: 'new-key',
        root,
        privateFile,
        publicFile,
        user: 'root',
        directory: '/workspace/ComfyUI',
      });
      await assert.rejects(ssh.endpoint(actor, 11), { code: 'SSH_TRUST_REQUIRED' });
      const { targetId } = await ssh.createCandidate(actor, { instanceId: 11, keyId: 'new-key' });
      const store = new ExternalOperations(dir, new Map([['trust-ssh', ssh.definition]]));
      await store.initialize();
      const prepared = await store.prepare(actor, 'trust-ssh', targetId);
      assert.equal(prepared.summary.fingerprint, observed);
      observed = 'SHA256:' + 'B'.repeat(43);
      await assert.rejects(store.confirm(actor, 'trust-ssh', targetId, prepared.confirmationId), {
        code: 'SSH_HOST_CHANGED',
      });
      assert.equal(provider.effects, 0);
      observed = 'SHA256:' + 'A'.repeat(43);
      const next = await store.prepare(actor, 'trust-ssh', targetId);
      const receipt = await store.confirm(actor, 'trust-ssh', targetId, next.confirmationId);
      await store.drain();
      assert.equal(store.read(actor, receipt.id).state, 'succeeded');
      assert.equal(provider.effects, 2);
      const endpoint = await ssh.endpoint(actor, 11);
      assert.equal(endpoint.keyId, 'new-key');
      assert.ok(!JSON.stringify(endpoint).includes(root));
      assert.ok(!JSON.stringify(endpoint).includes('privateFile'));
      assert.ok(probes >= 4);
      observed = 'SHA256:' + 'C'.repeat(43);
      await assert.rejects(ssh.endpoint(actor, 11), { code: 'SSH_HOST_CHANGED' });
      await assert.rejects(
        ssh.createCandidate(
          { ...actor, permissions: ['read'] },
          { instanceId: 11, keyId: 'new-key' },
        ),
        { code: 'FORBIDDEN' },
      );
      await writeFile(privateFile, 'modified', { mode: 0o600 });
      await assert.rejects(ssh.createCandidate(actor, { instanceId: 11, keyId: 'new-key' }), {
        code: 'SSH_RESOURCE_CHANGED',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }));
test('SSH probe refuses loopback/private hosts before key exchange; unknown stores never migrate', () =>
  directory(async (dir) => {
    await assert.rejects(probeSsh('127.0.0.1', 22), { code: 'SSH_HOST_REJECTED' });
    const settings = new IntegrationSettings(dir);
    await settings.initialize();
    await writeFile(path.join(dir, 'ssh.json'), JSON.stringify({ schema: 'old' }), { mode: 0o600 });
    await assert.rejects(new SshResources(dir, settings).initialize(), {
      code: 'SSH_STORE_UNAVAILABLE',
    });
    await writeFile(path.join(dir, 'vast.json'), JSON.stringify({ schema: 'old' }), {
      mode: 0o600,
    });
    await assert.rejects(new VastService(dir, settings).initialize(), {
      code: 'VAST_STORE_UNAVAILABLE',
    });
  }));

import { fixture } from './server-fixtures.mjs';

test('authenticated HTTP management uses server targets and confirmation; raw paths, boolean bypass, CSRF and build mismatch reject', async () => {
  let service, operations;
  const provider = api();
  const f = await fixture({
    route: async (context) => (await service.route(context)) || (await operations.route(context)),
  });
  try {
    ({ service, operations } = await setup(f.dir, provider));
    const base = f.runtime.origin + '/api/v1/integrations/';
    const post = (suffix, input, headers = f.headers) =>
      fetch(base + suffix, { method: 'POST', headers, body: JSON.stringify(input) });
    assert.equal((await fetch(base + 'vast/instances', { headers: f.baseHeaders })).status, 401);
    assert.equal((await fetch(base + 'vast/instances', { headers: f.headers })).status, 200);
    assert.equal(
      (
        await post('vast/targets', {
          operation: 'rent-instance',
          rent,
          privateKeyPath: 'C:/secret',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await post(
          'vast/targets',
          { operation: 'rent-instance', rent },
          { ...f.headers, 'x-csrf-token': 'bad' },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await post(
          'vast/targets',
          { operation: 'rent-instance', rent },
          { ...f.headers, 'x-batch-build-id': 'bad' },
        )
      ).status,
      409,
    );
    const target = await (await post('vast/targets', { operation: 'rent-instance', rent })).json();
    assert.equal(
      (
        await post('operations/confirm', {
          operation: 'rent-instance',
          targetId: target.targetId,
          confirmed: true,
        })
      ).status,
      400,
    );
    assert.equal(provider.effects, 0);
    const prepared = await (
      await post('operations/prepare', { operation: 'rent-instance', targetId: target.targetId })
    ).json();
    assert.ok(!JSON.stringify(prepared).includes(secret));
    const result = await post('operations/confirm', {
      operation: 'rent-instance',
      targetId: target.targetId,
      confirmationId: prepared.confirmationId,
    });
    assert.equal(result.status, 202);
    const receipt = await result.json();
    await operations.drain();
    const observed = await (
      await fetch(base + 'operations/receipts/' + receipt.id, { headers: f.headers })
    ).json();
    assert.equal(observed.state, 'succeeded');
    assert.equal(provider.effects, 1);
  } finally {
    await f.close();
  }
});
test('native SSH key exchange captures server fingerprint before any authentication or command', async () => {
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  let authentications = 0,
    commands = 0;
  const clients = new Set();
  const server = new ssh2.Server({ hostKeys: [pair.privateKey] }, (client) => {
    clients.add(client);
    client.on('error', () => {});
    client.on('close', () => clients.delete(client));
    client.on('authentication', (ctx) => {
      authentications++;
      ctx.reject();
    });
    client.on('session', (accept) => {
      commands++;
      accept();
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const observed = await captureSshHostKey('127.0.0.1', server.address().port);
    const parsed = ssh2.utils.parseKey(pair.privateKey);
    const { createHash } = await import('node:crypto');
    const expected =
      'SHA256:' +
      createHash('sha256').update(parsed.getPublicSSH()).digest('base64').replace(/=+$/, '');
    assert.equal(observed, expected);
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(authentications, 0);
    assert.equal(commands, 0);
  } finally {
    for (const client of clients) client.end();
    await new Promise((resolve) => server.close(resolve));
  }
});
