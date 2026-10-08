import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  type ActorContext,
  authorize,
  BusinessError,
  type Permission,
  requireRevision,
} from '../domain/contracts.js';
import { API_VERSION, type ServerConfig } from './config.js';

export class HttpFailure extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}
export type JsonObject = Record<string, unknown>;
export function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new HttpFailure(400, 'INVALID_INPUT');
  return value as JsonObject;
}
export function fields(value: JsonObject, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new HttpFailure(400, 'INVALID_INPUT');
}
export function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value))
    throw new HttpFailure(400, 'INVALID_INPUT');
  return value;
}
export interface CommandController {
  permission: Permission;
  mutation?: boolean;
  validate(input: JsonObject): void;
  execute(actor: ActorContext, input: JsonObject & { projectId: string }): Promise<unknown>;
}
export interface RequestContext {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  actor: ActorContext;
  input: JsonObject;
}
export interface HttpOptions {
  commands?: ReadonlyMap<string, CommandController>;
  authenticate?: (
    request: IncomingMessage,
    mutation: boolean,
  ) => Promise<Omit<ActorContext, 'requestId'>>;
  boundary?: (request: IncomingMessage) => void;
  publicRoute?: (request: IncomingMessage, response: ServerResponse, url: URL) => Promise<boolean>;
  route?: (context: RequestContext) => Promise<boolean>;
  accepting?: () => boolean;
}
export function json(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.end(JSON.stringify(value));
}
export function failure(response: ServerResponse, error: unknown): void {
  const statuses: Partial<Record<BusinessError['code'], number>> = {
    INVALID_INPUT: 400,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    REVISION_CONFLICT: 409,
    TARGET_CHANGED: 409,
    CONFIRMATION_EXPIRED: 409,
    CONFIRMATION_REQUIRED: 409,
    LEASE_REQUIRED: 409,
    PROJECT_BUSY: 409,
    RUNTIME_BUSY: 409,
    RUNTIME_UNCERTAIN: 409,
    DEPENDENCY_UNAVAILABLE: 503,
  };
  const status =
    error instanceof HttpFailure
      ? error.status
      : error instanceof BusinessError
        ? (statuses[error.code] ?? 422)
        : 500;
  const code =
    error instanceof HttpFailure || error instanceof BusinessError ? error.code : 'INTERNAL_ERROR';
  json(response, status, {
    error: { code, message: 'Operation rejected.', retryable: status === 503 },
  });
}
export async function readJson(
  request: IncomingMessage,
  maxBytes = 64 * 1024,
): Promise<JsonObject> {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json')
    throw new HttpFailure(415, 'JSON_REQUIRED');
  const size = Number(request.headers['content-length'] ?? 0);
  if (!Number.isFinite(size) || size > maxBytes) throw new HttpFailure(413, 'BODY_TOO_LARGE');
  let bytes = 0;
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        request.removeListener('data', onData);
        request.resume();
        reject(new HttpFailure(413, 'BODY_TOO_LARGE'));
      } else chunks.push(chunk);
    };
    request.on('data', onData);
    request.once('end', resolve);
    request.once('aborted', () => reject(new HttpFailure(400, 'REQUEST_ABORTED')));
    request.once('error', reject);
  });
  try {
    return object(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))),
    );
  } catch (error) {
    if (error instanceof HttpFailure) throw error;
    throw new HttpFailure(400, 'INVALID_JSON');
  }
}
export function createHttpHandler(config: ServerConfig, options: HttpOptions = {}) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('X-Batch-Api-Version', API_VERSION);
    response.setHeader('X-Batch-Build-Id', config.buildId);
    try {
      options.boundary?.(request);
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (request.method === 'GET' && url.pathname === '/api/v1/health') {
        json(response, 200, {
          apiVersion: API_VERSION,
          buildId: config.buildId,
          ready: options.accepting?.() ?? true,
        });
        return;
      }
      if (
        request.headers['x-batch-api-version'] !== API_VERSION ||
        request.headers['x-batch-build-id'] !== config.buildId
      )
        throw new HttpFailure(409, 'BUILD_MISMATCH');
      if (
        !['GET', 'HEAD'].includes(request.method ?? '') &&
        options.accepting &&
        !options.accepting()
      )
        throw new HttpFailure(503, 'SERVER_DRAINING');
      if (options.publicRoute && (await options.publicRoute(request, response, url))) return;
      if (!options.authenticate) throw new HttpFailure(503, 'AUTH_NOT_CONFIGURED');
      const requestId = identifier(request.headers['x-request-id']);
      const mutation = !['GET', 'HEAD'].includes(request.method ?? '');
      const actor = { ...(await options.authenticate(request, mutation)), requestId };
      if (mutation && options.accepting && !options.accepting())
        throw new HttpFailure(503, 'SERVER_DRAINING');
      const input = mutation ? await readJson(request) : {};
      if (options.route && (await options.route({ request, response, url, actor, input }))) return;
      const match = /^\/api\/v1\/projects\/([a-zA-Z0-9_-]+)\/commands\/([a-z0-9-]+)$/.exec(
        url.pathname,
      );
      if (!match || request.method !== 'POST') throw new HttpFailure(501, 'NOT_IMPLEMENTED');
      const projectId = identifier(match[1]);
      const controller = options.commands?.get(match[2]);
      if (!controller) throw new HttpFailure(501, 'NOT_IMPLEMENTED');
      authorize(actor, projectId, controller.permission);
      if (Object.hasOwn(input, 'projectId')) throw new HttpFailure(400, 'INVALID_INPUT');
      if (controller.mutation) {
        requireRevision(input.expectedRevision as number);
        identifier(input.leaseId);
      }
      controller.validate(input);
      json(response, 200, { result: await controller.execute(actor, { ...input, projectId }) });
    } catch (error) {
      if (!response.writableEnded && !response.destroyed) failure(response, error);
    }
  };
}
