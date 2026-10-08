import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import type { ActorContext, Permission } from '../domain/contracts.js';
import {
  fields,
  HttpFailure,
  identifier,
  json,
  object,
  readJson,
  type HttpOptions,
} from './http.js';

export interface Principal {
  userId: string;
  tokenHash: string;
  projectIds: string[];
  permissions: Permission[];
}
type Session = {
  publicId: string;
  principal: Principal;
  fingerprint: string;
  csrf: string;
  expiresAt: number;
};
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function equal(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export class Security {
  private origin = '';
  private readonly sessions = new Map<string, Session>();
  private readonly attempts = new Map<string, { count: number; until: number }>();
  constructor(
    private readonly dataDir: string,
    private readonly now = Date.now,
    private readonly ttl = 30 * 60_000,
  ) {}
  setOrigin(origin: string): void {
    this.origin = origin;
  }
  async initialize(): Promise<void> {
    await this.principals();
  }
  private async principals(): Promise<Principal[]> {
    try {
      const file = path.join(this.dataDir, 'auth.json');
      const info = await stat(file);
      if (info.size > 64 * 1024 || (process.platform !== 'win32' && (info.mode & 0o077) !== 0))
        throw new Error('Unsafe auth file.');
      const value = object(JSON.parse(await readFile(file, 'utf8')));
      fields(value, ['schema', 'principals']);
      if (
        value.schema !== 'web-auth/1' ||
        !Array.isArray(value.principals) ||
        value.principals.length === 0 ||
        value.principals.length > 100
      )
        throw new Error('Invalid auth file.');
      const seen = new Set<string>();
      return value.principals.map((raw) => {
        const p = object(raw);
        fields(p, ['userId', 'tokenHash', 'projectIds', 'permissions']);
        const userId = identifier(p.userId);
        if (seen.has(userId)) throw new Error('Duplicate principal.');
        seen.add(userId);
        if (
          typeof p.tokenHash !== 'string' ||
          !/^[a-f0-9]{64}$/.test(p.tokenHash) ||
          !Array.isArray(p.projectIds) ||
          !Array.isArray(p.permissions)
        )
          throw new Error('Invalid principal.');
        const projectIds = p.projectIds.map(identifier);
        if (!p.permissions.every((v) => ['read', 'edit', 'execute', 'admin'].includes(v)))
          throw new Error('Invalid permissions.');
        return {
          userId,
          tokenHash: p.tokenHash,
          projectIds,
          permissions: p.permissions as Permission[],
        };
      });
    } catch {
      throw new HttpFailure(503, 'AUTH_UNAVAILABLE');
    }
  }
  boundary = (request: IncomingMessage): void => {
    const expected = new URL(this.origin);
    if (request.headers.host !== expected.host) throw new HttpFailure(403, 'HOST_REJECTED');
    if (request.headers.origin !== undefined && request.headers.origin !== this.origin)
      throw new HttpFailure(403, 'ORIGIN_REJECTED');
    for (const name of [
      'host',
      'origin',
      'authorization',
      'x-csrf-token',
      'x-request-id',
      'x-batch-build-id',
      'x-batch-api-version',
    ]) {
      if (
        request.rawHeaders.filter((value, i) => i % 2 === 0 && value.toLowerCase() === name)
          .length > 1
      )
        throw new HttpFailure(400, 'DUPLICATE_HEADER');
    }
  };
  authenticate = async (
    request: IncomingMessage,
    mutation: boolean,
  ): Promise<Omit<ActorContext, 'requestId'>> => {
    this.boundary(request);
    const cookies = (request.headers.cookie ?? '')
      .split(';')
      .map((v) => v.trim())
      .filter((v) => v.startsWith('batch_session='));
    if (cookies.length !== 1) throw new HttpFailure(401, 'UNAUTHENTICATED');
    const sessionId = cookies[0].slice('batch_session='.length);
    const session = this.sessions.get(sessionId);
    if (!session || session.expiresAt <= this.now()) {
      this.sessions.delete(sessionId);
      throw new HttpFailure(401, 'SESSION_EXPIRED');
    }
    const principal = (await this.principals()).find((p) => p.userId === session.principal.userId);
    if (!principal || hash(JSON.stringify(principal)) !== session.fingerprint) {
      this.sessions.delete(sessionId);
      throw new HttpFailure(401, 'SESSION_REVOKED');
    }
    if (
      mutation &&
      (request.headers.origin !== this.origin ||
        typeof request.headers['x-csrf-token'] !== 'string' ||
        !equal(request.headers['x-csrf-token'], session.csrf))
    )
      throw new HttpFailure(403, 'CSRF_REJECTED');
    return {
      userId: principal.userId,
      sessionId: session.publicId,
      projectIds: principal.projectIds,
      permissions: principal.permissions,
    };
  };
  http(): HttpOptions {
    return {
      boundary: this.boundary,
      authenticate: this.authenticate,
      publicRoute: async (request, response, url) => {
        if (url.pathname === '/api/v1/logout' && request.method === 'POST') {
          await this.authenticate(request, true);
          fields(await readJson(request, 4096), []);
          const cookie = request.headers.cookie!;
          const credential = cookie
            .split(';')
            .map((c) => c.trim())
            .find((c) => c.startsWith('batch_session='))!
            .slice('batch_session='.length);
          this.sessions.delete(credential);
          response.setHeader(
            'Set-Cookie',
            'batch_session=; HttpOnly; SameSite=Strict; Path=/api/v1; Max-Age=0',
          );
          json(response, 200, { loggedOut: true });
          return true;
        }
        if (url.pathname !== '/api/v1/session' || request.method !== 'POST') return false;
        if (request.headers.origin !== this.origin) throw new HttpFailure(403, 'ORIGIN_REJECTED');
        fields(await readJson(request, 4096), []);
        const key = request.socket.remoteAddress ?? 'unknown';
        const attempt = this.attempts.get(key);
        if (attempt && attempt.until > this.now() && attempt.count >= 5)
          throw new HttpFailure(429, 'LOGIN_RATE_LIMIT');
        // The server is loopback-only, so this map has at most the two loopback addresses.
        this.attempts.set(key, {
          count: attempt && attempt.until > this.now() ? attempt.count + 1 : 1,
          until: attempt && attempt.until > this.now() ? attempt.until : this.now() + 60_000,
        });
        const bearer = request.headers.authorization;
        if (typeof bearer !== 'string' || !/^Bearer [a-zA-Z0-9_-]{32,128}$/.test(bearer))
          throw new HttpFailure(401, 'UNAUTHENTICATED');
        const tokenHash = hash(bearer.slice(7));
        const principal = (await this.principals()).find((p) => equal(p.tokenHash, tokenHash));
        if (!principal) throw new HttpFailure(401, 'UNAUTHENTICATED');
        for (const [id, s] of this.sessions)
          if (s.expiresAt <= this.now()) this.sessions.delete(id);
        if (this.sessions.size >= 100) throw new HttpFailure(429, 'SESSION_LIMIT');
        this.attempts.delete(key);
        const sessionId = randomBytes(32).toString('hex');
        const csrf = randomBytes(32).toString('hex');
        this.sessions.set(sessionId, {
          publicId: randomUUID(),
          principal,
          fingerprint: hash(JSON.stringify(principal)),
          csrf,
          expiresAt: this.now() + this.ttl,
        });
        response.setHeader(
          'Set-Cookie',
          `batch_session=${sessionId}; HttpOnly; SameSite=Strict; Path=/api/v1; Max-Age=${Math.ceil(this.ttl / 1000)}`,
        );
        json(response, 200, {
          userId: principal.userId,
          projectIds: principal.projectIds,
          permissions: principal.permissions,
          csrfToken: csrf,
          expiresAt: this.now() + this.ttl,
        });
        return true;
      },
    };
  }
}
