import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ActorContext } from '../domain/contracts.js';
import { HttpFailure, identifier, fields, object, json, type RequestContext } from './http.js';
import { ProjectRegistry } from './ownership.js';
import { atomicJson, SerialQueue } from './storage.js';
export interface RootRecord {
  id: string;
  name: string;
  root: string;
}
interface Intent {
  id: string;
  operation: string;
  hash: string;
  user: string;
  rootId: string;
  directory: string;
  name: string;
  mode: 'create' | 'register';
  state: 'reserved' | 'done';
  tokenHash: string;
}
const fingerprint = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function segment(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[\p{L}\p{N}_ -]{1,64}$/u.test(value) ||
    /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(value) ||
    /[ .]$/.test(value)
  )
    throw new HttpFailure(400, 'INVALID_DIRECTORY');
  return value;
}
export async function roots(dataDir: string): Promise<RootRecord[]> {
  try {
    const v = object(JSON.parse(await readFile(path.join(dataDir, 'project-roots.json'), 'utf8')));
    fields(v, ['schema', 'roots']);
    if (v.schema !== 'web-project-roots/1' || !Array.isArray(v.roots))
      throw new HttpFailure(400, 'INVALID_ROOT_STORE');
    return v.roots.map((raw) => {
      const r = object(raw);
      fields(r, ['id', 'name', 'root']);
      identifier(r.id);
      if (typeof r.name !== 'string' || typeof r.root !== 'string' || !path.isAbsolute(r.root))
        throw new HttpFailure(400, 'INVALID_ROOT_STORE');
      return r as unknown as RootRecord;
    });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}
export class ProjectRegistration {
  readonly registry: ProjectRegistry;
  private readonly queue = new SerialQueue();
  constructor(readonly dataDir: string) {
    this.registry = new ProjectRegistry(dataDir);
  }
  private async intents(): Promise<Intent[]> {
    try {
      const v = object(
        JSON.parse(await readFile(path.join(this.dataDir, 'provisioning.json'), 'utf8')),
      );
      if (v.schema !== 'web-project-provisioning/1' || !Array.isArray(v.intents))
        throw new HttpFailure(400, 'INVALID_PROVISION_STORE');
      return v.intents.map((raw) => {
        const i = object(raw);
        fields(i, [
          'id',
          'operation',
          'hash',
          'user',
          'rootId',
          'directory',
          'name',
          'mode',
          'state',
          'tokenHash',
        ]);
        for (const k of ['id', 'operation', 'user', 'rootId']) identifier(i[k]);
        segment(i.directory);
        if (
          !['create', 'register'].includes(String(i.mode)) ||
          !['reserved', 'done'].includes(String(i.state)) ||
          typeof i.name !== 'string' ||
          !/^([a-f0-9]{64})$/.test(String(i.hash)) ||
          !/^([a-f0-9]{64})$/.test(String(i.tokenHash))
        )
          throw new HttpFailure(400, 'INVALID_PROVISION_STORE');
        return i as unknown as Intent;
      });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
  }
  private save(intents: Intent[]) {
    return atomicJson(path.join(this.dataDir, 'provisioning.json'), {
      schema: 'web-project-provisioning/1',
      intents,
    });
  }
  async target(rootId: string, directory: string): Promise<string> {
    const root = (await roots(this.dataDir)).find((r) => r.id === rootId);
    if (!root) throw new HttpFailure(404, 'ROOT_NOT_FOUND');
    if ((await realpath(root.root)) !== root.root) throw new HttpFailure(409, 'ROOT_CHANGED');
    const target = path.join(root.root, segment(directory));
    try {
      if ((await realpath(target)) !== target) throw new HttpFailure(409, 'ROOT_CHANGED');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    return target;
  }
  async initialize(): Promise<void> {
    await this.queue.run(async () => {
      const list = await this.intents();
      for (const i of list) if (i.state === 'reserved') await this.complete(i, list);
    });
  }
  private async complete(i: Intent, list: Intent[]): Promise<void> {
    const target = await this.target(i.rootId, i.directory);
    if (i.mode === 'create') {
      let created = false;
      try {
        await mkdir(target, { mode: 0o700 });
        created = true;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      }
      const marker = path.join(target, '.web-project-provision.json');
      if (created)
        await writeFile(marker, JSON.stringify({ id: i.id, operation: i.operation }), {
          flag: 'wx',
          mode: 0o600,
        });
      const owner = JSON.parse(await readFile(marker, 'utf8'));
      if (owner.id !== i.id || owner.operation !== i.operation)
        throw new HttpFailure(409, 'PROVISION_UNCERTAIN');
      const file = path.join(target, 'web-project.json');
      try {
        const v = JSON.parse(await readFile(file, 'utf8'));
        if (v.schema !== 'web-project-store/1' || v.project.id !== i.id)
          throw new HttpFailure(409, 'PROVISION_UNCERTAIN');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        await atomicJson(file, {
          schema: 'web-project-store/1',
          project: {
            schema: 'web-project/1',
            id: i.id,
            revision: 0,
            lease: null,
            artifacts: {},
            drafts: {},
            runs: [],
          },
          confirmations: [],
          operations: [],
          outbox: [],
          delivery: 0,
        });
      }
    } else {
      const v = JSON.parse(await readFile(path.join(target, 'web-project.json'), 'utf8'));
      if (
        v.schema !== 'web-project-store/1' ||
        v.project?.schema !== 'web-project/1' ||
        v.project.id !== i.id
      )
        throw new HttpFailure(400, 'INVALID_PROJECT_STORE');
    }
    const file = path.join(this.dataDir, 'auth.json');
    const auth = JSON.parse(await readFile(file, 'utf8'));
    const principal = auth.principals.find((p: { userId: string }) => p.userId === i.user);
    if (auth.schema !== 'web-auth/1' || !principal || principal.tokenHash !== i.tokenHash)
      throw new HttpFailure(409, 'PROVISION_UNCERTAIN');
    if (!principal.projectIds.includes(i.id)) {
      principal.projectIds.push(i.id);
      await atomicJson(file, auth);
    }
    const actor: ActorContext = {
      userId: i.user,
      sessionId: 'provisioning',
      requestId: i.operation,
      projectIds: [i.id],
      permissions: ['admin', 'read'],
    };
    const id = await this.registry.register(actor, i.id, target);
    if (id !== i.id) throw new HttpFailure(409, 'PROVISION_UNCERTAIN');
    i.state = 'done';
    await this.save(list);
  }
  async provision(
    actor: ActorContext,
    operation: string,
    input: Record<string, unknown>,
    mode: 'create' | 'register',
  ) {
    if (!actor.permissions.includes('admin')) throw new HttpFailure(403, 'FORBIDDEN');
    fields(input, ['rootId', 'directoryName', 'displayName']);
    const rootId = identifier(input.rootId);
    const directory = segment(input.directoryName);
    const name = String(input.displayName ?? directory);
    if (!name.trim() || name.length > 128) throw new HttpFailure(400, 'INVALID_INPUT');
    return this.queue.run(async () => {
      const list = await this.intents();
      const hash = fingerprint({ mode, rootId, directory, name });
      let i = list.find((j) => j.operation === operation && j.user === actor.userId);
      if (i) {
        if (i.hash !== hash) throw new HttpFailure(409, 'OPERATION_KEY_CONFLICT');
      } else {
        if (list.length >= 10000) throw new HttpFailure(503, 'STORAGE_LIMIT');
        if (list.some((j) => j.state === 'reserved'))
          throw new HttpFailure(409, 'PROVISION_UNCERTAIN');
        const target = await this.target(rootId, directory);
        let id: string = randomUUID();
        if (mode === 'create') {
          try {
            await stat(target);
            throw new HttpFailure(409, 'DIRECTORY_EXISTS');
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
          }
        } else {
          const v = JSON.parse(await readFile(path.join(target, 'web-project.json'), 'utf8'));
          if (v.schema !== 'web-project-store/1' || v.project?.schema !== 'web-project/1')
            throw new HttpFailure(400, 'INVALID_PROJECT_STORE');
          id = identifier(v.project.id);
        }
        const auth = JSON.parse(await readFile(path.join(this.dataDir, 'auth.json'), 'utf8'));
        const principal = auth.principals.find(
          (p: { userId: string }) => p.userId === actor.userId,
        );
        if (!principal) throw new HttpFailure(403, 'FORBIDDEN');
        i = {
          id,
          operation,
          hash,
          user: actor.userId,
          rootId,
          directory,
          name,
          mode,
          state: 'reserved',
          tokenHash: principal.tokenHash,
        };
        list.push(i);
        await this.save(list);
      }
      if (i.state !== 'done') await this.complete(i, list);
      return { id: i.id, displayName: i.name, reauthenticationRequired: true };
    });
  }
  async list(actor: ActorContext) {
    const records = await this.registry.records();
    const intents = await this.intents();
    return records
      .filter((r) => actor.projectIds.includes(r.id))
      .filter((r) => !intents.some((i) => i.id === r.id && i.state !== 'done'))
      .map((r) => ({ id: r.id, displayName: intents.find((i) => i.id === r.id)?.name ?? r.id }));
  }
  async route(ctx: RequestContext): Promise<boolean> {
    const { url, request, response, actor, input } = ctx;
    if (url.pathname === '/api/v1/project-roots' && request.method === 'GET') {
      if (!actor.permissions.includes('admin')) throw new HttpFailure(403, 'FORBIDDEN');
      json(response, 200, {
        roots: (await roots(this.dataDir)).map(({ id, name }) => ({ id, displayName: name })),
      });
      return true;
    }
    if (url.pathname === '/api/v1/projects' && request.method === 'GET') {
      if (!actor.permissions.includes('read')) throw new HttpFailure(403, 'FORBIDDEN');
      json(response, 200, { projects: await this.list(actor) });
      return true;
    }
    if (
      ['/api/v1/projects', '/api/v1/projects/register'].includes(url.pathname) &&
      request.method === 'POST'
    ) {
      json(response, 201, {
        project: await this.provision(
          actor,
          identifier(request.headers['idempotency-key']),
          input,
          url.pathname.endsWith('register') ? 'register' : 'create',
        ),
      });
      return true;
    }
    return false;
  }
}
