import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ActorContext } from '../domain/contracts.js';
import { fields, HttpFailure, json, object, type RequestContext } from './http.js';
import { atomicJson, SerialQueue } from './storage.js';

export const providers = ['civitai', 'r2', 'vast'] as const;
export type IntegrationProvider = (typeof providers)[number];
type Secrets = Record<string, string>;
type Cipher = { iv: string; tag: string; data: string };
type ProviderSettings = {
  enabled: boolean;
  revision: number;
  account?: string;
  publicUrl?: string;
  cipher?: Cipher;
};
type Registration = {
  schema: 'web-integrations/1';
  source: 'environment' | 'vault';
  revision: number;
  providers: Partial<Record<IntegrationProvider, ProviderSettings>>;
};
const names: Record<IntegrationProvider, Record<string, string>> = {
  civitai: { apiKey: 'BATCH_STUDIO_SECRET_CIVITAI_API_KEY' },
  r2: {
    accessKeyId: 'BATCH_STUDIO_SECRET_R2_ACCESS_KEY_ID',
    secretAccessKey: 'BATCH_STUDIO_SECRET_R2_SECRET_ACCESS_KEY',
  },
  vast: { apiKey: 'BATCH_STUDIO_SECRET_VAST_API_KEY' },
};
function unavailable(): never {
  throw new HttpFailure(503, 'INTEGRATION_UNAVAILABLE');
}
function positive(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw new HttpFailure(400, 'INVALID_INPUT');
  return value as number;
}
function settings(provider: IntegrationProvider, raw: unknown): ProviderSettings {
  const value = object(raw);
  fields(value, ['enabled', 'revision', 'account', 'publicUrl', 'cipher']);
  if (typeof value.enabled !== 'boolean') throw new HttpFailure(400, 'INVALID_INPUT');
  const result: ProviderSettings = { enabled: value.enabled, revision: positive(value.revision) };
  if (provider === 'r2') {
    if (typeof value.account !== 'string' || !/^[a-f0-9]{32}$/.test(value.account))
      throw new HttpFailure(400, 'INVALID_INPUT');
    result.account = value.account;
    if (value.publicUrl !== undefined) {
      if (typeof value.publicUrl !== 'string' || value.publicUrl.length > 2048)
        throw new HttpFailure(400, 'INVALID_INPUT');
      const url = new URL(value.publicUrl);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
        throw new HttpFailure(400, 'INVALID_INPUT');
      result.publicUrl = url.href.replace(/\/$/, '');
    }
  } else if (value.account !== undefined || value.publicUrl !== undefined)
    throw new HttpFailure(400, 'INVALID_INPUT');
  if (value.cipher !== undefined) {
    const cipher = object(value.cipher);
    fields(cipher, ['iv', 'tag', 'data']);
    if (
      typeof cipher.iv !== 'string' ||
      !/^[a-f0-9]{24}$/.test(cipher.iv) ||
      typeof cipher.tag !== 'string' ||
      !/^[a-f0-9]{32}$/.test(cipher.tag) ||
      typeof cipher.data !== 'string' ||
      !/^(?:[a-f0-9]{2}){1,32768}$/.test(cipher.data)
    )
      throw new HttpFailure(400, 'INVALID_INPUT');
    result.cipher = cipher as Cipher;
  }
  return result;
}
function validateSecrets(provider: IntegrationProvider, raw: unknown): Secrets {
  const value = object(raw);
  fields(value, Object.keys(names[provider]));
  for (const key of Object.keys(names[provider]))
    if (
      typeof value[key] !== 'string' ||
      !value[key] ||
      (value[key] as string).length > 8192 ||
      /[\r\n\0]/.test(value[key] as string)
    )
      throw new HttpFailure(400, 'INVALID_INPUT');
  return value as Secrets;
}
function admin(actor: ActorContext): void {
  if (!actor.permissions.includes('admin')) throw new HttpFailure(403, 'FORBIDDEN');
}
export class IntegrationSettings {
  private value: Registration | undefined;
  private initialized = false;
  private readonly queue = new SerialQueue();
  private readonly file: string;
  constructor(
    dataDir: string,
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {
    this.file = path.join(dataDir, 'integrations.json');
  }
  async initialize(): Promise<void> {
    let info;
    try {
      info = await lstat(this.file);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        this.initialized = true;
        return;
      }
      unavailable();
    }
    try {
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.size > 256 * 1024 ||
        (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
      )
        unavailable();
      const raw = object(JSON.parse(await readFile(this.file, 'utf8')));
      fields(raw, ['schema', 'source', 'revision', 'providers']);
      if (
        raw.schema !== 'web-integrations/1' ||
        !['environment', 'vault'].includes(raw.source as string)
      )
        unavailable();
      const entries = object(raw.providers);
      fields(entries, [...providers]);
      const registered: Registration = {
        schema: 'web-integrations/1',
        source: raw.source as Registration['source'],
        revision: positive(raw.revision),
        providers: {},
      };
      for (const provider of providers)
        if (entries[provider] !== undefined) {
          const config = settings(provider, entries[provider]);
          if (config.revision > registered.revision) unavailable();
          if (registered.source === 'environment' && config.cipher !== undefined) unavailable();
          if (registered.source === 'vault' && !config.cipher) unavailable();
          registered.providers[provider] = config;
        }
      this.value = registered;
      this.initialized = true;
    } catch {
      unavailable();
    }
  }
  private key(): Buffer {
    const value = this.environment.BATCH_STUDIO_VAULT_KEY;
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) unavailable();
    return Buffer.from(value, 'hex');
  }
  private aad(provider: IntegrationProvider, config: ProviderSettings): Buffer {
    return Buffer.from(
      JSON.stringify({
        schema: 'web-integrations/1',
        provider,
        revision: config.revision,
        account: config.account ?? null,
      }),
    );
  }
  private encrypt(
    provider: IntegrationProvider,
    config: ProviderSettings,
    secret: Secrets,
  ): Cipher {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    cipher.setAAD(this.aad(provider, config));
    const data = Buffer.concat([
      cipher.update(JSON.stringify(validateSecrets(provider, secret))),
      cipher.final(),
    ]);
    return {
      iv: iv.toString('hex'),
      tag: cipher.getAuthTag().toString('hex'),
      data: data.toString('hex'),
    };
  }
  private readSecrets(provider: IntegrationProvider, config: ProviderSettings): Secrets {
    if (!this.value) unavailable();
    try {
      if (this.value.source === 'environment') {
        return validateSecrets(
          provider,
          Object.fromEntries(
            Object.entries(names[provider]).map(([key, name]) => [key, this.environment[name]]),
          ),
        );
      }
      if (!config.cipher) unavailable();
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.key(),
        Buffer.from(config.cipher.iv, 'hex'),
      );
      decipher.setAAD(this.aad(provider, config));
      decipher.setAuthTag(Buffer.from(config.cipher.tag, 'hex'));
      const bytes = Buffer.concat([
        decipher.update(Buffer.from(config.cipher.data, 'hex')),
        decipher.final(),
      ]);
      return validateSecrets(provider, JSON.parse(bytes.toString('utf8')));
    } catch {
      unavailable();
    }
  }
  resolve(provider: IntegrationProvider): {
    revision: number;
    fingerprint: string;
    account?: string;
    publicUrl?: string;
    secrets: Secrets;
  } {
    const config = this.value?.providers[provider];
    if (!config?.enabled) unavailable();
    const secrets = this.readSecrets(provider, config);
    return {
      revision: config.revision,
      fingerprint: createHash('sha256')
        .update(
          JSON.stringify({
            provider,
            revision: config.revision,
            account: config.account ?? null,
            publicUrl: config.publicUrl ?? null,
            secrets,
          }),
        )
        .digest('hex'),
      account: config.account,
      publicUrl: config.publicUrl,
      secrets,
    };
  }
  providerState(
    provider: IntegrationProvider,
  ): 'unconfigured' | 'disabled' | 'unavailable' | 'ready' {
    const config = this.value?.providers[provider];
    if (!config) return 'unconfigured';
    if (!config.enabled) return 'disabled';
    try {
      this.resolve(provider);
      return 'ready';
    } catch {
      return 'unavailable';
    }
  }
  status(actor: ActorContext) {
    if (!actor.permissions.includes('read') && !actor.permissions.includes('admin'))
      throw new HttpFailure(403, 'FORBIDDEN');
    return {
      configured: !!this.value,
      revision: this.value?.revision ?? 0,
      canManage: actor.permissions.includes('admin'),
      canRegisterSecrets: actor.permissions.includes('admin') && this.value?.source === 'vault',
      providers: providers.map((provider) => {
        const config = this.value?.providers[provider];
        let state = !config ? 'unconfigured' : !config.enabled ? 'disabled' : 'unavailable';
        if (config?.enabled) {
          try {
            this.resolve(provider);
            state = 'ready';
          } catch {
            /* Metadata remains readable without exposing errors or secrets. */
          }
        }
        return {
          provider,
          state,
          revision: config?.revision ?? 0,
          ...(config?.account
            ? { account: config.account, publicUrl: config.publicUrl ?? null }
            : {}),
        };
      }),
    };
  }
  async register(
    source: Registration['source'],
    input: Partial<
      Record<IntegrationProvider, { account?: string; publicUrl?: string; secrets?: Secrets }>
    >,
  ): Promise<void> {
    await this.queue.run(async () => {
      // Used by the administrator bootstrap while holding the server filesystem lease.
      if (
        this.value ||
        !this.initialized ||
        !['environment', 'vault'].includes(source) ||
        !Object.keys(input).length ||
        Object.keys(input).some((p) => !providers.includes(p as IntegrationProvider))
      )
        throw new HttpFailure(409, 'REGISTRATION_REJECTED');
      const next: Registration = {
        schema: 'web-integrations/1',
        source,
        revision: 1,
        providers: {},
      };
      for (const provider of providers)
        if (input[provider]) {
          const raw = input[provider]!;
          const config = settings(provider, {
            enabled: true,
            revision: 1,
            ...(raw.account !== undefined ? { account: raw.account } : {}),
            ...(raw.publicUrl !== undefined ? { publicUrl: raw.publicUrl } : {}),
          });
          if (source === 'vault')
            config.cipher = this.encrypt(provider, config, validateSecrets(provider, raw.secrets));
          else if (raw.secrets !== undefined) throw new HttpFailure(400, 'INVALID_INPUT');
          next.providers[provider] = config;
        }
      // Validate selected source before making the registration visible.
      this.value = next;
      try {
        for (const p of providers) if (next.providers[p]) this.resolve(p);
        await atomicJson(this.file, next);
      } catch (e) {
        this.value = undefined;
        throw e;
      }
    });
  }
  async update(
    actor: ActorContext,
    provider: IntegrationProvider,
    expectedRevision: number,
    raw: unknown,
  ) {
    admin(actor);
    return this.queue.run(async () => {
      if (!this.value) unavailable();
      if (expectedRevision !== this.value.revision) throw new HttpFailure(409, 'REVISION_CONFLICT');
      const input = object(raw);
      fields(input, ['enabled', 'account', 'publicUrl', 'secrets']);
      const previous = this.value.providers[provider];
      const config = settings(provider, {
        enabled: input.enabled,
        revision: (previous?.revision ?? 0) + 1,
        ...(input.account !== undefined ? { account: input.account } : {}),
        ...(input.publicUrl !== undefined ? { publicUrl: input.publicUrl } : {}),
      });
      if (this.value.source === 'environment') {
        if (input.secrets !== undefined) throw new HttpFailure(400, 'SECRET_SOURCE_READ_ONLY');
        if (config.enabled) this.readSecrets(provider, config);
      } else {
        const secret =
          input.secrets !== undefined
            ? validateSecrets(provider, input.secrets)
            : previous
              ? this.readSecrets(provider, previous)
              : unavailable();
        config.cipher = this.encrypt(provider, config, secret);
      }
      const next = structuredClone(this.value);
      next.revision++;
      next.providers[provider] = config;
      await atomicJson(this.file, next);
      this.value = next;
      return this.status(actor);
    });
  }
  route = async (context: RequestContext): Promise<boolean> => {
    if (context.url.pathname !== '/api/v1/integrations/settings') return false;
    if (context.request.method === 'GET') {
      json(context.response, 200, this.status(context.actor));
      return true;
    }
    if (context.request.method !== 'POST') throw new HttpFailure(405, 'METHOD_NOT_ALLOWED');
    fields(context.input, ['provider', 'expectedRevision', 'settings']);
    if (!providers.includes(context.input.provider as IntegrationProvider))
      throw new HttpFailure(400, 'INVALID_INPUT');
    const result = await this.update(
      context.actor,
      context.input.provider as IntegrationProvider,
      positive(context.input.expectedRevision),
      context.input.settings,
    );
    json(context.response, 200, result);
    return true;
  };
  async drain(): Promise<void> {
    await this.queue.drain();
  }
}
