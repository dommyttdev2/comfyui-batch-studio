import path from 'node:path';
import { AgentApi } from './agent-api.js';
import { AgentArtifacts } from './agent-artifacts.js';
import { loadAgentRegistration } from './agent-registration.js';
import { AgentRuntime, type AgentRuntimeOptions } from './agent-runtime.js';
import type { AgentRecord } from './agent-store.js';
import { CivitaiService } from './civitai-service.js';
import type { ServerConfig } from './config.js';
import { attachEvents, EventBroker } from './events.js';
import {
  type ExternalDefinition,
  type ExternalOperation,
  ExternalOperations,
} from './external-operations.js';
import { FileResources } from './file-resources.js';
import { type CommandController, fields, HttpFailure, json } from './http.js';
import { IntegrationSettings } from './integration-settings.js';
import { type JobDefinition, JobRegistry } from './jobs.js';
import { FileLease, Ownership } from './ownership.js';
import { ProjectApi } from './project-api.js';
import { ProjectRegistration } from './project-registration.js';
import { DiskProjects } from './project-repository.js';
import { ProjectResources } from './project-resources.js';
import { R2ObjectTransfers } from './r2-object-transfers.js';
import { R2Service } from './r2-service.js';
import { R2Transfers } from './r2-transfers.js';
import { Security } from './security.js';
import { startServer } from './server.js';
import { SshResources } from './ssh-resources.js';
import { Staging } from './staging.js';
import { VastService } from './vast-service.js';
import { webStatic } from './web-static.js';
import { FixtureCatalog, WorkflowApi } from './workflow-api.js';

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
    agents?: AgentRuntimeOptions;
  } = {},
) {
  if (
    options.definitions?.has('agent') ||
    options.definitions?.has('civitai-sync') ||
    options.definitions?.has('r2-index') ||
    options.definitions?.has('r2-transfer') ||
    options.definitions?.has('r2-object-copy')
  )
    throw new Error('Agent definition is reserved.');
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
  const definitions = new Map(options.definitions ?? []);
  jobs = new JobRegistry(config.dataDir, definitions, broker.append);
  const repository = new DiskProjects(projects, ownership, broker);
  const staging = new Staging(config.dataDir);
  const files = new FileResources(config.dataDir);
  const integrations = new IntegrationSettings(config.dataDir);
  const civitai = new CivitaiService(config.dataDir, integrations, jobs, (actor) =>
    security.forJob(actor),
  );
  definitions.set('civitai-sync', civitai.definition);
  const catalogs =
    options.catalogFile !== undefined ? new FixtureCatalog(options.catalogFile) : civitai;
  const externalDefinitions = new Map<ExternalOperation, ExternalDefinition>();
  const vast = new VastService(config.dataDir, integrations);
  for (const [operation, definition] of vast.definitions())
    externalDefinitions.set(operation, definition);
  const ssh = new SshResources(config.dataDir, integrations);
  externalDefinitions.set('trust-ssh', ssh.definition);
  const r2 = new R2Service(config.dataDir, integrations, externalDefinitions);
  r2.attachIndexJobs(jobs, (actor) => security.forJob(actor));
  definitions.set('r2-index', r2.indexDefinition);
  const externalOperations = new ExternalOperations(
    config.dataDir,
    externalDefinitions,
    async (actor, binding) => {
      const project = await repository.transaction(binding.projectId, (tx) => tx.load());
      if (project.revision !== binding.expectedRevision)
        throw new HttpFailure(409, 'REVISION_CONFLICT');
      if (
        !project.lease ||
        project.lease.id !== binding.leaseId ||
        project.lease.userId !== actor.userId ||
        project.lease.sessionId !== actor.sessionId ||
        project.lease.expiresAt <= Date.now()
      )
        throw new HttpFailure(409, 'LEASE_REQUIRED');
    },
    async (actor) => ({ ...(await security.forJob(actor)), sessionId: actor.sessionId }),
  );
  const transfers = new R2Transfers(
    config.dataDir,
    integrations,
    jobs,
    externalOperations,
    staging,
    files,
    r2.port,
    () => r2.invalidateIndex(),
    (actor) => security.forJob(actor),
  );
  const objectTransfers = new R2ObjectTransfers(
    config.dataDir,
    integrations,
    jobs,
    r2.port,
    (actor) => security.forJob(actor),
  );
  r2.objectTransfers = objectTransfers;
  definitions.set('r2-object-copy', objectTransfers.definition);
  definitions.set('r2-transfer', transfers.definition);
  externalDefinitions.set('upload-object', transfers.externalDefinition);
  const projectApi = new ProjectApi(repository, catalogs);
  const workflowApi = new WorkflowApi(config, repository, catalogs);
  const projectResources = new ProjectResources(
    projectApi,
    workflowApi,
    catalogs,
    files,
    r2,
    integrations,
    (actor) => security.forJob(actor),
    ssh,
  );
  let agentOptions: AgentRuntimeOptions | undefined;
  try {
    agentOptions = options.agents ?? (await loadAgentRegistration(config.dataDir));
  } catch (error) {
    await lease.release();
    throw error;
  }
  const agents = new AgentRuntime(
    config.dataDir,
    repository,
    catalogs,
    jobs,
    agentOptions,
    (actor) => security.forJob(actor),
  );
  definitions.set('agent', agents.definition);
  const artifacts = agentOptions
    ? new AgentArtifacts(
        agents,
        projectApi.projects,
        agentOptions.directory,
        (actor) => security.forJob(actor),
        'outputGuard' in agentOptions
          ? (agentOptions.outputGuard as (r: AgentRecord, raw: string) => Promise<void>)
          : undefined,
      )
    : undefined;
  if (artifacts) {
    agents.captureArtifact = (actor, scope, job) => artifacts.capture(actor, scope, job);
    agents.importArtifact = (actor, scope, id) => artifacts.ingest(actor, scope, id);
    agents.reconcileArtifact = (job) => artifacts.reconcile(job);
  }
  const agentApi = new AgentApi(agents, artifacts);
  let state: 'running' | 'draining' | 'closed' | 'uncertain' = 'running';
  let closing: Promise<void> | undefined;
  let runtime: Awaited<ReturnType<typeof startServer>>;
  try {
    await staging.initialize();
    await files.initialize();
    await integrations.initialize();
    await externalOperations.initialize();
    await civitai.initialize();
    await r2.initialize();
    await transfers.initialize();
    await objectTransfers.initialize();
    await vast.initialize();
    await ssh.initialize();
    await registration.initialize();
    await broker.initialize();
    await jobs.initialize();
    await repository.initialize();
    await agents.initialize();
    runtime = await startServer(config, {
      ...security.http(),
      staticRoute: webStatic(config.webDir),
      commands: options.commands,
      binaryRoute: staging.binaryRoute,
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
        if (await files.route(context)) return true;
        if (await staging.route(context)) return true;
        if (await civitai.route(context)) return true;
        if (await transfers.route(context)) return true;
        if (await r2.route(context)) return true;
        if (await vast.route(context)) return true;
        if (await ssh.route(context)) return true;
        if (await externalOperations.route(context)) return true;
        if (await integrations.route(context)) return true;
        if (await registration.route(context)) return true;
        if (await projectResources.route(context)) return true;
        if (await workflowApi.route(context)) return true;
        if (await projectApi.route(context)) return true;
        if (await agentApi.route(context)) return true;
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
    externalOperations.stopAccepting();
    closing = (async () => {
      try {
        if (mode === 'stop') jobs.requestStopAll();
        if (mode === 'force' || !(await within(jobs.drain(), shutdownMs))) {
          if (!(await within(jobs.forceUncertain(), shutdownMs)))
            throw new Error('Runtime interrupt deadline exceeded.');
        }
        if (!(await within(externalOperations.drain(), shutdownMs))) {
          await externalOperations.forceUncertain();
          throw new Error('External operations remain uncertain; retain ownership.');
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
        await staging.drain();
        await integrations.drain();
        await civitai.drain();
        await transfers.drain();
        await objectTransfers.drain();
        await r2.drain();
        await vast.drain();
        await ssh.drain();
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
    externalOperations,
    externalDefinitions,
    agents,
    agentApi,
    artifacts,
    security,
    state: () => state,
  };
}
