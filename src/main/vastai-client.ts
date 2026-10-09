import {
  normalizeComfyUiTemplate,
  normalizeVastInstance,
  normalizeVastOffer,
  normalizeVastStatus,
} from '../domain/vast-observation-policy.js';

export {
  normalizeVastInstance,
  normalizeVastOffer,
  normalizeVastStatus,
  resolveVastComfyUiPort,
} from '../domain/vast-observation-policy.js';

import { VastOfferUseCases } from '../application/vast-offer-use-cases.js';
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

function messageFromPayload(payload: unknown) {
  const item = record(payload);
  return stringValue(item.msg) ?? stringValue(item.error) ?? stringValue(item.detail);
}

import { VastAiInstanceNotFoundError } from '../domain/vast-instance-errors.js';

export { VastAiInstanceNotFoundError } from '../domain/vast-instance-errors.js';

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
  offerUseCases() {
    return new VastOfferUseCases({
      templates: async (hashId) => {
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
        return rows.map(normalizeComfyUiTemplate);
      },
      offers: async (criteria) => {
        const payload = record(
          await this.request('/api/v0/bundles', { method: 'POST', body: JSON.stringify(criteria) }),
        );
        return (Array.isArray(payload.offers) ? payload.offers : []).map(normalizeVastOffer);
      },
      rent: async (offerId, templateHashId, storageGb) => {
        const template = { hashId: templateHashId };
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
          throw new Error(
            messageFromPayload(payload) ?? 'Vast.ai Instanceを作成できませんでした。',
          );
        return instanceId;
      },
      rememberCreated: (instanceId, offer) =>
        this.pendingCreatedInstances.set(instanceId, { createdAt: Date.now(), offer }),
    });
  }
  async comfyUiTemplate() {
    return this.offerUseCases().template();
  }
  async comfyUiTemplateByHash(hashId: string) {
    return this.offerUseCases().template(hashId);
  }
  async searchOffers(input: VastAiOfferSearchInput) {
    return this.offerUseCases().search(input);
  }
  async getOffer(offerId: number, storageGb: number) {
    return this.offerUseCases().offer(offerId, storageGb);
  }
  async rentOffer(input: VastAiRentRequest, validatedOffer?: VastAiOffer) {
    return this.offerUseCases().rent(input, validatedOffer);
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
