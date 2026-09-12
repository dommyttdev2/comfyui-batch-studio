import { readFile } from 'node:fs/promises';
import ssh2 from 'ssh2';
import type { Client as SshClient, ConnectConfig, SFTPWrapper } from 'ssh2';
import { sshHostKeyFingerprint, type SshHostKeyStore } from './ssh-host-keys.js';

const { Client } = ssh2;

export interface SshEndpoint {
  host: string;
  port: number;
  user: string;
  privateKeyPath: string;
}
export class SshHostKeyError extends Error {
  constructor(
    public readonly code: 'HOST_KEY_UNVERIFIED' | 'HOST_KEY_MISMATCH',
    message: string,
    public readonly fingerprint: string,
    public readonly expectedFingerprint?: string,
  ) {
    super(message);
  }
}

export class VerifiedSshSession {
  constructor(
    private readonly client: SshClient,
    readonly endpoint: SshEndpoint,
  ) {}
  exec(
    command: string,
    stdin?: string,
    onStdoutChunk?: (chunk: string) => void,
  ): Promise<{ stdout: string; stderr: string; code: number | null }> {
    return new Promise((resolve, reject) =>
      this.client.exec(command, (error, stream) => {
        if (error) return reject(error);
        let stdout = '',
          stderr = '';
        stream.on('data', (d: Buffer) => {
          const chunk = d.toString();
          stdout += chunk;
          onStdoutChunk?.(chunk);
        });
        stream.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
        stream.on('close', (code: number | null) => resolve({ stdout, stderr, code }));
        stream.on('error', reject);
        if (stdin !== undefined) {
          stream.end(stdin);
        } else stream.end();
      }),
    );
  }
  sftp(): Promise<SFTPWrapper> {
    return new Promise((resolve, reject) =>
      this.client.sftp((e, s) => (e ? reject(e) : resolve(s))),
    );
  }
  close() {
    this.client.end();
  }
}

export class VerifiedSshClient {
  constructor(
    private readonly hostKeys: SshHostKeyStore,
    private readonly firstUsePolicy?: (info: {
      host: string;
      port: number;
      fingerprint: string;
    }) => Promise<boolean>,
  ) {}
  async connect(endpoint: SshEndpoint): Promise<VerifiedSshSession> {
    const privateKey = await readFile(endpoint.privateKeyPath);
    const trusted = await this.hostKeys.trustedFingerprint(endpoint.host, endpoint.port);
    let observed = '';
    const client = new Client();
    const config: ConnectConfig = {
      host: endpoint.host,
      port: endpoint.port,
      username: endpoint.user,
      privateKey,
      readyTimeout: 20_000,
      keepaliveInterval: 10_000,
      keepaliveCountMax: 3,
      hostVerifier: (key: Buffer) => {
        observed = sshHostKeyFingerprint(key);
        return Boolean(trusted && trusted === observed);
      },
    };
    try {
      await new Promise<void>((resolve, reject) =>
        client.once('ready', resolve).once('error', reject).connect(config),
      );
    } catch (error) {
      client.end();
      if (observed && !trusted) {
        if (
          this.firstUsePolicy &&
          (await this.firstUsePolicy({
            host: endpoint.host,
            port: endpoint.port,
            fingerprint: observed,
          }))
        ) {
          await this.hostKeys.trustFingerprint(endpoint.host, endpoint.port, observed);
          return this.connect(endpoint);
        }
        throw new SshHostKeyError(
          'HOST_KEY_UNVERIFIED',
          `SSH Host Key is not trusted for ${endpoint.host}:${endpoint.port}. Explicit first-use trust is required.`,
          observed,
        );
      }
      if (observed && trusted !== observed)
        throw new SshHostKeyError(
          'HOST_KEY_MISMATCH',
          `SSH Host Key mismatch for ${endpoint.host}:${endpoint.port}.`,
          observed,
          trusted ?? undefined,
        );
      throw error;
    }
    return new VerifiedSshSession(client, endpoint);
  }
}
