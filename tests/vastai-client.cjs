const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const { utils } = require('ssh2');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(repo, '.tmp-vastai-runtime-'));
const tscBin = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(
  process.execPath,
  [tscBin, '-p', path.join(repo, 'tsconfig.electron.json'), '--outDir', runtime],
  { cwd: repo, stdio: 'inherit' },
);
const load = (relative) => import(pathToFileURL(path.join(runtime, 'main', relative)).href);
function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'ERR',
    text: async () => JSON.stringify(payload),
  };
}

(async () => {
  const {
    VastAiClient,
    VastAiInstanceNotFoundError,
    normalizeVastInstance,
    normalizeVastOffer,
    normalizeVastStatus,
    resolveVastComfyUiPort,
  } = await load('vastai-client.js');
  const { normalizeOpenSshPublicKey, validateSshKeyPair } = await load('ssh-key-pair.js');
  assert.equal(normalizeVastStatus({ actual_status: 'running' }), 'running');
  assert.equal(normalizeVastStatus({ actual_status: 'scheduling' }), 'scheduling');
  assert.equal(
    normalizeVastStatus({ actual_status: 'stopped', status_msg: 'success, running' }),
    'scheduling',
    'Vast list response may keep actual_status=stopped while status_msg reports accepted running request',
  );
  assert.equal(
    normalizeVastStatus({ actual_status: 'running', intended_status: 'stopped' }),
    'stopping',
    'running instance with stop intent must be shown as stopping',
  );
  assert.equal(
    normalizeVastStatus({
      actual_status: 'exited',
      intended_status: 'stopped',
      cur_state: 'stopped',
    }),
    'stopped',
  );
  assert.equal(
    normalizeVastStatus({
      actual_status: 'exited',
      intended_status: 'stopped',
      cur_state: 'stopped',
      next_state: 'running',
    }),
    'scheduling',
    'restart scheduling must be derived from next_state=running even while actual_status remains exited',
  );
  assert.equal(
    normalizeVastStatus({
      actual_status: 'stopped',
      intended_status: 'running',
      cur_state: 'stopped',
    }),
    'scheduling',
    'restart scheduling must be derived from intended_status=running while allocation is pending',
  );
  assert.equal(normalizeVastStatus({ actual_status: 'loading' }), 'starting');
  assert.equal(normalizeVastStatus({ actual_status: 'offline' }), 'offline');

  const mapped = normalizeVastInstance({
    id: 42,
    actual_status: 'running',
    public_ipaddr: '203.0.113.9',
    ssh_host: 'fallback.vast.ai',
    ssh_port: 10022,
    ports: {
      '22/tcp': [{ HostIp: '0.0.0.0', HostPort: '40022' }],
      '18188/tcp': [{ HostIp: '0.0.0.0', HostPort: '48188' }],
    },
    gpu_name: 'RTX 5090',
    num_gpus: 1,
    gpu_ram: 32768,
    dph_total: 0.75,
  });
  assert.equal(mapped.sshHost, '203.0.113.9');
  assert.equal(mapped.sshPort, 40022);
  assert.equal(mapped.comfyUiPort, 18188);
  assert.equal(
    resolveVastComfyUiPort({ ports: { '8188/tcp': [{ HostIp: '0.0.0.0', HostPort: '38188' }] } }),
    8188,
  );
  assert.equal(
    resolveVastComfyUiPort({ ports: { '22/tcp': [{ HostIp: '0.0.0.0', HostPort: '40022' }] } }),
    null,
  );
  const secondMapped = normalizeVastInstance({
    id: 43,
    actual_status: 'running',
    public_ipaddr: '203.0.113.10',
    ports: {
      '22/tcp': [{ HostIp: '0.0.0.0', HostPort: '40123' }],
      '8188/tcp': [{ HostIp: '0.0.0.0', HostPort: '48189' }],
    },
  });
  assert.equal(secondMapped.sshPort, 40123, 'SSH HostPortはInstanceごとの22/tcp mappingを使う');
  assert.equal(secondMapped.comfyUiPort, 8188);
  const proxyFallback = normalizeVastInstance({
    id: 44,
    actual_status: 'running',
    ssh_host: 'ssh44.vast.ai',
    ssh_port: 10444,
  });
  assert.equal(proxyFallback.sshHost, 'ssh44.vast.ai');
  assert.equal(proxyFallback.sshPort, 10444);
  assert.equal(mapped.gpuName, 'RTX 5090');
  assert.equal(mapped.hourlyCost, 0.75);
  const schedulingMapped = normalizeVastInstance({
    id: 45,
    actual_status: 'exited',
    intended_status: 'stopped',
    cur_state: 'stopped',
    next_state: 'running',
  });
  assert.equal(schedulingMapped.status, 'scheduling');
  assert.equal(schedulingMapped.nextState, 'running');

  const pair = utils.generateKeyPairSync('ed25519');
  const otherPair = utils.generateKeyPairSync('ed25519');
  const privatePath = path.join(runtime, 'id_test'),
    publicPath = privatePath + '.pub',
    mismatchPath = path.join(runtime, 'other.pub');
  fs.writeFileSync(privatePath, pair.private);
  fs.writeFileSync(publicPath, pair.public + ' test-comment\n');
  fs.writeFileSync(mismatchPath, otherPair.public);
  const validated = await validateSshKeyPair(privatePath, publicPath);
  assert.equal(validated.publicKey, normalizeOpenSshPublicKey(pair.public));
  await assert.rejects(
    () => validateSshKeyPair(privatePath, mismatchPath),
    /同じキーペアではありません/,
  );

  const calls = [];
  let lifecycleState = 'running',
    accountKeys = [{ id: 7, key: validated.publicKey }],
    instanceKeys = [{ id: 8, public_key: validated.publicKey }];
  const fakeFetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const u = new URL(String(url));
    if (u.pathname === '/api/v1/instances/' && u.searchParams.get('after_token') === 'next-page')
      return response({
        instances: [{ id: 2, actual_status: 'stopped', gpu_name: 'RTX 4090' }],
        next_token: null,
      });
    if (u.pathname === '/api/v1/instances/')
      return response({
        instances: [
          {
            id: 1,
            actual_status: 'running',
            ssh_host: 'ssh.vast.ai',
            ssh_port: 12345,
            gpu_name: 'RTX 5090',
          },
        ],
        next_token: 'next-page',
      });
    if (u.pathname === '/api/v0/ssh/' && (!init.method || init.method === 'GET'))
      return response(accountKeys);
    if (u.pathname === '/api/v0/ssh/' && init.method === 'POST') {
      const body = JSON.parse(init.body);
      accountKeys = [...accountKeys, { id: 9, key: body.ssh_key }];
      return response({ success: true, key: { id: 9, public_key: body.ssh_key } });
    }
    if (u.pathname === '/api/v0/instances/1/ssh/' && (!init.method || init.method === 'GET'))
      return response({ success: true, ssh_keys: JSON.stringify(instanceKeys) });
    if (u.pathname === '/api/v0/instances/1/ssh/' && init.method === 'POST') {
      const body = JSON.parse(init.body);
      instanceKeys = [...instanceKeys, { id: 10, public_key: body.ssh_key }];
      return response({ success: true, msg: 'SSH key attached successfully' });
    }
    if (u.pathname === '/api/v0/instances/reboot/1/' && init.method === 'PUT')
      return response({ success: true });
    if (u.pathname === '/api/v0/instances/1/' && init.method === 'DELETE')
      return response({ success: true, msg: 'Instance destroyed successfully' });
    if (u.pathname === '/api/v0/instances/1/' && init.method === 'PUT') {
      const requested = JSON.parse(init.body);
      lifecycleState = requested.state;
      return response({ success: true });
    }
    if (u.pathname === '/api/v0/instances/1/' && (!init.method || init.method === 'GET'))
      return response({
        instances: {
          id: 1,
          actual_status: lifecycleState,
          intended_status: lifecycleState,
          cur_state: lifecycleState,
          ssh_host: lifecycleState === 'running' ? 'ssh.vast.ai' : null,
          ssh_port: lifecycleState === 'running' ? 12345 : null,
        },
      });
    if (u.pathname === '/api/v0/instances/999/' && (!init.method || init.method === 'GET'))
      return response({ instances: {} });
    return response({ msg: 'not found' }, 404);
  };
  const client = new VastAiClient(async () => 'secret-key', fakeFetch, 'https://example.test');
  const instances = await client.listInstances();
  assert.deepEqual(
    instances.map((x) => x.id),
    [1, 2],
  );
  assert.equal(calls[0].init.headers.Authorization, 'Bearer secret-key');
  assert.match(calls[1].url, /after_token=next-page/);

  const existing = await client.ensureSshAccess(1, validated.publicKey + ' ignored-comment');
  assert.deepEqual(existing, {
    accountAlreadyRegistered: true,
    instanceAlreadyAttached: true,
    instanceAttached: true,
  });
  assert.equal(
    calls.filter((x) => x.init.method === 'POST' && new URL(x.url).pathname.includes('/ssh/'))
      .length,
    0,
    '既存鍵は再登録・再attachしない',
  );

  accountKeys = [];
  instanceKeys = [];
  const provisioned = await client.ensureSshAccess(1, validated.publicKey);
  assert.deepEqual(provisioned, {
    accountAlreadyRegistered: false,
    instanceAlreadyAttached: false,
    instanceAttached: true,
  });
  const sshPosts = calls.filter(
    (x) => x.init.method === 'POST' && new URL(x.url).pathname.includes('/ssh/'),
  );
  assert.equal(sshPosts.length, 2);
  assert.equal(new URL(sshPosts[0].url).pathname, '/api/v0/ssh/');
  assert.equal(new URL(sshPosts[1].url).pathname, '/api/v0/instances/1/ssh/');
  assert.equal(JSON.parse(sshPosts[0].init.body).ssh_key, validated.publicKey);
  assert.equal(JSON.parse(sshPosts[1].init.body).ssh_key, validated.publicKey);

  const one = await client.getInstance(1);
  assert.equal(one.sshHost, 'ssh.vast.ai');
  await assert.rejects(
    () => client.getInstance(999),
    (error) =>
      error instanceof VastAiInstanceNotFoundError &&
      error.instanceId === 999 &&
      /見つかりません/.test(error.message),
  );
  const started = await client.startInstance(1);
  assert.equal(started.status, 'running');
  const stopped = await client.stopInstance(1);
  assert.equal(stopped.status, 'stopped');
  await client.requestRebootInstance(1);
  await client.destroyInstance(1);
  const puts = calls.filter((x) => x.init.method === 'PUT');
  assert.equal(puts.length, 3);
  assert.deepEqual(JSON.parse(puts[0].init.body), { state: 'running' });
  assert.deepEqual(JSON.parse(puts[1].init.body), { state: 'stopped' });
  assert.equal(new URL(puts[2].url).pathname, '/api/v0/instances/reboot/1/');
  const deletes = calls.filter((x) => x.init.method === 'DELETE');
  assert.equal(deletes.length, 1);
  assert.equal(new URL(deletes[0].url).pathname, '/api/v0/instances/1/');
  assert.ok(puts.every((x) => x.init.headers.Authorization === 'Bearer secret-key'));
  assert.ok(
    calls.filter(
      (x) =>
        new URL(x.url).pathname === '/api/v0/instances/1/' &&
        (!x.init.method || x.init.method === 'GET'),
    ).length >= 3,
    'lifecycle操作後にGETで最終状態を確認する',
  );

  {
    const schedulingCalls = [];
    const schedulingFetch = async (url, init = {}) => {
      schedulingCalls.push({ url: String(url), init });
      const u = new URL(String(url));
      if (u.pathname === '/api/v1/instances/')
        return response({
          instances: [
            {
              id: 77,
              actual_status: 'stopped',
              intended_status: 'stopped',
              cur_state: 'stopped',
              status_msg: null,
            },
          ],
          next_token: null,
        });
      if (u.pathname === '/api/v0/instances/77/' && init.method === 'PUT')
        return response({ success: true });
      if (u.pathname === '/api/v0/instances/77/' && (!init.method || init.method === 'GET'))
        return response({
          instances: {
            id: 77,
            actual_status: 'stopped',
            intended_status: 'stopped',
            cur_state: 'stopped',
            status_msg: null,
          },
        });
      return response({ msg: 'not found' }, 404);
    };
    const schedulingClient = new VastAiClient(
      async () => 'secret-key',
      schedulingFetch,
      'https://example.test',
    );
    const before = (await schedulingClient.listInstances())[0];
    assert.equal(before.status, 'stopped');
    await schedulingClient.requestStartInstance(77);
    const afterStart = (await schedulingClient.listInstances())[0];
    assert.equal(
      afterStart.status,
      'scheduling',
      'accepted start request must stay Scheduling even when Vast API still reports stopped without intent fields',
    );
    assert.match(afterStart.statusMessage, /起動要求を送信済み/);
    await schedulingClient.requestStopInstance(77);
    const afterStop = (await schedulingClient.listInstances())[0];
    assert.equal(
      afterStop.status,
      'stopped',
      'explicit stop request must cancel the local Scheduling intent when provider is already stopped',
    );
  }

  {
    const marketCalls = [];
    let createdVisible = false;
    const template = {
      id: 101,
      hash_id: 'comfy-hash',
      name: 'ComfyUI',
      recommended_disk_space: 120,
      count_created: 999,
      extra_filters: { cuda_max_good: { gte: 12.6 } },
    };
    const richOffer = {
      id: 123,
      gpu_name: 'RTX 5090',
      num_gpus: 1,
      gpu_ram: 32768,
      gpu_total_ram: 32768,
      total_flops: 104.8,
      gpu_mem_bw: 1792,
      verification: 'verified',
      geolocation: 'Tokyo, JP',
      machine_id: 77,
      host_id: 88,
      mobo_name: 'Test Board',
      pci_gen: 5,
      gpu_lanes: 16,
      pcie_bw: 48.2,
      cpu_name: 'EPYC Test',
      cpu_cores: 32,
      cpu_cores_effective: 16,
      cpu_ram: 131072,
      disk_name: 'NVMe',
      disk_bw: 6500,
      disk_space: 900,
      inet_down: 1500,
      inet_up: 900,
      direct_port_count: 64,
      dlperf: 180,
      cuda_max_good: 13.0,
      duration: 604800,
      reliability: 0.997,
      dlperf_per_dphtotal: 220,
      flops_per_dphtotal: 130,
      dph_total: 0.82,
      storage_cost: 0.003,
      internet_down_cost_per_tb: 0.02,
      internet_up_cost_per_tb: 0.03,
    };
    const cheapOffer = { ...richOffer, id: 124, gpu_name: 'RTX 4090', dph_total: 0.45 };
    const marketFetch = async (url, init = {}) => {
      marketCalls.push({ url: String(url), init });
      const u = new URL(String(url));
      if (u.pathname === '/api/v1/instances/')
        return response({
          instances: createdVisible
            ? [
                {
                  id: 456,
                  actual_status: 'loading',
                  intended_status: 'running',
                  cur_state: 'loading',
                  label: 'ComfyUI Batch Studio',
                  gpu_name: 'RTX 5090',
                  num_gpus: 1,
                  gpu_ram: 32768,
                  dph_total: 0.82,
                },
              ]
            : [],
          next_token: null,
        });
      if (u.pathname === '/api/v0/template/') {
        const filters = JSON.parse(u.searchParams.get('select_filters'));
        assert.deepEqual(filters.name, { eq: 'ComfyUI' });
        assert.deepEqual(filters.recommended, { eq: true });
        assert.deepEqual(filters.use_ssh, { eq: true });
        assert.deepEqual(filters.ssh_direct, { eq: true });
        if (filters.hash_id) assert.deepEqual(filters.hash_id, { eq: 'comfy-hash' });
        return response({ templates: [template] });
      }
      if (u.pathname === '/api/v0/bundles' && init.method === 'POST') {
        const body = JSON.parse(init.body);
        if (body.id?.eq === 123) return response({ offers: [richOffer] });
        assert.equal(body.type, 'on-demand');
        assert.equal(body.limit, 100);
        assert.deepEqual(body.rentable, { eq: true });
        assert.deepEqual(body.rented, { eq: false });
        assert.equal(body.allocated_storage, 120);
        assert.deepEqual(body.num_gpus, { eq: 1 });
        assert.deepEqual(body.total_flops, { gte: 60 });
        assert.deepEqual(body.reliability, { gte: 0.99 });
        assert.deepEqual(body.geolocation, { notin: ['CN', 'RU'] });
        assert.deepEqual(body.order, [['dph_total', 'asc']]);
        assert.deepEqual(
          body.cuda_max_good,
          { gte: 12.6 },
          'ComfyUI Template extra_filtersを検索条件へ反映する',
        );
        for (const key of [
          'gpu_name',
          'gpu_ram',
          'dph_total',
          'verification',
          'inet_down',
          'disk_bw',
        ])
          assert.equal(body[key], undefined, key + ' must remain result-only');
        return response({ offers: [richOffer, cheapOffer] });
      }
      if (u.pathname === '/api/v0/asks/123/' && init.method === 'PUT') {
        const body = JSON.parse(init.body);
        assert.deepEqual(body, {
          template_hash_id: 'comfy-hash',
          disk: 120,
          target_state: 'running',
          label: 'ComfyUI Batch Studio',
        });
        assert.equal(body.price, undefined, 'On-demand RENTにbid priceを送らない');
        return response({ success: true, new_contract: 456 });
      }
      return response({ msg: 'not found' }, 404);
    };
    const marketClient = new VastAiClient(
      async () => 'secret-key',
      marketFetch,
      'https://example.test',
    );
    const templateResult = await marketClient.comfyUiTemplate();
    assert.equal(templateResult.hashId, 'comfy-hash');
    assert.equal(templateResult.recommendedDiskSpaceGb, 120);
    const searchResult = await marketClient.searchOffers({
      storageGb: 120,
      minTflops: 60,
      gpuCount: 1,
      minReliability: 99,
      excludedCountries: ['CN', 'RU'],
    });
    assert.equal(searchResult.offers.length, 2);
    assert.deepEqual(
      searchResult.offers.map((x) => x.id),
      [124, 123],
      '検索結果は時間単価の安い順に返す',
    );
    assert.equal(searchResult.offers[0].gpuName, 'RTX 4090');
    assert.equal(searchResult.offers[1].totalFlops, 104.8);
    assert.equal(searchResult.offers[1].hourlyCost, 0.82);
    const normalized = normalizeVastOffer(richOffer);
    assert.equal(normalized.internetDownMb, 1500);
    assert.equal(normalized.diskBandwidthMb, 6500);
    await assert.rejects(
      () =>
        marketClient.searchOffers({
          storageGb: 100,
          minTflops: 0,
          gpuCount: 1,
          minReliability: 90,
          excludedCountries: [],
        }),
      /推奨Storageは 120 GB以上/,
    );
    const instanceId = await marketClient.rentOffer({
      offerId: 123,
      storageGb: 120,
      templateHashId: 'comfy-hash',
    });
    assert.equal(instanceId, 456);
    assert.ok(
      marketCalls.some(
        (x) => new URL(x.url).pathname === '/api/v0/asks/123/' && x.init.method === 'PUT',
      ),
    );
    const pendingInstances = await marketClient.listInstances();
    assert.equal(pendingInstances.length, 1, 'RENT直後に一覧APIへ未反映でも新Instanceを保持する');
    assert.equal(pendingInstances[0].id, 456);
    assert.equal(pendingInstances[0].status, 'starting');
    assert.equal(pendingInstances[0].rawStatus, 'creating');
    assert.match(pendingInstances[0].statusMessage, /Instance一覧への反映を待っています/);
    createdVisible = true;
    const visibleInstances = await marketClient.listInstances();
    assert.equal(visibleInstances.length, 1);
    assert.equal(visibleInstances[0].id, 456);
    assert.equal(
      visibleInstances[0].rawStatus,
      'loading',
      'Vast.ai一覧へ反映後は実レスポンスへ置き換える',
    );
  }

  console.log('Vast.ai client tests passed.');
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(runtime, { recursive: true, force: true });
  });
