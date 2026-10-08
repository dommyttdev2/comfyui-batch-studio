import { createServerRuntime } from '../dist-server/server/runtime.js';
import { loadConfig } from '../dist-server/server/config.js';
import { fixtureAgents } from './server-agent-fixtures.mjs';
const config = await loadConfig({ dataDir: process.argv[2], port: 0 });
const runtime = await createServerRuntime(config, {
  agents: fixtureAgents(process.argv[3], { hold: true }),
});
process.send({ origin: runtime.origin, buildId: config.buildId });
