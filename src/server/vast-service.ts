import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ActorContext } from '../domain/contracts.js';
import type { VastAiOfferSearchInput, VastAiRentRequest } from '../domain/integration-types.js';
import { VastAiInstanceNotFoundError } from '../domain/vast-instance-errors.js';
import { normalizeRentRequest } from '../domain/vast-offer-policy.js';
import type {
  ExternalDefinition,
  ExternalFacts,
  ExternalOperation,
} from './external-operations.js';
import {
  fields,
  HttpFailure,
  identifier,
  type JsonObject,
  json,
  object,
  type RequestContext,
} from './http.js';
import { IntegrationSettings } from './integration-settings.js';
import { atomicJson, SerialQueue } from './storage.js';
import { vastId, WebVastClient } from './vast-client.js';

const operations = [
  'rent-instance',
  'start-instance',
  'stop-instance',
  'reboot-instance',
  'delete-instance',
] as const;
type Operation = (typeof operations)[number];
type Target = {
  id: string;
  userId: string;
  operation: Operation;
  sourceFingerprint: string;
  instanceId: number | null;
  rent: VastAiRentRequest | null;
};
function admin(actor: ActorContext) {
  if (!actor.permissions.includes('admin')) throw new HttpFailure(403, 'FORBIDDEN');
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function target(raw: unknown): Target {
  const value = object(raw);
  fields(value, ['id', 'userId', 'operation', 'sourceFingerprint', 'instanceId', 'rent']);
  if (
    !operations.includes(value.operation as Operation) ||
    typeof value.sourceFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.sourceFingerprint)
  )
    throw new HttpFailure(400, 'INVALID_INPUT');
  const operation = value.operation as Operation;
  let rent: VastAiRentRequest | null = null,
    instanceId: number | null = null;
  if (operation === 'rent-instance') {
    const input = object(value.rent);
    fields(input, ['offerId', 'storageGb', 'templateHashId']);
    vastId(input.offerId);
    if (
      typeof input.storageGb !== 'number' ||
      !Number.isFinite(input.storageGb) ||
      input.storageGb <= 0 ||
      typeof input.templateHashId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,256}$/.test(input.templateHashId)
    )
      throw new HttpFailure(400, 'INVALID_INPUT');
    rent = normalizeRentRequest(input as unknown as VastAiRentRequest);
    if (value.instanceId !== null) throw new HttpFailure(400, 'INVALID_INPUT');
  } else {
    instanceId = vastId(value.instanceId);
    if (value.rent !== null) throw new HttpFailure(400, 'INVALID_INPUT');
  }
  return {
    id: identifier(value.id),
    userId: identifier(value.userId),
    operation,
    sourceFingerprint: value.sourceFingerprint,
    instanceId,
    rent,
  };
}
export class VastService {
  private readonly file: string;
  private readonly queue = new SerialQueue();
  private targets: Target[] = [];
  private initialized = false;
  constructor(
    dataDir: string,
    private readonly settings: IntegrationSettings,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.file = path.join(dataDir, 'vast.json');
  }
  async initialize() {
    let info;
    try {
      info = await lstat(this.file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.initialized = true;
        return;
      }
      throw new HttpFailure(503, 'VAST_STORE_UNAVAILABLE');
    }
    try {
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.size > 1024 * 1024 ||
        (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
      )
        throw new Error();
      const value = object(JSON.parse(await readFile(this.file, 'utf8')));
      fields(value, ['schema', 'targets']);
      if (
        value.schema !== 'web-vast/1' ||
        !Array.isArray(value.targets) ||
        value.targets.length > 1000
      )
        throw new Error();
      this.targets = value.targets.map(target);
      if (new Set(this.targets.map((t) => t.id)).size !== this.targets.length) throw new Error();
      this.initialized = true;
    } catch {
      throw new HttpFailure(503, 'VAST_STORE_UNAVAILABLE');
    }
  }
  private source() {
    if (!this.initialized) throw new HttpFailure(503, 'VAST_STORE_UNAVAILABLE');
    const source = this.settings.resolve('vast');
    return { ...source, client: new WebVastClient(source.secrets.apiKey, this.fetcher) };
  }
  private get(actor: ActorContext, id: string, operation?: Operation) {
    admin(actor);
    const value = this.targets.find((t) => t.id === identifier(id));
    if (!value || value.userId !== actor.userId) throw new HttpFailure(404, 'NOT_FOUND');
    if (operation && value.operation !== operation)
      throw new HttpFailure(409, 'TARGET_OPERATION_MISMATCH');
    const source = this.source();
    if (value.sourceFingerprint !== source.fingerprint)
      throw new HttpFailure(409, 'SETTINGS_CHANGED');
    return { value, source };
  }
  async createTarget(actor: ActorContext, raw: unknown) {
    admin(actor);
    const input = object(raw);
    fields(input, ['operation', 'instanceId', 'rent']);
    const source = this.source();
    const value = target({
      id: randomUUID(),
      userId: actor.userId,
      operation: input.operation,
      sourceFingerprint: source.fingerprint,
      instanceId: input.instanceId ?? null,
      rent: input.rent ?? null,
    });
    // Validate provider facts before committing immutable target. No external write here.
    if (value.rent) await source.client.offers.prepareRent(value.rent);
    else await source.client.instance(value.instanceId!);
    return this.queue.run(async () => {
      if (this.source().fingerprint !== source.fingerprint)
        throw new HttpFailure(409, 'SETTINGS_CHANGED');
      if (this.targets.length >= 1000) throw new HttpFailure(503, 'TARGET_CAPACITY');
      const next = [...this.targets, value];
      await atomicJson(this.file, { schema: 'web-vast/1', targets: next });
      this.targets = next;
      return { targetId: value.id, operation: value.operation };
    });
  }
  definitions(): Map<ExternalOperation, ExternalDefinition> {
    return new Map(
      operations.map((operation) => [
        operation,
        {
          scope: (id: string) => {
            const value = this.targets.find((t) => t.id === id);
            if (!value || value.operation !== operation) throw new HttpFailure(404, 'NOT_FOUND');
            return value.rent ? 'vast-rent-account' : 'vast-instance-' + value.instanceId;
          },
          inspect: (actor, id) => this.inspect(actor, id, operation),
          execute: (actor, id, receipt, facts) =>
            this.execute(actor, id, receipt, facts, operation),
          reconcile: (actor, _receipt, id, _facts) => this.reconcile(actor, id, operation),
        },
      ]),
    );
  }
  private async inspect(
    actor: ActorContext,
    id: string,
    operation: Operation,
  ): Promise<ExternalFacts> {
    const { value, source } = this.get(actor, id, operation);
    let summary: JsonObject;
    if (value.rent) {
      const facts = await source.client.offers.prepareRent(value.rent);
      if (facts.offer.hourlyCost === null || facts.offer.hourlyCost < 0)
        throw new HttpFailure(502, 'VAST_QUOTE_UNAVAILABLE');
      summary = {
        operation,
        offerId: facts.input.offerId,
        storageGb: facts.input.storageGb,
        templateHashId: facts.template.hashId,
        templateName: facts.template.name,
        hourlyCost: facts.offer.hourlyCost,
        storageCostPerGbMonth: facts.offer.storageCostPerGbMonth,
        machineId: facts.offer.machineId,
        gpuName: facts.offer.gpuName,
        gpuCount: facts.offer.gpuCount,
      };
    } else {
      const instance = await source.client.instance(value.instanceId!);
      if (
        (operation === 'start-instance' && instance.status !== 'stopped') ||
        ((operation === 'stop-instance' || operation === 'reboot-instance') &&
          instance.status !== 'running')
      )
        throw new HttpFailure(409, 'INSTANCE_STATE_CHANGED');
      summary = {
        operation,
        instanceId: instance.id,
        status: instance.status,
        label: instance.label,
        hourlyCost: instance.hourlyCost,
        sshHost: instance.sshHost,
        sshPort: instance.sshPort,
      };
    }
    if (this.source().fingerprint !== source.fingerprint)
      throw new HttpFailure(409, 'SETTINGS_CHANGED');
    return {
      revision: source.revision,
      fingerprint: hash({ source: source.fingerprint, summary }),
      summary,
    };
  }
  private async execute(
    actor: ActorContext,
    id: string,
    _receipt: string,
    facts: ExternalFacts,
    operation: Operation,
  ) {
    const current = await this.inspect(actor, id, operation);
    if (current.fingerprint !== facts.fingerprint) throw new HttpFailure(409, 'TARGET_CHANGED');
    const { value, source } = this.get(actor, id, operation);
    if (value.rent) {
      const instanceId = await source.client.offers.rent(value.rent);
      return { state: 'succeeded' as const, result: { instanceId } };
    }
    await source.client.action(value.instanceId!, operation as Exclude<Operation, 'rent-instance'>);
    return {
      state: 'succeeded' as const,
      result: { instanceId: value.instanceId, accepted: true },
    };
  }
  private async reconcile(actor: ActorContext, id: string, operation: Operation) {
    const { value, source } = this.get(actor, id, operation);
    if (value.rent || operation === 'reboot-instance') return { state: 'uncertain' as const };
    try {
      const instance = await source.client.instance(value.instanceId!);
      if (
        (operation === 'start-instance' && instance.status === 'running') ||
        (operation === 'stop-instance' && instance.status === 'stopped')
      )
        return {
          state: 'succeeded' as const,
          result: { instanceId: instance.id, observedState: instance.status },
        };
    } catch (error) {
      if (error instanceof VastAiInstanceNotFoundError && operation === 'delete-instance')
        return {
          state: 'succeeded' as const,
          result: { instanceId: value.instanceId, absent: true },
        };
      throw error;
    }
    return { state: 'uncertain' as const };
  }
  async route(context: RequestContext): Promise<boolean> {
    const base = '/api/v1/integrations/vast';
    if (!context.url.pathname.startsWith(base + '/')) return false;
    const { actor, input, url, request, response } = context;
    if (!actor.permissions.includes('read')) throw new HttpFailure(403, 'FORBIDDEN');
    const suffix = url.pathname.slice(base.length);
    if (url.searchParams.size) throw new HttpFailure(400, 'INVALID_INPUT');
    if (request.method === 'GET' && suffix === '/status') {
      json(response, 200, {
        state: this.settings.providerState('vast'),
        canManage: actor.permissions.includes('admin'),
      });
      return true;
    }
    if (request.method === 'GET' && suffix === '/instances') {
      json(response, 200, { instances: await this.source().client.instances() });
      return true;
    }
    if (request.method === 'GET' && suffix === '/template') {
      json(response, 200, { template: await this.source().client.offers.template() });
      return true;
    }
    if (request.method === 'POST' && suffix === '/search') {
      fields(input, ['storageGb', 'minTflops', 'gpuCount', 'minReliability', 'excludedCountries']);
      json(
        response,
        200,
        await this.source().client.offers.search(input as unknown as VastAiOfferSearchInput),
      );
      return true;
    }
    if (request.method === 'POST' && suffix === '/targets') {
      json(response, 201, await this.createTarget(actor, input));
      return true;
    }
    throw new HttpFailure(404, 'NOT_FOUND');
  }
  drain() {
    return this.queue.drain();
  }
}
