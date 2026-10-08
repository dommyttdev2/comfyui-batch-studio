import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { type ActorContext, authorize } from '../domain/contracts.js';
import type { ServerConfig } from './config.js';
import { fields, HttpFailure, identifier, object } from './http.js';
import { publicJob, type PublicJob } from './jobs.js';
import type { Security } from './security.js';
import { atomicJson, SerialQueue } from './storage.js';

export interface JobEvent {
  type: 'job.changed';
  sequence: number;
  projectId: string;
  stage: string;
  provider: string;
  sessionId: string;
  turnId: string;
  jobId: string;
  job: PublicJob;
}
type Sink = (packet: unknown) => boolean;
function validateJob(job: PublicJob): void {
  fields(object(job), [
    'id',
    'projectId',
    'kind',
    'state',
    'stage',
    'provider',
    'sessionId',
    'turnId',
    'progress',
    'revision',
  ]);
  for (const value of [
    job.id,
    job.projectId,
    job.kind,
    job.stage,
    job.provider,
    job.sessionId,
    job.turnId,
  ])
    identifier(value);
  if (
    ![
      'reserved',
      'running',
      'cancelling',
      'succeeded',
      'failed',
      'cancelled',
      'uncertain',
    ].includes(job.state) ||
    !Number.isSafeInteger(job.revision) ||
    job.revision < 0 ||
    !Number.isFinite(job.progress) ||
    job.progress < 0 ||
    job.progress > 1
  )
    throw new HttpFailure(400, 'INVALID_EVENT');
}
export class EventBroker {
  private readonly file: string;
  private readonly queue = new SerialQueue();
  private sequence = 0;
  private events: JobEvent[] = [];
  private readonly subscribers = new Map<string, { projectIds: string[]; sink: Sink }>();
  private healthy = true;
  constructor(
    dataDir: string,
    private readonly snapshots: (actor: ActorContext) => PublicJob[],
    private readonly capacity = 512,
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 4096)
      throw new Error('Invalid replay capacity.');
    this.file = path.join(dataDir, 'events.json');
  }
  async initialize(): Promise<void> {
    try {
      const value = object(JSON.parse(await readFile(this.file, 'utf8')));
      fields(value, ['schema', 'sequence', 'events']);
      if (
        value.schema !== 'web-events/1' ||
        !Number.isSafeInteger(value.sequence) ||
        (value.sequence as number) < 0 ||
        !Array.isArray(value.events) ||
        value.events.length > this.capacity
      )
        throw new HttpFailure(400, 'INVALID_EVENT_STORE');
      this.sequence = value.sequence as number;
      this.events = value.events.map((raw, index) => {
        const event = object(raw);
        fields(event, [
          'type',
          'sequence',
          'projectId',
          'stage',
          'provider',
          'sessionId',
          'turnId',
          'jobId',
          'job',
        ]);
        const job = object(event.job) as unknown as PublicJob;
        validateJob(job);
        if (
          event.type !== 'job.changed' ||
          event.sequence !== this.sequence - (value.events as unknown[]).length + index + 1 ||
          event.projectId !== job.projectId ||
          event.jobId !== job.id ||
          event.stage !== job.stage ||
          event.provider !== job.provider ||
          event.sessionId !== job.sessionId ||
          event.turnId !== job.turnId
        )
          throw new HttpFailure(400, 'INVALID_EVENT_STORE');
        return event as unknown as JobEvent;
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  append = async (job: PublicJob): Promise<void> => {
    validateJob(job);
    await this.queue.run(async () => {
      if (!this.healthy || this.sequence >= Number.MAX_SAFE_INTEGER)
        throw new HttpFailure(503, 'EVENT_UNAVAILABLE');
      const event: JobEvent = {
        type: 'job.changed',
        sequence: this.sequence + 1,
        projectId: job.projectId,
        stage: job.stage,
        provider: job.provider,
        sessionId: job.sessionId,
        turnId: job.turnId,
        jobId: job.id,
        job: publicJob(job),
      };
      const events = [...this.events, event].slice(-this.capacity);
      try {
        await atomicJson(this.file, { schema: 'web-events/1', sequence: event.sequence, events });
      } catch (error) {
        this.healthy = false;
        throw error;
      }
      this.sequence = event.sequence;
      this.events = events;
      for (const [id, client] of this.subscribers) {
        if (client.projectIds.includes(job.projectId) && !client.sink(event))
          this.subscribers.delete(id);
      }
    });
  };
  async subscribe(
    actor: ActorContext,
    projectIds: string[],
    after: number | undefined,
    sink: Sink,
  ): Promise<() => void> {
    projectIds.forEach((id) => authorize(actor, identifier(id), 'read'));
    return this.queue.run(async () => {
      if (!this.healthy) throw new HttpFailure(503, 'EVENT_UNAVAILABLE');
      const floor = this.events[0]?.sequence ?? this.sequence + 1;
      if (
        after !== undefined &&
        (!Number.isSafeInteger(after) || after < 0 || after > this.sequence || after < floor - 1)
      )
        throw new HttpFailure(409, 'REPLAY_UNAVAILABLE');
      // No await between snapshot/cursor, replay and subscriber registration.
      if (after === undefined) {
        if (
          !sink({
            type: 'snapshot',
            sequence: this.sequence,
            jobs: this.snapshots(actor)
              .filter((j) => projectIds.includes(j.projectId))
              .map(publicJob),
          })
        )
          throw new HttpFailure(429, 'SLOW_CLIENT');
      } else {
        for (const event of this.events)
          if (event.sequence > after && projectIds.includes(event.projectId) && !sink(event))
            throw new HttpFailure(429, 'SLOW_CLIENT');
        if (!sink({ type: 'replay.complete', sequence: this.sequence }))
          throw new HttpFailure(429, 'SLOW_CLIENT');
      }
      const id = randomUUID();
      this.subscribers.set(id, { projectIds, sink });
      return () => {
        this.subscribers.delete(id);
      };
    });
  }
  async drain(): Promise<void> {
    await this.queue.drain();
  }
}
export function attachEvents(
  server: Server,
  config: ServerConfig,
  security: Security,
  broker: EventBroker,
  accepting: () => boolean = () => true,
) {
  const protocol = 'batch.v1.' + config.buildId;
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 4096,
    perMessageDeflate: false,
    handleProtocols: (protocols) => (protocols.has(protocol) ? protocol : false),
  });
  let clients = 0;
  server.on('upgrade', (request, socket, head) => {
    socket.on('error', () => {});
    const open = async () => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (!accepting()) throw new HttpFailure(503, 'SERVER_DRAINING');
      if (
        url.pathname !== '/api/v1/events' ||
        (request.url?.length ?? 0) > 8192 ||
        [...url.searchParams.keys()].some((key) => !['projectId', 'after'].includes(key))
      )
        throw new HttpFailure(400, 'INVALID_INPUT');
      if (
        request.headers.origin === undefined ||
        request.headers['sec-websocket-protocol'] !== protocol
      )
        throw new HttpFailure(403, 'WS_BOUNDARY_REJECTED');
      const actor: ActorContext = {
        ...(await security.authenticate(request, false)),
        requestId: randomUUID(),
      };
      const projectIds = [...new Set(url.searchParams.getAll('projectId').map(identifier))];
      if (projectIds.length === 0 || projectIds.length > 100 || clients >= 100)
        throw new HttpFailure(429, 'SUBSCRIPTION_LIMIT');
      projectIds.forEach((id) => authorize(actor, id, 'read'));
      const cursors = url.searchParams.getAll('after');
      if (cursors.length > 1 || (cursors[0] !== undefined && !/^\d{1,16}$/.test(cursors[0])))
        throw new HttpFailure(400, 'INVALID_INPUT');
      const after = cursors[0] === undefined ? undefined : Number(cursors[0]);
      wss.handleUpgrade(request, socket, head, (ws) => {
        clients++;
        let off: (() => void) | undefined;
        let closed = false;
        const outgoing = new SerialQueue();
        let queuedBytes = 0;
        const sink: Sink = (packet) => {
          const encoded = JSON.stringify(packet);
          const bytes = Buffer.byteLength(encoded);
          if (
            ws.readyState !== WebSocket.OPEN ||
            queuedBytes + bytes + ws.bufferedAmount > 256 * 1024
          ) {
            ws.terminate();
            return false;
          }
          queuedBytes += bytes;
          void outgoing
            .run(async () => {
              try {
                await security.authenticate(request, false);
                if (ws.readyState === WebSocket.OPEN)
                  await new Promise<void>((resolve, reject) =>
                    ws.send(encoded, (error) => (error ? reject(error) : resolve())),
                  );
              } finally {
                queuedBytes -= bytes;
              }
            })
            .catch(() => ws.close(1008, 'Session unavailable.'));
          return true;
        };
        ws.on('error', () => ws.terminate());
        // Client messages cannot run commands; use the authenticated HTTP API.
        ws.on('message', () => ws.close(1008, 'Client commands are not supported.'));
        const timer = setInterval(() => {
          void security
            .authenticate(request, false)
            .catch(() => ws.close(1008, 'Session unavailable.'));
          if (ws.bufferedAmount > 256 * 1024) ws.terminate();
          else ws.ping();
        }, 1000);
        timer.unref();
        ws.once('close', () => {
          closed = true;
          clients--;
          clearInterval(timer);
          off?.();
        });
        void broker
          .subscribe(actor, projectIds, after, sink)
          .then((unsubscribe) => {
            off = unsubscribe;
            if (closed) off();
          })
          .catch((error) => {
            sink({
              type: 'error',
              code: error instanceof HttpFailure ? error.code : 'EVENT_UNAVAILABLE',
            });
            ws.close(1008, 'Subscription rejected.');
          });
      });
    };
    void open().catch((error) => {
      const status = error instanceof HttpFailure ? error.status : 403;
      socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    });
  });
  return {
    close: async () => {
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
