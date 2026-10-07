export type WorkerEvent =
  | { type: 'progress'; stage: string; [key: string]: unknown }
  | {
      type: 'response';
      requestId: string;
      result?: unknown;
      error?: { code: string; message: string };
    };
export type WorkerEventHandler = (event: WorkerEvent) => void | Promise<void>;
export class RemoteWorkerRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RemoteWorkerRequestError';
  }
}
