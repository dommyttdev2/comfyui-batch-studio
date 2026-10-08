import { mkdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DockerAgentAdapter, type AgentRunnerConfig } from './agent-cli-runtime.js';
import type { AgentRuntimeOptions } from './agent-runtime.js';
import type { AgentProvider } from '../domain/agent-runtime-types.js';
import { BusinessError } from '../domain/contracts.js';
import { fields, identifier, object } from './http.js';
import { ProjectRegistry } from './ownership.js';
import { agentScopeKey, type AgentRecord } from './agent-store.js';
function contains(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return !relative || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
export async function loadAgentRegistration(
  dataDir: string,
): Promise<
  | (AgentRuntimeOptions & { outputGuard(record: AgentRecord, raw: string): Promise<void> })
  | undefined
> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path.join(dataDir, 'agent-runtime.json'), 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
  const config = object(value);
  fields(config, ['schema', 'docker', 'image', 'directory', 'context', 'providers']);
  if (
    config.schema !== 'web-agent-runtime/1' ||
    typeof config.image !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(config.image) ||
    typeof config.directory !== 'string' ||
    !path.isAbsolute(config.directory) ||
    typeof config.docker !== 'string' ||
    !path.isAbsolute(config.docker)
  )
    throw new Error('Invalid CLI registration.');
  const context = identifier(config.context),
    docker = await realpath(config.docker);
  if (!(await stat(docker)).isFile()) throw new Error('Docker executable unavailable.');
  await mkdir(config.directory, { recursive: true, mode: 0o700 });
  const directory = await realpath(config.directory),
    data = await realpath(dataDir);
  if (contains(data, directory) || contains(directory, data))
    throw new Error('CLI directory overlaps server data.');
  for (const project of await new ProjectRegistry(dataDir).records())
    if (contains(project.root, directory) || contains(directory, project.root))
      throw new Error('CLI directory overlaps Project.');
  const providers = object(config.providers);
  fields(providers, ['codex', 'grok']);
  const registered = new Map<AgentProvider, AgentRunnerConfig>();
  for (const provider of ['codex', 'grok'] as const) {
    if (providers[provider] === undefined) continue;
    const p = object(providers[provider]);
    fields(p, ['credential', 'version']);
    if (
      typeof p.credential !== 'string' ||
      !path.isAbsolute(p.credential) ||
      typeof p.version !== 'string' ||
      !/^\d+\.\d+\.\d+$/.test(p.version)
    )
      throw new Error('Invalid CLI provider registration.');
    const credential = await realpath(p.credential),
      info = await stat(credential);
    if (!info.isFile() || info.size > 128 * 1024) throw new Error('Invalid credential file.');
    registered.set(provider, {
      provider,
      context,
      docker,
      image: config.image,
      directory,
      credential,
      version: p.version,
    });
  }
  const selected = (provider: AgentProvider) => {
    const c = registered.get(provider);
    if (!c) throw new BusinessError('DEPENDENCY_UNAVAILABLE', 'Provider not configured.');
    return c;
  };
  return {
    directory,
    configuredProviders: [...registered.keys()],
    assertIsolation: async () => {
      if ((await realpath(directory)) !== directory || (await realpath(dataDir)) !== data)
        throw new Error('CLI root identity changed.');
      for (const project of await new ProjectRegistry(dataDir).records()) {
        const root = await realpath(project.root);
        if (contains(root, directory) || contains(directory, root))
          throw new Error('CLI directory overlaps Project.');
      }
    },
    adapter: (scope, jobId) => new DockerAgentAdapter({ ...selected(scope.provider), jobId }),
    stopped: (scope, id) => new DockerAgentAdapter(selected(scope.provider)).absent(id),
    terminate: (scope, id) => new DockerAgentAdapter(selected(scope.provider)).terminate(id),
    outputGuard: async (record, raw) => {
      const c = selected(record.scope.provider),
        scope = agentScopeKey(record.userId, record.scope) + ':' + record.conversationId,
        home = path.join(
          directory,
          createHash('sha256').update(scope).digest('hex'),
          record.scope.provider,
        );
      for (const file of [c.credential, path.join(home, 'auth.json')]) {
        const visit = (v: unknown): void => {
          if (typeof v === 'string' && v.length >= 16 && raw.includes(v))
            throw new Error('Credential in CLI output.');
          if (v && typeof v === 'object') Object.values(v).forEach(visit);
        };
        visit(JSON.parse(await readFile(file, 'utf8')));
      }
    },
  };
}
