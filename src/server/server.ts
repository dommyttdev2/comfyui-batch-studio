import { createServer } from 'node:http';
import type { ServerConfig } from './config.js';
import { createHttpHandler, type HttpOptions } from './http.js';

export async function startServer(config: ServerConfig, options: HttpOptions = {}) {
  const handler = createHttpHandler(config, options);
  const pending = new Set<Promise<void>>();
  const server = createServer((request, response) => {
    const work = handler(request, response);
    pending.add(work);
    void work.finally(() => pending.delete(work)).catch(() => response.destroy());
  });
  let closing: Promise<void> | undefined;
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Server address unavailable.');
  return {
    server,
    origin: `http://${config.host === '::1' ? '[::1]' : config.host}:${address.port}`,
    drainRequests: async () => {
      await Promise.allSettled([...pending]);
    },
    close: () =>
      (closing ??= new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )),
  };
}
