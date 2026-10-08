import { createHash, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { lstat, open, realpath } from 'node:fs/promises';
import { BlockList, isIP } from 'node:net';
import path from 'node:path';
import ssh2 from 'ssh2';
import { resolveVastSshEndpoint } from '../application/vast-ssh-endpoint.js';
import type { ActorContext } from '../domain/contracts.js';
import type { ExternalDefinition, ExternalFacts } from './external-operations.js';
import { fields, HttpFailure, identifier, json, object, type RequestContext } from './http.js';
import { IntegrationSettings } from './integration-settings.js';
import { atomicJson, SerialQueue } from './storage.js';
import { vastId, WebVastClient } from './vast-client.js';

type Key = {
  id: string;
  root: string;
  privateFile: string;
  publicFile: string;
  privateHash: string;
  publicHash: string;
  user: string;
  directory: string;
};
type Candidate = {
  id: string;
  userId: string;
  instanceId: number;
  keyId: string;
  host: string;
  port: number;
  fingerprint: string;
  sourceFingerprint: string;
};
type Trusted = {
  instanceId: number;
  keyId: string;
  host: string;
  port: number;
  fingerprint: string;
  sourceFingerprint: string;
};
type Store = { schema: 'web-ssh/1'; keys: Key[]; candidates: Candidate[]; trusted: Trusted[] };
const hash = (raw: Buffer | string) => createHash('sha256').update(raw).digest('hex');
const digest = (raw: unknown) => hash(JSON.stringify(raw));
const fingerprint = (raw: Buffer) =>
  'SHA256:' + createHash('sha256').update(raw).digest('base64').replace(/=+$/, '');
function admin(actor: ActorContext) {
  if (!actor.permissions.includes('admin')) throw new HttpFailure(403, 'FORBIDDEN');
}
function text(raw: unknown, max = 4096): string {
  if (typeof raw !== 'string' || !raw || raw.length > max || /[\x00-\x1f]/.test(raw))
    throw new HttpFailure(400, 'INVALID_INPUT');
  return raw;
}
function host(raw: unknown): string {
  const value = text(raw, 253);
  if (!/^[a-zA-Z0-9.:-]+$/.test(value)) throw new HttpFailure(400, 'INVALID_INPUT');
  return value;
}
function port(raw: unknown): number {
  const value = vastId(raw);
  if (value > 65535) throw new HttpFailure(400, 'INVALID_INPUT');
  return value;
}
function checkFingerprint(raw: unknown): string {
  const value = text(raw, 64);
  if (!/^SHA256:[A-Za-z0-9+/]{43}$/.test(value)) throw new HttpFailure(400, 'INVALID_INPUT');
  return value;
}
function key(raw: unknown): Key {
  const value = object(raw);
  fields(value, [
    'id',
    'root',
    'privateFile',
    'publicFile',
    'privateHash',
    'publicHash',
    'user',
    'directory',
  ]);
  const result = {
    id: identifier(value.id),
    root: text(value.root),
    privateFile: text(value.privateFile),
    publicFile: text(value.publicFile),
    privateHash: text(value.privateHash),
    publicHash: text(value.publicHash),
    user: text(value.user, 64),
    directory: text(value.directory),
  };
  if (
    !path.isAbsolute(result.root) ||
    !path.isAbsolute(result.privateFile) ||
    !path.isAbsolute(result.publicFile) ||
    !/^[a-f0-9]{64}$/.test(result.privateHash) ||
    !/^[a-f0-9]{64}$/.test(result.publicHash) ||
    !/^[-a-zA-Z0-9_]+$/.test(result.user) ||
    !result.directory.startsWith('/') ||
    result.directory.split('/').some((p) => p === '..')
  )
    throw new HttpFailure(400, 'INVALID_INPUT');
  return result;
}
function candidate(raw: unknown): Candidate {
  const value = object(raw);
  fields(value, [
    'id',
    'userId',
    'instanceId',
    'keyId',
    'host',
    'port',
    'fingerprint',
    'sourceFingerprint',
  ]);
  if (
    typeof value.sourceFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.sourceFingerprint)
  )
    throw new HttpFailure(400, 'INVALID_INPUT');
  return {
    id: identifier(value.id),
    userId: identifier(value.userId),
    instanceId: vastId(value.instanceId),
    keyId: identifier(value.keyId),
    host: host(value.host),
    port: port(value.port),
    fingerprint: checkFingerprint(value.fingerprint),
    sourceFingerprint: value.sourceFingerprint,
  };
}
function trusted(raw: unknown): Trusted {
  const value = object(raw);
  fields(value, ['instanceId', 'keyId', 'host', 'port', 'fingerprint', 'sourceFingerprint']);
  const result = candidate({ ...value, id: 'validation', userId: 'validation' });
  const { id: _id, userId: _user, ...rest } = result;
  return rest;
}
export async function probeSsh(host: string, port: number): Promise<string> {
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([
    lookup(host, { all: true }),
    new Promise<{ address: string; family: number }[]>((_resolve, reject) => {
      dnsTimer = setTimeout(() => reject(new HttpFailure(502, 'SSH_PROBE_FAILED')), 10_000);
    }),
  ]).finally(() => clearTimeout(dnsTimer));
  const denied = new BlockList();
  for (const [address, prefix] of [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.168.0.0', 16],
    ['100.64.0.0', 10],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ] as const)
    denied.addSubnet(address, prefix, 'ipv4');
  const allowed6 = new BlockList();
  allowed6.addSubnet('2000::', 3, 'ipv6');
  if (
    !addresses.length ||
    addresses.some((a) =>
      isIP(a.address) === 4 ? denied.check(a.address, 'ipv4') : !allowed6.check(a.address, 'ipv6'),
    )
  )
    throw new HttpFailure(400, 'SSH_HOST_REJECTED');
  return captureSshHostKey(addresses[0].address, port);
}
export async function captureSshHostKey(address: string, port: number): Promise<string> {
  // The probe rejects the host during key exchange. No credentials or commands are sent.
  return new Promise((resolve, reject) => {
    const client = new ssh2.Client();
    let settled = false;
    const finish = (error?: Error, result?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.destroy();
      if (error) reject(new HttpFailure(502, 'SSH_PROBE_FAILED'));
      else resolve(result!);
    };
    const timer = setTimeout(() => finish(new Error()), 10_000);
    client.on('error', (error) => finish(error));
    client.on('close', () => {
      if (!settled) finish(new Error());
    });
    client.connect({
      host: address,
      port,
      username: 'host-key-probe',
      readyTimeout: 10_000,
      hostVerifier: (key: Buffer) => {
        const value = fingerprint(key as Buffer);
        finish(undefined, value);
        return false;
      },
    });
  });
}
export class SshResources {
  private readonly file: string;
  private readonly queue = new SerialQueue();
  private initialized = false;
  private value: Store = { schema: 'web-ssh/1', keys: [], candidates: [], trusted: [] };
  constructor(
    private readonly dataDir: string,
    private readonly settings: IntegrationSettings,
    private readonly fetcher: typeof fetch = fetch,
    private readonly probe = probeSsh,
  ) {
    this.file = path.join(dataDir, 'ssh.json');
  }
  private async save(next: Store) {
    if (Buffer.byteLength(JSON.stringify(next)) > 1024 * 1024)
      throw new HttpFailure(503, 'SSH_STORE_CAPACITY');
    await atomicJson(this.file, next);
  }
  async initialize() {
    let info;
    try {
      info = await lstat(this.file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.initialized = true;
        return;
      }
      throw new HttpFailure(503, 'SSH_STORE_UNAVAILABLE');
    }
    try {
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.size > 1024 * 1024 ||
        (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
      )
        throw new Error();
      const handle = await open(this.file, 'r');
      let raw;
      try {
        raw = object(JSON.parse(await handle.readFile('utf8')));
      } finally {
        await handle.close();
      }
      fields(raw, ['schema', 'keys', 'candidates', 'trusted']);
      if (
        raw.schema !== 'web-ssh/1' ||
        !Array.isArray(raw.keys) ||
        !Array.isArray(raw.candidates) ||
        !Array.isArray(raw.trusted) ||
        raw.keys.length > 128 ||
        raw.candidates.length > 1000 ||
        raw.trusted.length > 1000
      )
        throw new Error();
      this.value = {
        schema: 'web-ssh/1',
        keys: raw.keys.map(key),
        candidates: raw.candidates.map(candidate),
        trusted: raw.trusted.map(trusted),
      };
      if (
        new Set(this.value.keys.map((k) => k.id)).size !== this.value.keys.length ||
        new Set(this.value.candidates.map((c) => c.id)).size !== this.value.candidates.length ||
        new Set(this.value.trusted.map((t) => t.instanceId)).size !== this.value.trusted.length ||
        [...this.value.candidates, ...this.value.trusted].some(
          (t) => !this.value.keys.some((k) => k.id === t.keyId),
        )
      )
        throw new Error();
      for (const resource of this.value.keys) await this.readKey(resource);
      this.initialized = true;
    } catch {
      throw new HttpFailure(503, 'SSH_STORE_UNAVAILABLE');
    }
  }
  private async privateFile(root: string, file: string, secret = false) {
    const relative = path.relative(root, file);
    if (
      !relative ||
      relative.startsWith('..') ||
      path.isAbsolute(relative) ||
      path.resolve(file).startsWith(path.resolve(this.dataDir) + path.sep)
    )
      throw new HttpFailure(400, 'INVALID_SSH_RESOURCE');
    if ((await realpath(root)) !== root || (await realpath(file)) !== file)
      throw new HttpFailure(400, 'INVALID_SSH_RESOURCE');
    const stat = await lstat(file);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      stat.size < 1 ||
      stat.size > 64 * 1024 ||
      (process.platform !== 'win32' && (stat.mode & (secret ? 0o077 : 0o022)) !== 0)
    )
      throw new HttpFailure(400, 'INVALID_SSH_RESOURCE');
    const handle = await open(file, 'r');
    try {
      const before = await handle.stat();
      if (before.dev !== stat.dev || before.ino !== stat.ino)
        throw new HttpFailure(409, 'SSH_RESOURCE_CHANGED');
      const buffer = await handle.readFile();
      const after = await handle.stat();
      if (
        buffer.length > 64 * 1024 ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs
      )
        throw new HttpFailure(409, 'SSH_RESOURCE_CHANGED');
      return buffer;
    } finally {
      await handle.close();
    }
  }
  private async readKey(resource: Key) {
    const [privateKey, publicKey] = await Promise.all([
      this.privateFile(resource.root, resource.privateFile, true),
      this.privateFile(resource.root, resource.publicFile),
    ]);
    if (hash(privateKey) !== resource.privateHash || hash(publicKey) !== resource.publicHash)
      throw new HttpFailure(409, 'SSH_RESOURCE_CHANGED');
    const parsedPrivate = ssh2.utils.parseKey(privateKey),
      parsedPublic = ssh2.utils.parseKey(publicKey);
    if (
      parsedPrivate instanceof Error ||
      parsedPublic instanceof Error ||
      Array.isArray(parsedPrivate) ||
      Array.isArray(parsedPublic) ||
      !parsedPrivate.getPublicSSH().equals(parsedPublic.getPublicSSH())
    )
      throw new HttpFailure(400, 'INVALID_SSH_KEY_PAIR');
    return {
      privateKey,
      publicKey: parsedPublic.type + ' ' + parsedPublic.getPublicSSH().toString('base64'),
    };
  }
  async register(raw: unknown) {
    if (!this.initialized) throw new HttpFailure(503, 'SSH_STORE_UNAVAILABLE');
    const input = object(raw);
    fields(input, ['id', 'root', 'privateFile', 'publicFile', 'user', 'directory']);
    const root = text(input.root),
      privateFile = text(input.privateFile),
      publicFile = text(input.publicFile);
    const [privateBytes, publicBytes] = await Promise.all([
      this.privateFile(root, privateFile, true),
      this.privateFile(root, publicFile),
    ]);
    const resource = key({
      ...input,
      privateHash: hash(privateBytes),
      publicHash: hash(publicBytes),
    });
    await this.readKey(resource);
    return this.queue.run(async () => {
      if (this.value.keys.some((k) => k.id === resource.id) || this.value.keys.length >= 128)
        throw new HttpFailure(409, 'SSH_RESOURCE_CONFLICT');
      const next = structuredClone(this.value);
      next.keys.push(resource);
      await this.save(next);
      this.value = next;
    });
  }
  private source() {
    if (!this.initialized) throw new HttpFailure(503, 'SSH_STORE_UNAVAILABLE');
    const source = this.settings.resolve('vast');
    return { ...source, client: new WebVastClient(source.secrets.apiKey, this.fetcher) };
  }
  async createCandidate(actor: ActorContext, raw: unknown) {
    admin(actor);
    const input = object(raw);
    fields(input, ['instanceId', 'keyId']);
    const source = this.source(),
      resource = this.value.keys.find((k) => k.id === identifier(input.keyId));
    if (!resource) throw new HttpFailure(404, 'NOT_FOUND');
    await this.readKey(resource);
    const instance = await source.client.instance(vastId(input.instanceId));
    if (instance.status !== 'running' || !instance.sshHost || !instance.sshPort)
      throw new HttpFailure(409, 'SSH_ENDPOINT_UNAVAILABLE');
    const value = candidate({
      id: randomUUID(),
      userId: actor.userId,
      instanceId: instance.id,
      keyId: resource.id,
      host: instance.sshHost,
      port: instance.sshPort,
      fingerprint: await this.probe(host(instance.sshHost), port(instance.sshPort)),
      sourceFingerprint: source.fingerprint,
    });
    return this.queue.run(async () => {
      if (this.source().fingerprint !== source.fingerprint)
        throw new HttpFailure(409, 'SETTINGS_CHANGED');
      if (this.value.candidates.length >= 1000) throw new HttpFailure(503, 'TARGET_CAPACITY');
      const next = structuredClone(this.value);
      next.candidates.push(value);
      await this.save(next);
      this.value = next;
      return { targetId: value.id };
    });
  }
  private get(actor: ActorContext, id: string) {
    admin(actor);
    const target = this.value.candidates.find((c) => c.id === identifier(id));
    if (!target || target.userId !== actor.userId) throw new HttpFailure(404, 'NOT_FOUND');
    const source = this.source();
    if (target.sourceFingerprint !== source.fingerprint)
      throw new HttpFailure(409, 'SETTINGS_CHANGED');
    return { target, source };
  }
  private async inspect(actor: ActorContext, id: string): Promise<ExternalFacts> {
    const { target, source } = this.get(actor, id),
      resource = this.value.keys.find((k) => k.id === target.keyId)!;
    await this.readKey(resource);
    const instance = await source.client.instance(target.instanceId);
    if (
      instance.status !== 'running' ||
      instance.sshHost !== target.host ||
      instance.sshPort !== target.port ||
      (await this.probe(target.host, target.port)) !== target.fingerprint
    )
      throw new HttpFailure(409, 'SSH_HOST_CHANGED');
    if (this.source().fingerprint !== source.fingerprint)
      throw new HttpFailure(409, 'SETTINGS_CHANGED');
    const previous = this.value.trusted.find((t) => t.instanceId === target.instanceId);
    const summary = {
      instanceId: target.instanceId,
      keyId: target.keyId,
      host: target.host,
      port: target.port,
      fingerprint: target.fingerprint,
      previousFingerprint: previous?.fingerprint ?? null,
      publicKeyHash: resource.publicHash,
    };
    return {
      revision: source.revision,
      fingerprint: digest({ source: source.fingerprint, summary }),
      summary,
    };
  }
  readonly definition: ExternalDefinition = {
    scope: (id) => {
      const target = this.value.candidates.find((c) => c.id === id);
      if (!target) throw new HttpFailure(404, 'NOT_FOUND');
      return 'vast-instance-' + target.instanceId;
    },
    inspect: (actor, id) => this.inspect(actor, id),
    execute: async (actor, id, _receipt, facts) => {
      const current = await this.inspect(actor, id);
      if (current.fingerprint !== facts.fingerprint) throw new HttpFailure(409, 'TARGET_CHANGED');
      const { target, source } = this.get(actor, id),
        resource = this.value.keys.find((k) => k.id === target.keyId)!;
      const { publicKey } = await this.readKey(resource);
      await source.client.provision(target.instanceId, publicKey);
      return this.queue.run(async () => {
        if (this.source().fingerprint !== source.fingerprint)
          throw new HttpFailure(409, 'SETTINGS_CHANGED');
        const next = structuredClone(this.value);
        next.trusted = next.trusted.filter((t) => t.instanceId !== target.instanceId);
        const { id: _id, userId: _user, ...trust } = target;
        next.trusted.push(trust);
        await this.save(next);
        this.value = next;
        return {
          state: 'succeeded' as const,
          result: { instanceId: target.instanceId, fingerprint: target.fingerprint },
        };
      });
    },
    reconcile: async (actor, _receipt, id) => {
      const { target } = this.get(actor, id);
      const { id: _id, userId: _user, ...expected } = target;
      const match = this.value.trusted.find(
        (t) => t.instanceId === target.instanceId && digest(t) === digest(expected),
      );
      return { state: match ? 'succeeded' : 'uncertain' };
    },
  };
  async endpoint(actor: ActorContext, instanceId: number) {
    admin(actor);
    const source = this.source(),
      trust = this.value.trusted.find(
        (t) => t.instanceId === vastId(instanceId) && t.sourceFingerprint === source.fingerprint,
      );
    if (!trust) throw new HttpFailure(409, 'SSH_TRUST_REQUIRED');
    const resource = this.value.keys.find((k) => k.id === trust.keyId)!;
    await this.readKey(resource);
    const instance = await source.client.instance(instanceId);
    if (
      instance.sshHost !== trust.host ||
      instance.sshPort !== trust.port ||
      (await this.probe(trust.host, trust.port)) !== trust.fingerprint
    )
      throw new HttpFailure(409, 'SSH_HOST_CHANGED');
    const endpoint = await resolveVastSshEndpoint(
      {
        instance: async () => instance,
        settings: async () => ({
          sshPrivateKeyPath: resource.privateFile,
          sshPrivateKeyExists: true,
          sshPublicKeyPath: resource.publicFile,
          sshPublicKeyExists: true,
          sshUser: resource.user,
        }),
        installPath: async () => resource.directory,
        publicKey: async () => (await this.readKey(resource)).publicKey,
        provision: async (_id, publicKey) => {
          if (!(await source.client.hasSshAccess(instanceId, publicKey)))
            throw new HttpFailure(409, 'SSH_KEY_NOT_PROVISIONED');
        },
      },
      instanceId,
    );
    if (this.source().fingerprint !== source.fingerprint)
      throw new HttpFailure(409, 'SETTINGS_CHANGED');
    return {
      instanceId: endpoint.instanceId,
      keyId: resource.id,
      host: endpoint.host,
      port: endpoint.port,
      user: endpoint.user,
      comfyUiDirectory: endpoint.comfyUiDirectory,
      comfyUiPort: endpoint.comfyUiPort,
      fingerprint: trust.fingerprint,
    };
  }
  async route(context: RequestContext) {
    const base = '/api/v1/integrations/ssh';
    if (!context.url.pathname.startsWith(base + '/')) return false;
    const { actor, input, url, request, response } = context;
    admin(actor);
    if (url.searchParams.size) throw new HttpFailure(400, 'INVALID_INPUT');
    const suffix = url.pathname.slice(base.length);
    if (request.method === 'GET' && suffix === '/keys') {
      json(response, 200, {
        resources: this.value.keys.map((k) => ({
          id: k.id,
          user: k.user,
          comfyUiDirectory: k.directory,
        })),
      });
      return true;
    }
    if (request.method === 'POST' && suffix === '/targets') {
      json(response, 201, await this.createCandidate(actor, input));
      return true;
    }
    if (request.method === 'POST' && suffix === '/endpoint') {
      fields(input, ['instanceId']);
      json(response, 200, await this.endpoint(actor, vastId(input.instanceId)));
      return true;
    }
    throw new HttpFailure(404, 'NOT_FOUND');
  }
  drain() {
    return this.queue.drain();
  }
}
