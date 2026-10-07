export function assertPersistSafe(value: unknown, keyPath = 'run') {
  if (typeof value === 'string') {
    if (
      /-----BEGIN [^-]*PRIVATE KEY-----/i.test(value) ||
      /[?&](?:X-Amz-(?:Credential|Signature|Security-Token)|AWSAccessKeyId|Signature|sig|token)=/i.test(
        value,
      )
    )
      throw new Error(`Execution Run contains sensitive value at ${keyPath}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPersistSafe(item, `${keyPath}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (
      /api.?key|secret|credential|private.?key|authorization|presigned.?url|signed.?url|cloudflare.?token/i.test(
        key,
      )
    )
      throw new Error(`Execution Run contains forbidden field: ${keyPath}.${key}`);
    assertPersistSafe(item, `${keyPath}.${key}`);
  }
}
