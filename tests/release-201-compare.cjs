const assert = require('node:assert/strict');
const fs = require('node:fs');

function readResults(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('RELEASE201 '))
    .map((line) => JSON.parse(line.slice(line.indexOf('RELEASE201 ') + 'RELEASE201 '.length)));
}

function fixed(value) {
  return Number(value).toFixed(2);
}

function pair(before, after, key) {
  return `${fixed(before[key].p50)}/${fixed(before[key].p95)} → ${fixed(after[key].p50)}/${fixed(
    after[key].p95,
  )}`;
}

const [beforeFile, afterFile] = process.argv.slice(2);
assert.ok(beforeFile && afterFile, 'Usage: release-201-compare.cjs before.log after.log');
const before = readResults(beforeFile);
const after = readResults(afterFile);
assert.deepEqual(
  before.map((entry) => entry.count),
  [100, 500, 2000],
  'before benchmark must contain all required dataset sizes',
);
assert.deepEqual(
  after.map((entry) => entry.count),
  [100, 500, 2000],
  'after benchmark must contain all required dataset sizes',
);

for (const entry of [...before, ...after]) {
  assert.deepEqual(entry.formats, ['png', 'jpeg', 'webp']);
  for (const metric of ['initial', 'redisplay', 'search', 'columns', 'scroll', 'ipcKB', 'rssMB']) {
    assert.ok(Number.isFinite(entry.ui[metric].p50));
    assert.ok(Number.isFinite(entry.ui[metric].p95));
  }
  assert.ok(Number.isFinite(entry.service.initial.p50));
  assert.ok(Number.isFinite(entry.service.initial.p95));
  assert.ok(Number.isFinite(entry.service.redisplay.p50));
  assert.ok(Number.isFinite(entry.service.redisplay.p95));
}
const before2000 = before.find((entry) => entry.count === 2000);
const after2000 = after.find((entry) => entry.count === 2000);
assert.ok(
  before2000.ui.mounted.p50 >= 1900,
  'baseline must reproduce the non-virtualized 2000-item DOM',
);
assert.ok(
  after2000.ui.mounted.p95 < 100,
  'current picker must keep the mounted image count bounded',
);
assert.ok(
  after2000.service.redisplay.p95 <= before2000.service.redisplay.p95 * 1.25,
  'shared cache/direct authorization must not regress 2000-item redisplay p95 materially',
);

console.log('Release #201 before/after benchmark (p50/p95 ms unless noted)');
console.log(
  '| Count | Picker initial | Redisplay | Scroll | Search | Columns | IPC KB | Renderer RSS MB | Service preview | Service redisplay |',
);
console.log('| ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (let index = 0; index < before.length; index++) {
  const previous = before[index];
  const current = after[index];
  console.log(
    `| ${current.count} | ${pair(previous.ui, current.ui, 'initial')} | ${pair(
      previous.ui,
      current.ui,
      'redisplay',
    )} | ${pair(previous.ui, current.ui, 'scroll')} | ${pair(
      previous.ui,
      current.ui,
      'search',
    )} | ${pair(previous.ui, current.ui, 'columns')} | ${pair(
      previous.ui,
      current.ui,
      'ipcKB',
    )} | ${pair(previous.ui, current.ui, 'rssMB')} | ${pair(
      previous.service,
      current.service,
      'initial',
    )} | ${pair(previous.service, current.service, 'redisplay')} |`,
  );
}
console.log(
  `2000-item mounted images p50/p95: ${fixed(before2000.ui.mounted.p50)}/${fixed(
    before2000.ui.mounted.p95,
  )} → ${fixed(after2000.ui.mounted.p50)}/${fixed(after2000.ui.mounted.p95)}`,
);
