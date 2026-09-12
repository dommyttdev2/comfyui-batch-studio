import path from 'node:path';
import { safeStorage } from 'electron';
import type { CivitaiConnectionInput, CivitaiConnectionStatus } from '../shared/types.js';
import { readJson, writeJsonAtomic } from './fs-utils.js';

interface StoredCivitaiConfig {
  schemaVersion: 1;
  encryptedApiKey: string;
}
function encrypt(value: string) {
  if (!safeStorage.isEncryptionAvailable())
    throw new Error(
      'OSの安全な暗号化ストレージを利用できないためCivitai API Keyを保存できません。',
    );
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

export class CivitaiConfigStore {
  private readonly filePath: string;
  constructor(userData: string) {
    this.filePath = path.join(userData, 'civitai', 'config.json');
  }
  private async raw() {
    return readJson<StoredCivitaiConfig>(this.filePath);
  }
  private environmentApiKey() {
    return (process.env.CIVIT_API_KEY ?? '').trim();
  }
  async apiKey() {
    const saved = decrypt((await this.raw())?.encryptedApiKey);
    return saved || this.environmentApiKey();
  }
  async status(): Promise<CivitaiConnectionStatus> {
    const saved = decrypt((await this.raw())?.encryptedApiKey);
    if (saved) return { configured: true, source: 'saved' };
    if (this.environmentApiKey()) return { configured: true, source: 'environment' };
    return { configured: false, source: 'none' };
  }
  async save(input: CivitaiConnectionInput): Promise<CivitaiConnectionStatus> {
    const apiKey = typeof input?.apiKey === 'string' ? input.apiKey.trim() : '';
    if (!apiKey) throw new Error('Civitai API Keyを入力してください。');
    await writeJsonAtomic(this.filePath, {
      schemaVersion: 1,
      encryptedApiKey: encrypt(apiKey),
    } satisfies StoredCivitaiConfig);
    process.env.CIVIT_API_KEY = apiKey;
    return this.status();
  }
}
