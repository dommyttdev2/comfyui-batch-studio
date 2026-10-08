import path from 'node:path';
import type { ServerConfig } from './config.js';
import { EventBroker, attachEvents } from './events.js';
import { webStatic } from './web-static.js';
import { fields, HttpFailure, json, type CommandController } from './http.js';
import { JobRegistry, type JobDefinition } from './jobs.js';
import { FileLease, Ownership } from './ownership.js';
import { FixtureCatalog, WorkflowApi } from './workflow-api.js';
import { ProjectApi } from './project-api.js';
import { DiskProjects } from './project-repository.js';
import { ProjectRegistration } from './project-registration.js';
import { Security } from './security.js';
import { startServer } from './server.js';

export async function within(work: Promise<void>, milliseconds: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export async function createServerRuntime(
  config: ServerConfig,
  options: {
    commands?: ReadonlyMap<string, CommandController>;
    definitions?: ReadonlyMap<string, JobDefinition>;
    shutdownMs?: number;
    catalogFile?: string;
  } = {},
) {
  const shutdownMs = options.shutdownMs ?? 5000;
  if (!Number.isSafeInteger(shutdownMs) || shutdownMs < 1 || shutdownMs > 60_000)
    throw new Error('Invalid shutdown deadline.');
  const security = new Security(config.dataDir);
  await security.initialize();
  const ownership = new Ownership();
  const lease = await FileLease.acquire(
    path.join(config.dataDir, 'server.lock'),
    'server',
    ownership.serverId,
  );
  const registration = new ProjectRegistration(config.dataDir);
  const projects = registration.registry;
  let jobs: JobRegistry;
  const broker = new EventBroker(config.dataDir, (actor) => jobs.list(actor));
  jobs = new JobRegistry(config.dataDir, options.definitions ?? new Map(), broker.append);
  const repository = new DiskProjects(projects, ownership, broker);
  const catalogs = new FixtureCatalog(options.catalogFile);
  const projectApi = new ProjectApi(repository, catalogs);
  const workflowApi = new WorkflowApi(config, repository, catalogs);
  let state: 'running' | 'draining' | 'closed' | 'uncertain' = 'running';
  let closing: Promise<void> | undefined;
  let runtime: Awaited<ReturnType<typeof startServer>>;
  try {
    await registration.initialize();
    await broker.initialize();
    await jobs.initialize();
    await repository.initialize();
    runtime = await startServer(config, {
      ...security.http(),
      staticRoute: webStatic(config.webDir),
      commands: options.commands,
      accepting: () => state === 'running',
      route: async (context) => {
        if (
          context.url.pathname === '/api/v1/admin/shutdown' &&
          context.request.method === 'POST'
        ) {
          if (!context.actor.permissions.includes('admin')) throw new HttpFailure(403, 'FORBIDDEN');
          fields(context.input, ['mode']);
          const mode = context.input.mode;
          if (mode !== 'drain' && mode !== 'stop' && mode !== 'force')
            throw new HttpFailure(400, 'INVALID_INPUT');
          context.response.once('finish', () => {
            void close(mode).catch(() => {
              console.error('Server shutdown requires reconciliation.');
            });
          });
          json(context.response, 202, { state: 'draining' });
          return true;
        }
        if (await registration.route(context)) return true;
        if (await workflowApi.route(context)) return true;
        if (await projectApi.route(context)) return true;
        return jobs.route(context);
      },
    });
  } catch (error) {
    await repository.close();
    await lease.release();
    throw error;
  }
  security.setOrigin(runtime.origin);
  const events = attachEvents(runtime.server, config, security, broker, () => state === 'running');
  function close(mode: 'drain' | 'stop' | 'force' = 'drain'): Promise<void> {
    if (closing) return closing;
    state = 'draining';
    jobs.stopAccepting();
    closing = (async () => {
      try {
        if (mode === 'stop') jobs.requestStopAll();
        if (mode === 'force' || !(await within(jobs.drain(), shutdownMs))) {
          if (!(await within(jobs.forceUncertain(), shutdownMs)))
            throw new Error('Runtime interrupt deadline exceeded.');
        }
        await broker.drain();
        await events.close();
        const httpClosed = runtime.close();
        if (
          !(await within(
            Promise.all([httpClosed, runtime.drainRequests()]).then(() => {}),
            shutdownMs,
          ))
        ) {
          runtime.server.closeAllConnections();
          await httpClosed;
          throw new Error('HTTP work deadline exceeded; ownership requires reconciliation.');
        }
        await repository.close();
        await lease.release();
        state = 'closed';
      } catch (error) {
        state = 'uncertain';
        await events.close();
        runtime.server.closeAllConnections();
        await runtime.close();
        // Keep ownership if durable shutdown or external finalization cannot be established.
        throw error;
      }
    })();
    return closing;
  }
  return {
    ...runtime,
    close,
    jobs,
    broker,
    ownership,
    projects,
    registration,
    repository,
    projectApi,
    workflowApi,
    security,
    state: () => state,
  };
}
