import { createServer } from 'node:http';
import { API_VERSION, type ServerConfig } from './config.js';

export async function startServer(config: ServerConfig) {
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Type', 'application/json');
    const health = request.method === 'GET' && request.url === '/api/v1/health';
    response.statusCode = health ? 200 : 501;
    response.end(
      JSON.stringify(
        health
          ? { apiVersion: API_VERSION, buildId: config.buildId, ready: true }
          : {
              error: {
                code: 'NOT_IMPLEMENTED',
                message: 'Operation is unavailable.',
                retryable: false,
              },
            },
      ),
    );
  });
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
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
