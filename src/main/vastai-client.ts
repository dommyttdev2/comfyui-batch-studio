import type {
  CloudInstanceStatus,
  VastAiComfyUiTemplate,
  VastAiInstance,
  VastAiOffer,
  VastAiOfferSearchInput,
  VastAiOfferSearchResult,
  VastAiRentRequest,
} from '../shared/types.js';
import { normalizeOpenSshPublicKey } from './ssh-key-pair.js';

const DEFAULT_BASE_URL = 'https://console.vast.ai';
const REQUEST_TIMEOUT_MS = 20_000;
const LIFECYCLE_TIMEOUT_MS = 15 * 60_000;
const LIFECYCLE_POLL_MS = 5_000;
const WEB_DEFAULT_MIN_DURATION_SECONDS = 7 * 24 * 60 * 60;
const PENDING_CREATION_TTL_MS = 10 * 60_000;
type PendingInstanceAction = 'start' | 'stop' | 'reboot';

type JsonRecord = Record<string, unknown>;
type FetchLike = typeof fetch;
interface VastRequestInit {
  method?: 'GET' | 'PUT' | 'POST' | 'DELETE';
  body?: string;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
}
function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function numberValue(value: unknown) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
function integerValue(value: unknown) {
  const n = numberValue(value);
  return n != null && Number.isInteger(n) ? n : null;
}
function rawStatusOf(payload: JsonRecord) {
  return (
    String(payload.actual_status ?? payload.status ?? 'unknown')
      .trim()
      .toLowerCase() || 'unknown'
  );
}
function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function arrayValue(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}
function objectValue(value: unknown): JsonRecord {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as JsonRecord;
  if (typeof value === 'string' && value.trim()) {
    try {
      return record(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return {};
}
function normalizedCountryCodes(values: unknown) {
  if (!Array.isArray(values)) return [] as string[];
  const result: string[] = [];
  for (const value of values) {
    const code = String(value ?? '')
      .trim()
      .toUpperCase();
    if (!code) continue;
    if (!/^[A-Z]{2}$/.test(code))
      throw new Error(`除外地域は2文字の国コードで指定してください: ${code}`);
    if (!result.includes(code)) result.push(code);
  }
  return result;
}
function sshKeyItems(payload: unknown): unknown[] {
  const direct = arrayValue(payload);
  if (direct) return direct;
  const item = record(payload);
  for (const key of ['ssh_keys', 'keys', 'results']) {
    const rows = arrayValue(item[key]);
    if (rows) return rows;
  }
  if (stringValue(item.ssh_key) ?? stringValue(item.public_key) ?? stringValue(item.key))
    return [item];
  return Object.values(item).filter((value) => {
    const row = record(value);
    return Boolean(stringValue(row.ssh_key) ?? stringValue(row.public_key) ?? stringValue(row.key));
  });
}
function sshKeyValue(value: unknown) {
  const row = record(value);
  return stringValue(row.ssh_key) ?? stringValue(row.public_key) ?? stringValue(row.key);
}
function containsSshKey(items: unknown[], publicKey: string) {
  return items.some((item) => {
    const value = sshKeyValue(item);
    if (!value) return false;
    try {
      return normalizeOpenSshPublicKey(value) === publicKey;
    } catch {
      return false;
    }
  });
}

export function normalizeVastStatus(payload: unknown): CloudInstanceStatus {
  const item = record(payload),
    raw = rawStatusOf(item),
    intended = String(item.intended_status ?? '').toLowerCase(),
    cur = String(item.cur_state ?? '').toLowerCase(),
    next = String(item.next_state ?? '').toLowerCase(),
    message = String(item.status_msg ?? '')
      .trim()
      .toLowerCase();
  if (raw === 'scheduling') return 'scheduling';
  const runningLike = raw === 'running';
  const stoppingByIntent = runningLike && (intended === 'stopped' || next === 'stopped');
  const stoppingByMessage =
    runningLike &&
    /(^|[ ,:;])stopp(?:ed|ing)([ ,:;]|$)/.test(message) &&
    intended !== 'running' &&
    next !== 'running';
  if (stoppingByIntent || stoppingByMessage) return 'stopping';
  if (raw === 'running') return 'running';
  const stoppedLike = raw === 'stopped' || raw === 'exited';
  const schedulingByIntent = stoppedLike && (intended === 'running' || next === 'running');
  const schedulingByMessage =
    stoppedLike && /(^|[ ,:;])running([ ,:;]|$)/.test(message) && next !== 'stopped';
  if (schedulingByIntent || schedulingByMessage) return 'scheduling';
  if (raw === 'stopped' || (raw === 'exited' && intended === 'stopped' && cur === 'stopped'))
    return 'stopped';
  if (['loading', 'starting', 'rebooting', 'restarting', 'creating', 'connecting'].includes(raw))
    return 'starting';
  if (['stopping', 'destroying'].includes(raw)) return 'stopping';
  if (['offline', 'unavailable'].includes(raw)) return 'offline';
  if (['error', 'failed', 'failure'].includes(raw)) return 'error';
  return 'unknown';
}

function mappedTcpEndpoint(payload: JsonRecord, internalPort: number) {
  const ports = record(payload.ports),
    mappings = ports[`${internalPort}/tcp`];
  if (!Array.isArray(mappings)) return null;
  const publicHost = stringValue(payload.public_ipaddr);
  for (const candidate of mappings) {
    const mapping = record(candidate),
      host = publicHost ?? stringValue(mapping.HostIp),
      port = integerValue(mapping.HostPort);
    if (host && host !== '0.0.0.0' && host !== '::' && port && port > 0)
      return { host, port, internalPort };
  }
  return null;
}
function normalizeComfyUiTemplate(payload: unknown): VastAiComfyUiTemplate {
  const item = record(payload),
    hashId = stringValue(item.hash_id),
    name = stringValue(item.name);
  if (!hashId || !name) throw new Error('Vast.ai ComfyUI Template応答が不正です。');
  return {
    id: integerValue(item.id),
    hashId,
    name,
    recommendedDiskSpaceGb: numberValue(item.recommended_disk_space) ?? 8,
    countCreated: integerValue(item.count_created),
    extraFilters: objectValue(item.extra_filters),
  };
}
export function normalizeVastOffer(payload: unknown): VastAiOffer {
  const item = record(payload),
    id = integerValue(item.id) ?? integerValue(item.ask_contract_id);
  if (id == null || id < 1) throw new Error('Vast.ai Offer応答に有効なIDがありません。');
  return {
    id,
    gpuName: stringValue(item.gpu_name),
    gpuCount: integerValue(item.num_gpus),
    gpuRamMb: numberValue(item.gpu_ram),
    gpuTotalRamMb: numberValue(item.gpu_total_ram),
    totalFlops: numberValue(item.total_flops),
    gpuMemBandwidthGbps: numberValue(item.gpu_mem_bw),
    verification: stringValue(item.verification),
    geolocation: stringValue(item.geolocation),
    machineId: integerValue(item.machine_id),
    hostId: integerValue(item.host_id),
    motherboard: stringValue(item.mobo_name),
    pciGen: numberValue(item.pci_gen),
    gpuLanes: integerValue(item.gpu_lanes),
    pcieBandwidthGbps: numberValue(item.pcie_bw),
    cpuName: stringValue(item.cpu_name),
    cpuCores: integerValue(item.cpu_cores),
    cpuCoresEffective: numberValue(item.cpu_cores_effective),
    cpuRamMb: numberValue(item.cpu_ram),
    diskName: stringValue(item.disk_name),
    diskBandwidthMb: numberValue(item.disk_bw),
    diskSpaceGb: numberValue(item.disk_space),
    internetDownMb: numberValue(item.inet_down),
    internetUpMb: numberValue(item.inet_up),
    directPortCount: integerValue(item.direct_port_count),
    dlperf: numberValue(item.dlperf),
    cudaMaxGood: numberValue(item.cuda_max_good),
    durationSeconds: numberValue(item.duration),
    reliability: numberValue(item.reliability),
    dlperfPerDollar: numberValue(item.dlperf_per_dphtotal),
    flopsPerDollar: numberValue(item.flops_per_dphtotal),
    hourlyCost: numberValue(item.dph_total),
    storageCostPerGbMonth: numberValue(item.storage_cost),
    internetDownCostPerTb: numberValue(item.internet_down_cost_per_tb),
    internetUpCostPerTb: numberValue(item.internet_up_cost_per_tb),
  };
}
function publicSshEndpoint(payload: JsonRecord) {
  return mappedTcpEndpoint(payload, 22);
}
export function resolveVastComfyUiPort(payload: unknown) {
  const ports = record(record(payload).ports);
  for (const internalPort of [18188, 8188]) {
    const mappings = ports[`${internalPort}/tcp`];
    if (
      Array.isArray(mappings) &&
      mappings.some((candidate) => {
        const port = integerValue(record(candidate).HostPort);
        return port != null && port > 0;
      })
    )
      return internalPort;
  }
  return null;
}

export function normalizeVastInstance(payload: unknown): VastAiInstance {
  const item = record(payload),
    id = integerValue(item.id);
  if (id == null || id < 1) throw new Error('Vast.ai Instance応答に有効なIDがありません。');
  const status = normalizeVastStatus(item),
    mapped = status === 'running' ? publicSshEndpoint(item) : null;
  const sshHost =
      status === 'running'
        ? (mapped?.host ?? stringValue(item.ssh_host) ?? stringValue(item.public_ipaddr))
        : null,
    sshPort = status === 'running' ? (mapped?.port ?? integerValue(item.ssh_port) ?? null) : null,
    comfyUiPort = status === 'running' ? resolveVastComfyUiPort(item) : null;
  return {
    provider: 'vastai',
    id,
    label: stringValue(item.label),
    status,
    rawStatus: rawStatusOf(item),
    intendedStatus: stringValue(item.intended_status),
    curState: stringValue(item.cur_state),
    nextState: stringValue(item.next_state),
    statusMessage: stringValue(item.status_msg),
    gpuName: stringValue(item.gpu_name),
    gpuCount: integerValue(item.num_gpus),
    gpuRamMb: integerValue(item.gpu_ram) ?? integerValue(item.gpu_totalram),
    hourlyCost: numberValue(item.dph_total),
    sshHost,
    sshPort,
    comfyUiPort,
  };
}

function messageFromPayload(payload: unknown) {
  const item = record(payload);
  return stringValue(item.msg) ?? stringValue(item.error) ?? stringValue(item.detail);
}

export class VastAiInstanceNotFoundError extends Error {
  constructor(public readonly instanceId: number) {
    super(`Vast.ai Instance ${instanceId} が見つかりません。`);
    this.name = 'VastAiInstanceNotFoundError';
  }
}

export class VastAiClient {
  private readonly pendingInstanceActions = new Map<
    number,
    { action: PendingInstanceAction; requestedAt: number }
  >();
  private readonly pendingCreatedInstances = new Map<
    number,
    { createdAt: number; offer: VastAiOffer }
  >();
  constructor(
    private readonly apiKeyProvider: () => Promise<string>,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly baseUrl = DEFAULT_BASE_URL,
  ) {}
  private pendingCreatedPlaceholder(id: number, offer: VastAiOffer): VastAiInstance {
    return {
      provider: 'vastai',
      id,
      label: 'ComfyUI Batch Studio',
      status: 'starting',
      rawStatus: 'creating',
      intendedStatus: 'running',
      curState: null,
      nextState: null,
      statusMessage: 'RENT完了。Vast.aiのInstance一覧への反映を待っています。',
      gpuName: offer.gpuName,
      gpuCount: offer.gpuCount,
      gpuRamMb: offer.gpuRamMb,
      hourlyCost: offer.hourlyCost,
      sshHost: null,
      sshPort: null,
      comfyUiPort: null,
    };
  }
  private withPendingCreation(instance: VastAiInstance) {
    const pending = this.pendingCreatedInstances.get(instance.id);
    if (!pending) return instance;
    if (
      instance.status === 'running' ||
      instance.status === 'stopped' ||
      instance.status === 'error' ||
      instance.status === 'offline'
    ) {
      this.pendingCreatedInstances.delete(instance.id);
      return instance;
    }
    if (instance.status === 'unknown')
      return {
        ...instance,
        status: 'starting' as const,
        rawStatus: instance.rawStatus === 'unknown' ? 'creating' : instance.rawStatus,
        statusMessage: instance.statusMessage ?? 'RENT完了。Vast.aiでInstanceを作成中です。',
      };
    return instance;
  }
  private withPendingAction(instance: VastAiInstance) {
    const pending = this.pendingInstanceActions.get(instance.id);
    if (!pending) return instance;
    if (instance.status === 'error' || instance.status === 'offline') {
      this.pendingInstanceActions.delete(instance.id);
      return instance;
    }
    if (pending.action === 'start') {
      if (instance.status === 'running') {
        this.pendingInstanceActions.delete(instance.id);
        return instance;
      }
      if (instance.status === 'stopped' || instance.status === 'unknown') {
        return {
          ...instance,
          status: 'scheduling' as const,
          statusMessage:
            instance.statusMessage ??
            '起動要求を送信済み。Vast.aiでGPU割り当て待ちの可能性があります。',
        };
      }
      return instance;
    }
    if (pending.action === 'stop') {
      if (instance.status === 'stopped') {
        this.pendingInstanceActions.delete(instance.id);
        return instance;
      }
      if (
        instance.status === 'running' ||
        instance.status === 'starting' ||
        instance.status === 'scheduling' ||
        instance.status === 'unknown'
      ) {
        return {
          ...instance,
          status: 'stopping' as const,
          statusMessage: instance.statusMessage ?? '停止要求を送信済みです。',
        };
      }
      return instance;
    }
    if (instance.status === 'starting' || instance.rawStatus === 'rebooting') {
      return instance;
    }
    if (instance.status === 'running') {
      return {
        ...instance,
        status: 'starting' as const,
        statusMessage: instance.statusMessage ?? '再起動要求を送信済みです。',
      };
    }
    return instance;
  }
  private async request(endpoint: string, init: VastRequestInit = {}): Promise<unknown> {
    const apiKey = (await this.apiKeyProvider()).trim();
    if (!apiKey) throw new Error('VASTAI_API_KEYが設定されていません。');
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${endpoint}`, {
        method: init.method ?? 'GET',
        body: init.body,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
      });
      const raw = await response.text();
      let payload: unknown = {};
      if (raw) {
        try {
          payload = JSON.parse(raw);
        } catch {
          payload = { msg: raw };
        }
      }
      if (!response.ok)
        throw new Error(
          `Vast.ai API ${response.status}: ${messageFromPayload(payload) ?? response.statusText}`,
        );
      return payload;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError')
        throw new Error('Vast.ai APIへの接続がタイムアウトしました。');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  async testConnection() {
    await this.request('/api/v1/instances/?limit=1');
  }
  private async resolveComfyUiTemplate(hashId?: string): Promise<VastAiComfyUiTemplate> {
    const filters: JsonRecord = {
      name: { eq: 'ComfyUI' },
      recommended: { eq: true },
      use_ssh: { eq: true },
      ssh_direct: { eq: true },
    };
    if (hashId) filters.hash_id = { eq: hashId };
    const params = new URLSearchParams({ select_filters: JSON.stringify(filters) }),
      payload = record(await this.request(`/api/v0/template/?${params.toString()}`));
    const rows = Array.isArray(payload.templates) ? payload.templates : [];
    if (rows.length === 0)
      throw new Error(
        hashId
          ? '指定したVast.ai ComfyUI Templateが利用できません。'
          : 'Vast.aiの推奨ComfyUI Template（SSH Direct対応）が見つかりません。',
      );
    const templates = rows
      .map(normalizeComfyUiTemplate)
      .sort(
        (a, b) =>
          (b.countCreated ?? 0) - (a.countCreated ?? 0) ||
          b.recommendedDiskSpaceGb - a.recommendedDiskSpaceGb,
      );
    return templates[0];
  }
  async comfyUiTemplate() {
    return this.resolveComfyUiTemplate();
  }
  async comfyUiTemplateByHash(hashId: string) {
    return this.resolveComfyUiTemplate(hashId);
  }
  private normalizeOfferSearchInput(
    input: VastAiOfferSearchInput,
    template: VastAiComfyUiTemplate,
  ) {
    const storageGb = numberValue(input?.storageGb),
      minTflops = numberValue(input?.minTflops),
      gpuCount = integerValue(input?.gpuCount),
      minReliability = numberValue(input?.minReliability),
      excludedCountries = normalizedCountryCodes(input?.excludedCountries);
    if (storageGb == null || storageGb <= 0)
      throw new Error('Storageは0より大きいGB値を指定してください。');
    if (storageGb < template.recommendedDiskSpaceGb)
      throw new Error(
        `ComfyUI Templateの推奨Storageは ${template.recommendedDiskSpaceGb} GB以上です。`,
      );
    if (minTflops == null || minTflops < 0)
      throw new Error('Minimum TFLOPsは0以上で指定してください。');
    if (gpuCount == null || gpuCount < 1 || gpuCount > 64)
      throw new Error('GPU Countは1〜64の整数で指定してください。');
    if (minReliability == null || minReliability < 0 || minReliability > 100)
      throw new Error('Reliabilityは0〜100%で指定してください。');
    return { storageGb, minTflops, gpuCount, minReliability, excludedCountries };
  }
  async searchOffers(input: VastAiOfferSearchInput): Promise<VastAiOfferSearchResult> {
    const template = await this.resolveComfyUiTemplate(),
      search = this.normalizeOfferSearchInput(input, template);
    const body: JsonRecord = {
      ...template.extraFilters,
      limit: 100,
      type: 'on-demand',
      verified: { eq: true },
      rentable: { eq: true },
      rented: { eq: false },
      duration: { gte: WEB_DEFAULT_MIN_DURATION_SECONDS },
      allocated_storage: search.storageGb,
      num_gpus: { eq: search.gpuCount },
      reliability: { gte: search.minReliability / 100 },
      order: [['dph_total', 'asc']],
    };
    if (search.minTflops > 0) body.total_flops = { gte: search.minTflops };
    if (search.excludedCountries.length > 0) body.geolocation = { notin: search.excludedCountries };
    const payload = record(
        await this.request('/api/v0/bundles', { method: 'POST', body: JSON.stringify(body) }),
      ),
      rows = Array.isArray(payload.offers) ? payload.offers : [];
    const offers = rows
      .map(normalizeVastOffer)
      .sort(
        (a, b) =>
          (a.hourlyCost ?? Number.POSITIVE_INFINITY) - (b.hourlyCost ?? Number.POSITIVE_INFINITY) ||
          a.id - b.id,
      );
    return { template, offers };
  }
  async getOffer(offerId: number, storageGb: number) {
    if (!Number.isInteger(offerId) || offerId < 1) throw new Error('Vast.ai Offer IDが不正です。');
    if (!Number.isFinite(storageGb) || storageGb <= 0) throw new Error('Storageが不正です。');
    const body = {
      limit: 1,
      type: 'on-demand',
      rentable: { eq: true },
      rented: { eq: false },
      id: { eq: offerId },
      allocated_storage: storageGb,
    };
    const payload = record(
        await this.request('/api/v0/bundles', { method: 'POST', body: JSON.stringify(body) }),
      ),
      rows = Array.isArray(payload.offers) ? payload.offers : [];
    if (rows.length === 0)
      throw new Error(
        `Vast.ai Offer #${offerId} は現在RENTできません。検索結果を更新してください。`,
      );
    return normalizeVastOffer(rows[0]);
  }
  async rentOffer(input: VastAiRentRequest, validatedOffer?: VastAiOffer) {
    const offerId = integerValue(input?.offerId),
      storageGb = numberValue(input?.storageGb),
      templateHashId = stringValue(input?.templateHashId);
    if (offerId == null || offerId < 1) throw new Error('Vast.ai Offer IDが不正です。');
    if (storageGb == null || storageGb <= 0) throw new Error('Storageが不正です。');
    if (!templateHashId) throw new Error('ComfyUI Template IDがありません。');
    const template = await this.resolveComfyUiTemplate(templateHashId);
    if (storageGb < template.recommendedDiskSpaceGb)
      throw new Error(
        `ComfyUI Templateの推奨Storageは ${template.recommendedDiskSpaceGb} GB以上です。`,
      );
    const offer = validatedOffer ?? (await this.getOffer(offerId, storageGb));
    let payload: JsonRecord;
    try {
      payload = record(
        await this.request(`/api/v0/asks/${offerId}/`, {
          method: 'PUT',
          body: JSON.stringify({
            template_hash_id: template.hashId,
            disk: storageGb,
            target_state: 'running',
            label: 'ComfyUI Batch Studio',
          }),
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/Vast\.ai API (404|410):|no_such_ask/i.test(message))
        throw new Error(
          `Vast.ai Offer #${offerId} は現在RENTできません。検索結果を更新してください。`,
        );
      throw error;
    }
    const instanceId = integerValue(payload.new_contract);
    if (payload.success === false || instanceId == null || instanceId < 1)
      throw new Error(messageFromPayload(payload) ?? 'Vast.ai Instanceを作成できませんでした。');
    this.pendingCreatedInstances.set(instanceId, { createdAt: Date.now(), offer });
    return instanceId;
  }
  async listInstances(): Promise<VastAiInstance[]> {
    const instances: VastAiInstance[] = [];
    let token: string | null = null,
      pages = 0;
    do {
      const params = new URLSearchParams({ limit: '25' });
      if (token) params.set('after_token', token);
      const payload = record(await this.request(`/api/v1/instances/?${params.toString()}`)),
        items = payload.instances;
      if (!Array.isArray(items)) throw new Error('Vast.ai Instance一覧応答が不正です。');
      for (const item of items)
        instances.push(
          this.withPendingCreation(this.withPendingAction(normalizeVastInstance(item))),
        );
      token = stringValue(payload.next_token);
      pages += 1;
      if (pages > 100) throw new Error('Vast.ai Instance一覧のページングが終了しません。');
    } while (token);
    const visibleIds = new Set(instances.map((instance) => instance.id)),
      now = Date.now();
    for (const [id, pending] of this.pendingCreatedInstances) {
      if (visibleIds.has(id)) {
        this.pendingCreatedInstances.delete(id);
        continue;
      }
      if (now - pending.createdAt > PENDING_CREATION_TTL_MS) {
        this.pendingCreatedInstances.delete(id);
        continue;
      }
      instances.push(this.pendingCreatedPlaceholder(id, pending.offer));
    }
    return instances.sort(
      (a, b) => Number(b.status === 'running') - Number(a.status === 'running') || b.id - a.id,
    );
  }
  async listSshKeys() {
    return sshKeyItems(await this.request('/api/v0/ssh/'));
  }
  async listInstanceSshKeys(instanceId: number) {
    if (!Number.isInteger(instanceId) || instanceId < 1)
      throw new Error('Vast.ai Instance IDが不正です。');
    return sshKeyItems(await this.request(`/api/v0/instances/${instanceId}/ssh/`));
  }
  async ensureSshAccess(instanceId: number, publicKeyValue: string) {
    if (!Number.isInteger(instanceId) || instanceId < 1)
      throw new Error('Vast.ai Instance IDが不正です。');
    const publicKey = normalizeOpenSshPublicKey(publicKeyValue),
      accountKeys = await this.listSshKeys();
    const accountAlreadyRegistered = containsSshKey(accountKeys, publicKey);
    if (!accountAlreadyRegistered)
      await this.request('/api/v0/ssh/', {
        method: 'POST',
        body: JSON.stringify({ ssh_key: publicKey }),
      });
    const instanceKeys = await this.listInstanceSshKeys(instanceId),
      instanceAlreadyAttached = containsSshKey(instanceKeys, publicKey);
    if (!instanceAlreadyAttached)
      await this.request(`/api/v0/instances/${instanceId}/ssh/`, {
        method: 'POST',
        body: JSON.stringify({ ssh_key: publicKey }),
      });
    return { accountAlreadyRegistered, instanceAlreadyAttached, instanceAttached: true };
  }
  async getInstance(id: number) {
    if (!Number.isInteger(id) || id < 1) throw new Error('Vast.ai Instance IDが不正です。');
    let payload: JsonRecord;
    try {
      payload = record(await this.request(`/api/v0/instances/${id}/`));
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Vast.ai API 404:'))
        throw new VastAiInstanceNotFoundError(id);
      throw error;
    }
    const raw = payload.instances ?? payload,
      item = record(raw),
      responseId = integerValue(item.id);
    if (responseId == null) throw new VastAiInstanceNotFoundError(id);
    if (responseId !== id)
      throw new Error(
        `Vast.ai Instance応答のIDが一致しません。requested=${id}, actual=${responseId}`,
      );
    return this.withPendingCreation(this.withPendingAction(normalizeVastInstance(item)));
  }
  private async setState(id: number, state: 'running' | 'stopped') {
    if (!Number.isInteger(id) || id < 1) throw new Error('Vast.ai Instance IDが不正です。');
    await this.request(`/api/v0/instances/${id}/`, {
      method: 'PUT',
      body: JSON.stringify({ state }),
    });
  }
  async requestStartInstance(id: number) {
    await this.setState(id, 'running');
    this.pendingInstanceActions.set(id, { action: 'start', requestedAt: Date.now() });
  }
  async requestStopInstance(id: number) {
    await this.setState(id, 'stopped');
    this.pendingInstanceActions.set(id, { action: 'stop', requestedAt: Date.now() });
  }
  async requestRebootInstance(id: number) {
    if (!Number.isInteger(id) || id < 1) throw new Error('Vast.ai Instance IDが不正です。');
    await this.request(`/api/v0/instances/reboot/${id}/`, { method: 'PUT' });
    this.pendingInstanceActions.set(id, { action: 'reboot', requestedAt: Date.now() });
  }
  async destroyInstance(id: number) {
    if (!Number.isInteger(id) || id < 1) throw new Error('Vast.ai Instance IDが不正です。');
    await this.request(`/api/v0/instances/${id}/`, { method: 'DELETE' });
    this.pendingInstanceActions.delete(id);
  }
  private async waitForStatus(
    id: number,
    target: 'running' | 'stopped',
    timeoutMs = LIFECYCLE_TIMEOUT_MS,
  ) {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const current = await this.getInstance(id);
      if (current.status === target) return current;
      if (current.status === 'error' || current.status === 'offline')
        throw new Error(
          `Vast.ai Instance ${id} が ${current.status} 状態になりました: ${current.statusMessage ?? current.rawStatus}`,
        );
      if (Date.now() >= deadline)
        throw new Error(
          `Vast.ai Instance ${id} が ${target} 状態になるまでの待機がタイムアウトしました。`,
        );
      await delay(LIFECYCLE_POLL_MS);
    }
  }
  async startInstance(id: number) {
    await this.requestStartInstance(id);
    return this.waitForStatus(id, 'running');
  }
  async stopInstance(id: number) {
    await this.requestStopInstance(id);
    return this.waitForStatus(id, 'stopped');
  }
}
