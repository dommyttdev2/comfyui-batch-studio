import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { WorkflowUseCases } from '../application/workflow-use-cases.js';
import type { ModelCatalog, ModelFamily } from '../domain/artifact-types.js';
import { authorize, type MutationCommand } from '../domain/contracts.js';
import type { CatalogRepository } from '../application/project-ports.js';
import type { ServerConfig } from './config.js';
import type { DiskProjects } from './project-repository.js';
import { publicProject } from './project-api.js';
import { HttpFailure, fields, identifier, json, object, type RequestContext } from './http.js';
export class FixtureCatalog implements CatalogRepository {
  constructor(private readonly file?: string) {
    if (file && !path.isAbsolute(file)) throw new HttpFailure(400, 'INVALID_CATALOG_PATH');
  }
  async read(): Promise<ModelCatalog | null> {
    if (!this.file) return null;
    const info = await stat(this.file);
    if (info.size > 8 * 1024 * 1024) throw new HttpFailure(503, 'STORAGE_LIMIT');
    const v = object(JSON.parse(await readFile(this.file, 'utf8')));
    if (v.schemaVersion !== 1 || !Array.isArray(v.collections))
      throw new HttpFailure(400, 'INVALID_CATALOG');
    return v as unknown as ModelCatalog;
  }
}
export class WorkflowApi {
  readonly workflows: WorkflowUseCases;
  constructor(
    private readonly config: ServerConfig,
    private readonly repository: DiskProjects,
    readonly catalogs: FixtureCatalog,
  ) {
    this.workflows = new WorkflowUseCases(
      repository,
      catalogs,
      {
        read: async (family: ModelFamily) => {
          if (!['illustrious', 'anima'].includes(family)) return null;
          const dir = path.join(config.resourceDir, 'templates', family + '-scene-batch');
          if ((await realpath(dir)) !== dir) throw new HttpFailure(400, 'INVALID_RESOURCE');
          return {
            content: await readFile(path.join(dir, 'template.json'), 'utf8'),
            manifest: JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8')),
          };
        },
      },
      { text: (v) => createHash('sha256').update(v).digest('hex') },
      { now: Date.now },
    );
  }
  async route(ctx: RequestContext): Promise<boolean> {
    const { actor, url, input, request, response } = ctx;
    const match =
      /^\/api\/v1\/projects\/([a-zA-Z0-9_-]+)\/(workflow-status|catalog|assets\/([a-zA-Z0-9_-]+)|commands\/compile-workflow)$/.exec(
        url.pathname,
      );
    if (!match) return false;
    const projectId = identifier(match[1]);
    authorize(actor, projectId, match[2].startsWith('commands') ? 'edit' : 'read');
    if (request.method === 'GET' && match[2] === 'workflow-status') {
      json(response, 200, { status: await this.workflows.status(actor, { projectId }) });
      return true;
    }
    if (request.method === 'GET' && match[2] === 'catalog') {
      const catalog = await this.catalogs.read();
      if (!catalog) throw new HttpFailure(503, 'DEPENDENCY_UNAVAILABLE');
      json(response, 200, { catalog });
      return true;
    }
    if (request.method === 'POST' && match[2] === 'commands/compile-workflow') {
      fields(input, ['expectedRevision', 'leaseId']);
      const receipt = await this.repository.execute(
        actor,
        projectId,
        identifier(request.headers['idempotency-key']),
        { action: 'compile-workflow', ...input },
        () => this.workflows.compile(actor, { ...input, projectId } as MutationCommand),
      );
      json(response, 200, {
        project: publicProject(actor, receipt.project),
        eventDelivery: receipt.eventDelivery,
      });
      return true;
    }
    if (request.method === 'GET' && match[3]) {
      const root = await this.repository.root(projectId);
      const id = match[3];
      let file: string;
      let mime: string;
      let hash: string | undefined;
      if (['template-illustrious', 'template-anima'].includes(id)) {
        const family = id.slice(9);
        file = path.join(
          this.config.resourceDir,
          'templates',
          family + '-scene-batch',
          'template.json',
        );
        mime = 'application/json';
        hash = JSON.parse(await readFile(path.join(path.dirname(file), 'manifest.json'), 'utf8'))
          .template.sha256;
      } else {
        let manifest;
        try {
          manifest = object(JSON.parse(await readFile(path.join(root, 'web-assets.json'), 'utf8')));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT')
            throw new HttpFailure(404, 'ASSET_NOT_FOUND');
          throw error;
        }
        fields(manifest, ['schema', 'assets']);
        if (manifest.schema !== 'web-assets/1' || !Array.isArray(manifest.assets))
          throw new HttpFailure(400, 'INVALID_ASSET_STORE');
        const record = manifest.assets.map(object).find((r) => r.id === id);
        if (!record) throw new HttpFailure(404, 'ASSET_NOT_FOUND');
        fields(record, ['id', 'file', 'mime', 'sha256']);
        if (
          typeof record.file !== 'string' ||
          !['image/png', 'image/jpeg', 'image/webp', 'application/json', 'text/plain'].includes(
            String(record.mime),
          ) ||
          !/^([a-f0-9]{64})$/.test(String(record.sha256))
        )
          throw new HttpFailure(400, 'INVALID_ASSET');
        const assetRoot = path.join(root, 'assets');
        if ((await realpath(assetRoot)) !== assetRoot) throw new HttpFailure(403, 'ASSET_ESCAPE');
        file = path.resolve(root, 'assets', record.file);
        const rel = path.relative(path.join(root, 'assets'), file);
        if (rel.startsWith('..') || path.isAbsolute(rel))
          throw new HttpFailure(403, 'ASSET_ESCAPE');
        mime = String(record.mime);
        hash = String(record.sha256);
      }
      if ((await realpath(file)) !== file) throw new HttpFailure(403, 'ASSET_ESCAPE');
      const info = await stat(file);
      if (!info.isFile() || info.size > 50 * 1024 * 1024)
        throw new HttpFailure(413, 'ASSET_TOO_LARGE');
      const bytes = await readFile(file);
      const actual = createHash('sha256').update(bytes).digest('hex');
      if (actual !== hash) throw new HttpFailure(409, 'ASSET_CHANGED');
      response.statusCode = 200;
      response.setHeader('Content-Type', mime);
      response.setHeader('Cache-Control', 'private, no-store');
      response.setHeader('ETag', '"' + actual + '"');
      response.setHeader('Content-Length', bytes.length);
      response.end(bytes);
      return true;
    }
    return false;
  }
}
