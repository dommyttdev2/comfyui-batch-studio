#!/bin/sh
set -eu

node --version
python --version
python -c 'import fcntl'
test -x node_modules/electron/dist/electron

npm run check
npm run typecheck
npm test
npm run build

node tests/image-memory-benchmark.cjs
xvfb-run -a node_modules/.bin/electron --no-sandbox tests/image-memory-electron.cjs
BATCH_STUDIO_IMAGE_TEST_SIDE=3584 xvfb-run -a node_modules/.bin/electron --no-sandbox tests/image-memory-electron.cjs
