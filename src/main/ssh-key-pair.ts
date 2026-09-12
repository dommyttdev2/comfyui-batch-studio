import { readFile } from 'node:fs/promises';
import ssh2 from 'ssh2';

const { utils } = ssh2;

function parsed(data: Buffer | string, label: string) {
  const key = utils.parseKey(data);
  if (key instanceof Error) throw new Error(`${label}を読み取れません: ${key.message}`);
  return key;
}

export function normalizeOpenSshPublicKey(value: string) {
  const line =
    value
      .split(/\r?\n/)
      .map((x) => x.trim())
      .find(Boolean) ?? '';
  const parts = line.split(/\s+/);
  if (parts.length < 2) throw new Error('SSH公開鍵がOpenSSH形式ではありません。');
  const normalized = `${parts[0]} ${parts[1]}`;
  parsed(normalized, 'SSH公開鍵');
  return normalized;
}

export async function validateSshKeyPair(privateKeyPath: string, publicKeyPath: string) {
  const [privateKey, publicText] = await Promise.all([
    readFile(privateKeyPath),
    readFile(publicKeyPath, 'utf8'),
  ]);
  const privateParsed = parsed(privateKey, 'SSH秘密鍵'),
    normalizedPublicKey = normalizeOpenSshPublicKey(publicText),
    publicParsed = parsed(normalizedPublicKey, 'SSH公開鍵');
  if (!privateParsed.getPublicSSH().equals(publicParsed.getPublicSSH()))
    throw new Error('SSH秘密鍵とSSH公開鍵が同じキーペアではありません。');
  return { publicKey: normalizedPublicKey, keyType: publicParsed.type };
}
