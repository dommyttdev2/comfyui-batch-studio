#!/bin/sh
set -eu
test ! -f node_modules/electron/dist/electron
npm run test:projects
npm run test:web
npm run test:agents
npm run test:server
npm run test:core
npm run typecheck
npm run typecheck:web
npm run check
node docs/roadmap/web-migration-audit.cjs --check
