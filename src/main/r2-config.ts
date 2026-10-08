import { R2ConnectionUseCases } from '../application/r2-connection-use-cases.js';
import path from 'node:path';
import { safeStorage } from 'electron';
import { withTemplateStoreLock, readJson, writeJsonAtomic } from './fs-utils.js';

import {
  type R2ConnectionInput,
  type R2ConnectionStatus,
  type StoredR2Config,
  normalizePublicUrl,
  validateR2Connection as validate,
} from '../domain/r2-connection-policy.js';
export type { R2ConnectionInput, R2ConnectionStatus } from '../domain/r2-connection-policy.js';
function encrypt(value: string) {
  if (!safeStorage.isEncryptionAvailable())
    throw new Error('OSの安全な暗号化ストレージを利用できないためSecretを保存できません。');
  return safeStorage.encryptString(value).toString('base64');
}
function decrypt(value: string | undefined) {
  if (!value) return '';
  try {
    return safeStorage.decryptString(Buffer.from(value, 'base64'));
  } catch {
    return '';
  }
}

export class R2ConfigStore {
  private readonly filePath: string;
  constructor(userData: string) {
    this.filePath = path.join(userData, 'r2', 'config.json');
  }
  async raw() {
    return readJson<StoredR2Config>(this.filePath);
  }
  environmentDefaults(): R2ConnectionInput {
    return {
      name: 'Personal R2',
      accountId: process.env.R2_ACCOUNT_ID ?? '',
      accessKeyId: process.env.R2_ACCESS_KEY ?? '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
      publicUrl: process.env.R2_PUBLIC_URL ?? '',
      cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN ?? '',
    };
  }
  async status(): Promise<R2ConnectionStatus> {
    const c = await this.raw();
    if (!c) {
      const e = this.environmentDefaults();
      return {
        configured: false,
        name: e.name ?? 'Personal R2',
        accountId: e.accountId,
        accessKeyId: e.accessKeyId,
        publicUrl: normalizePublicUrl(e.publicUrl),
        secretConfigured: Boolean(e.secretAccessKey),
        metricsTokenConfigured: Boolean(e.cloudflareApiToken),
      };
    }
    return {
      configured: true,
      name: c.name,
      accountId: c.accountId,
      accessKeyId: c.accessKeyId,
      publicUrl: c.publicUrl,
      secretConfigured: Boolean(decrypt(c.encryptedSecret)),
      metricsTokenConfigured: Boolean(decrypt(c.encryptedMetricsToken)),
    };
  }
  async credentials() {
    const c = await this.raw();
    if (c) {
      const secret = decrypt(c.encryptedSecret);
      if (!secret) throw new Error('Secret Access Keyが保存されていません。');
      return {
        name: c.name,
        accountId: c.accountId,
        accessKeyId: c.accessKeyId,
        secretAccessKey: secret,
        publicUrl: c.publicUrl,
        cloudflareApiToken: decrypt(c.encryptedMetricsToken),
      };
    }
    throw new Error('R2 connection is not configured. Register credentials explicitly.');
  }
  private useCases() {
    return new R2ConnectionUseCases({
      exclusive: (work) => withTemplateStoreLock(this.filePath, work),
      read: () => this.raw(),
      write: (value) => writeJsonAtomic(this.filePath, value),
      encrypt,
      decrypt,
    });
  }
  async resolveInput(input: R2ConnectionInput) {
    return this.useCases().resolveInput(input);
  }
  async save(input: R2ConnectionInput, verify: (input: R2ConnectionInput) => Promise<void>) {
    await this.useCases().save(input, verify);
    return this.status();
  }
}
