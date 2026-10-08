import {
  type R2ConnectionInput,
  type StoredR2Config,
  validateR2Connection,
  normalizePublicUrl,
  r2CredentialReuse,
} from '../domain/r2-connection-policy.js';
export interface R2ConnectionPorts {
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  read(): Promise<StoredR2Config | null>;
  write(value: StoredR2Config): Promise<void>;
  encrypt(value: string): string;
  decrypt(value: string | undefined): string;
}
export class R2ConnectionUseCases {
  constructor(private readonly ports: R2ConnectionPorts) {}
  private resolveAgainst(input: R2ConnectionInput, existing: StoredR2Config | null) {
    validateR2Connection(input);
    const submittedSecret = (input.secretAccessKey ?? '').trim(),
      submittedToken = (input.cloudflareApiToken ?? '').trim();
    const reuse = r2CredentialReuse(existing, input),
      sameIdentity = reuse.secret;
    const savedSecret =
      !submittedSecret && sameIdentity ? this.ports.decrypt(existing?.encryptedSecret) : '';
    const secretAccessKey = submittedSecret || savedSecret;
    if (!secretAccessKey)
      throw new Error(
        sameIdentity
          ? '保存済みSecret Access Keyを読み取れません。再入力してください。'
          : 'Account IDまたはAccess Key IDを変更する場合はSecret Access Keyも入力してください。',
      );
    const savedToken =
      !submittedToken && reuse.metrics ? this.ports.decrypt(existing?.encryptedMetricsToken) : '';
    return {
      name: (input.name ?? 'Personal R2').trim() || 'Personal R2',
      accountId: input.accountId.trim(),
      accessKeyId: input.accessKeyId.trim(),
      secretAccessKey,
      publicUrl: normalizePublicUrl(input.publicUrl),
      cloudflareApiToken: submittedToken || savedToken,
    };
  }
  async resolveInput(input: R2ConnectionInput) {
    return this.resolveAgainst(input, await this.ports.read());
  }
  async save(
    input: R2ConnectionInput,
    verify: (value: ReturnType<R2ConnectionUseCases['resolveAgainst']>) => Promise<void>,
  ) {
    return this.ports.exclusive(async () => {
      const existing = await this.ports.read(),
        resolved = this.resolveAgainst(input, existing);
      await verify(resolved);
      const submittedSecret = (input.secretAccessKey ?? '').trim(),
        submittedToken = (input.cloudflareApiToken ?? '').trim();
      const reuse = r2CredentialReuse(existing, input),
        sameIdentity = reuse.secret;
      const encryptedSecret = submittedSecret
        ? this.ports.encrypt(submittedSecret)
        : sameIdentity
          ? existing?.encryptedSecret
          : this.ports.encrypt(resolved.secretAccessKey);
      const encryptedMetricsToken = submittedToken
        ? this.ports.encrypt(submittedToken)
        : reuse.metrics
          ? existing?.encryptedMetricsToken
          : undefined;
      if (!encryptedSecret) throw new Error('Secret Access Keyを入力してください。');
      const next: StoredR2Config = {
        schemaVersion: 1,
        name: resolved.name,
        accountId: resolved.accountId,
        accessKeyId: resolved.accessKeyId,
        publicUrl: resolved.publicUrl,
        encryptedSecret,
        encryptedMetricsToken,
      };
      await this.ports.write(next);
      return next;
    });
  }
}
