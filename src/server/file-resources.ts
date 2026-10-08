import { createHash } from 'node:crypto';
import { lstat, open, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { ActorContext } from '../domain/contracts.js';
import { authorize } from '../domain/contracts.js';
import { fields, HttpFailure, identifier, json, object, type RequestContext } from './http.js';
import { atomicJson } from './storage.js';

type Resource = {
  id: string;
  root: string;
  file: string;
  projectIds: string[];
  size: number;
  sha256: string;
  dev: number;
  ino: number;
  mtimeMs: number;
  ctimeMs: number;
};
type Store = { schema: 'web-files/1'; resources: Resource[] };
function within(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return (
    relative !== '' &&
    !relative.startsWith('..' + path.sep) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  );
}
export class FileResources {
  private resources: Resource[] = [];
  private initialized = false;
  private registered = false;
  private readonly store: string;
  constructor(private readonly dataDir: string) {
    this.store = path.join(dataDir, 'files.json');
  }
  async initialize(): Promise<void> {
    let info;
    try {
      info = await lstat(this.store);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        this.initialized = true;
        return;
      }
      throw e;
    }
    try {
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.size > 128 * 1024 ||
        (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
      )
        throw new Error('Invalid store');
      const raw = object(JSON.parse(await readFile(this.store, 'utf8')));
      fields(raw, ['schema', 'resources']);
      if (
        raw.schema !== 'web-files/1' ||
        !Array.isArray(raw.resources) ||
        raw.resources.length > 128
      )
        throw new Error('Invalid store');
      const ids = new Set();
      this.resources = raw.resources.map((value): Resource => {
        const r = object(value);
        fields(r, [
          'id',
          'root',
          'file',
          'projectIds',
          'size',
          'sha256',
          'dev',
          'ino',
          'mtimeMs',
          'ctimeMs',
        ]);
        identifier(r.id);
        if (
          ids.has(r.id) ||
          typeof r.root !== 'string' ||
          typeof r.file !== 'string' ||
          !path.isAbsolute(r.root) ||
          !path.isAbsolute(r.file) ||
          !within(r.root, r.file) ||
          !Array.isArray(r.projectIds) ||
          !r.projectIds.length ||
          r.projectIds.length > 100 ||
          typeof r.sha256 !== 'string' ||
          !/^[a-f0-9]{64}$/.test(r.sha256)
        )
          throw new Error('Invalid resource');
        r.projectIds.forEach(identifier);
        for (const field of ['size', 'dev', 'ino', 'mtimeMs', 'ctimeMs'])
          if (typeof r[field] !== 'number' || !Number.isFinite(r[field]) || Number(r[field]) < 0)
            throw new Error('Invalid fingerprint');
        ids.add(r.id);
        return r as unknown as Resource;
      });
      this.initialized = this.registered = true;
    } catch {
      throw new HttpFailure(503, 'FILE_RESOURCES_UNAVAILABLE');
    }
  }
  private async verifiedHandle(root: string, file: string) {
    if (
      (await realpath(root)) !== root ||
      (await realpath(file)) !== file ||
      !within(root, file) ||
      file === this.dataDir ||
      within(this.dataDir, file) ||
      /(?:^|[\\/])\.(?:aws|codex|grok|ssh|agents)(?:[\\/]|$)/i.test(file)
    )
      throw new HttpFailure(403, 'RESOURCE_REJECTED');
    const before = await lstat(file);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1)
      throw new HttpFailure(403, 'RESOURCE_CHANGED');
    const handle = await open(file, 'r');
    const stat = await handle.stat();
    if (stat.ino !== before.ino || stat.dev !== before.dev || stat.nlink !== 1) {
      await handle.close();
      throw new HttpFailure(403, 'RESOURCE_CHANGED');
    }
    return handle;
  }
  async register(input: {
    id: string;
    root: string;
    file: string;
    projectIds: string[];
  }): Promise<void> {
    if (
      !this.initialized ||
      this.resources.length >= 128 ||
      this.resources.some((r) => r.id === input.id)
    )
      throw new HttpFailure(409, 'REGISTRATION_REJECTED');
    identifier(input.id);
    if (
      !path.isAbsolute(input.root) ||
      !path.isAbsolute(input.file) ||
      !Array.isArray(input.projectIds) ||
      !input.projectIds.length ||
      input.projectIds.length > 100
    )
      throw new HttpFailure(400, 'INVALID_INPUT');
    input.projectIds.forEach(identifier);
    const root = await realpath(input.root),
      file = await realpath(input.file);
    const handle = await this.verifiedHandle(root, file);
    try {
      const before = await handle.stat();
      const digest = createHash('sha256');
      const stream = handle.createReadStream({
        autoClose: false,
        highWaterMark: 1024 * 1024,
        signal: AbortSignal.timeout(30 * 60_000),
      });
      for await (const chunk of stream) digest.update(chunk);
      const after = await handle.stat();
      if (
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs
      )
        throw new HttpFailure(409, 'SOURCE_CHANGED');
      const resource: Resource = {
        id: input.id,
        root,
        file,
        projectIds: [...input.projectIds],
        size: after.size,
        sha256: digest.digest('hex'),
        dev: after.dev,
        ino: after.ino,
        mtimeMs: after.mtimeMs,
        ctimeMs: after.ctimeMs,
      };
      const store: Store = { schema: 'web-files/1', resources: [...this.resources, resource] };
      await atomicJson(this.store, store);
      this.resources = store.resources;
      this.registered = true;
    } finally {
      await handle.close();
    }
  }
  rootId(root: string) {
    return createHash('sha256').update(root).digest('hex');
  }
  roots(actor: ActorContext, projectId: string) {
    authorize(actor, projectId, 'read');
    return [
      ...new Map(
        this.resources
          .filter((r) => r.projectIds.includes(projectId))
          .map((r) => [
            this.rootId(r.root),
            { id: this.rootId(r.root), name: path.basename(r.root) },
          ]),
      ).values(),
    ];
  }
  async observe(actor: ActorContext, projectId: string, rootId: string, relative: string) {
    authorize(actor, projectId, 'read');
    const resource = this.resources.find(
      (r) =>
        r.projectIds.includes(projectId) &&
        this.rootId(r.root) === rootId &&
        r.file === path.join(r.root, ...relative.split('/')),
    );
    if (!resource) return null;
    const handle = await this.verifiedHandle(resource.root, resource.file);
    try {
      const stat = await handle.stat();
      if (
        ['size', 'dev', 'ino', 'mtimeMs', 'ctimeMs'].some(
          (field) => stat[field as keyof typeof stat] !== resource[field as keyof Resource],
        )
      )
        throw new HttpFailure(409, 'RESOURCE_CHANGED');
      return {
        id: resource.id,
        size: resource.size,
        sha256: resource.sha256,
        identity: createHash('sha256')
          .update(JSON.stringify([stat.dev, stat.ino, stat.mtimeMs, stat.ctimeMs]))
          .digest('hex'),
      };
    } finally {
      await handle.close();
    }
  }
  list(actor: ActorContext) {
    if (!actor.permissions.includes('read')) throw new HttpFailure(403, 'FORBIDDEN');
    return {
      registered: this.registered,
      resources: this.resources
        .filter((r) => r.projectIds.some((id) => actor.projectIds.includes(id)))
        .map((r) => ({ id: r.id, name: path.basename(r.file), size: r.size, sha256: r.sha256 })),
    };
  }
  async source(actor: ActorContext, id: string, projectId: string) {
    authorize(actor, projectId, 'execute');
    const r = this.resources.find(
      (r) => r.id === identifier(id) && r.projectIds.includes(projectId),
    );
    if (!r) throw new HttpFailure(404, 'NOT_FOUND');
    const handle = await this.verifiedHandle(r.root, r.file);
    try {
      const stat = await handle.stat();
      if (
        ['size', 'dev', 'ino', 'mtimeMs', 'ctimeMs'].some(
          (field) => stat[field as keyof typeof stat] !== r[field as keyof Resource],
        )
      )
        throw new HttpFailure(409, 'SOURCE_CHANGED');
    } finally {
      await handle.close();
    }
    return { file: r.file, size: r.size, sha256: r.sha256 };
  }
  route = async (ctx: RequestContext): Promise<boolean> => {
    if (ctx.url.pathname !== '/api/v1/resources/files') return false;
    if (ctx.request.method !== 'GET' || ctx.url.search)
      throw new HttpFailure(405, 'METHOD_NOT_ALLOWED');
    json(ctx.response, 200, this.list(ctx.actor));
    return true;
  };
}
