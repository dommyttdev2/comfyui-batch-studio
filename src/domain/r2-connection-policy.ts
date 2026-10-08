export interface R2ConnectionInput {
  name?: string;
  accountId: string;
  accessKeyId: string;
  secretAccessKey?: string;
  publicUrl?: string;
  cloudflareApiToken?: string;
}

export interface R2ConnectionStatus {
  configured: boolean;
  name: string;
  accountId: string;
  accessKeyId: string;
  publicUrl: string;
  secretConfigured: boolean;
  metricsTokenConfigured: boolean;
}

export interface StoredR2Config {
  schemaVersion: 1;
  name: string;
  accountId: string;
  accessKeyId: string;
  publicUrl: string;
  encryptedSecret?: string;
  encryptedMetricsToken?: string;
}

const ACCOUNT_ID = /^[0-9a-fA-F]{32}$/;

export function normalizePublicUrl(value: string | undefined) {
  return (value ?? '').trim().replace(/\/+$/, '');
}
export function validateR2Connection(input: R2ConnectionInput) {
  if (!ACCOUNT_ID.test(input.accountId.trim()))
    throw new Error('Account IDは32文字の16進数で入力してください。');
  if (!input.accessKeyId.trim()) throw new Error('Access Key IDを入力してください。');
  const publicUrl = normalizePublicUrl(input.publicUrl);
  if (publicUrl && !/^https?:\/\//i.test(publicUrl))
    throw new Error('Public URLはhttp://またはhttps://から入力してください。');
}

export function r2CredentialReuse(existing: StoredR2Config | null, input: R2ConnectionInput) {
  return {
    secret:
      !!existing &&
      existing.accountId === input.accountId.trim() &&
      existing.accessKeyId === input.accessKeyId.trim(),
    metrics: !!existing && existing.accountId === input.accountId.trim(),
  };
}
