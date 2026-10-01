const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { readMainProcessSource } = require('./main-process-source.cjs');

const main = readMainProcessSource(repo);
const start = main.indexOf('IPC.MARKETPLACE_GENERATE_ZIP,');
const end = main.indexOf('IPC.MARKETPLACE_RENDER_PNG,', start);
assert.ok(start >= 0 && end > start);
const begin = main.lastIndexOf('handleIpc(', start);
const fragment = main.slice(begin, main.lastIndexOf('handleIpc(', end));
const javascript = fragment.replace(/: unknown/g, '');
const handlers = new Map();
let status = 'STOPPED';
const writes = [];
vm.runInNewContext(javascript, {
  IPC: { MARKETPLACE_GENERATE_ZIP: 'zip', MARKETPLACE_EXPORT_CUSTOM: 'custom' },
  handleIpc: (name, handler) => handlers.set(name, handler),
  validRoot: (root) => assert.equal(root, 'project-root'),
  ensureProjectWritable: async () => {
    if (status !== 'STOPPED') throw new Error('Project is read-only');
  },
  generateMarketplaceZip: async () => {
    writes.push('zip');
  },
  exportCustomMarketplaceImage: async () => {
    writes.push('custom');
  },
});

(async () => {
  for (const name of ['zip', 'custom']) {
    assert.ok(handlers.has(name), `${name} IPC handler is registered`);
    for (const blocked of ['RUNNING', 'PAUSED', 'RECOVERY_UNCERTAIN', 'CORRUPT_RUN']) {
      status = blocked;
      await assert.rejects(() => handlers.get(name)({}, 'project-root', 'jpeg', {}), /read-only/);
      assert.deepEqual(writes, [], `${name} must reject before any output or editor write`);
    }
    status = 'STOPPED';
    await handlers.get(name)({}, 'project-root', 'jpeg', {});
    assert.equal(writes.at(-1), name);
    writes.length = 0;
  }
  for (const read of [
    'MARKETPLACE_LOAD',
    'MARKETPLACE_READ_SOURCE',
    'MARKETPLACE_READ_SOURCE_PREVIEW',
    'MARKETPLACE_LIST_THUMBNAILS',
  ]) {
    const at = main.indexOf(`IPC.${read},`);
    assert.ok(at >= 0);
    const following = main.indexOf('handleIpc(', at + read.length);
    assert.doesNotMatch(
      main.slice(at, following < 0 ? undefined : following),
      /ensureProjectWritable/,
    );
  }
  console.log('Marketplace write IPC guards passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
