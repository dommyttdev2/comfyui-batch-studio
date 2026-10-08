import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpFailure } from './http.js';
export function webStatic(root: string) {
  return async (request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> => {
    if (url.pathname.startsWith('/api/')) return false;
    if (request.method !== 'GET' && request.method !== 'HEAD')
      throw new HttpFailure(405, 'METHOD_NOT_ALLOWED');
    let relative: string;
    if (url.pathname === '/') relative = 'index.html';
    else if (/^\/assets\/[a-zA-Z0-9_.-]+\.(js|css)$/.test(url.pathname))
      relative = url.pathname.slice(1);
    else throw new HttpFailure(404, 'WEB_NOT_FOUND');
    const file = path.join(root, relative);
    try {
      if ((await realpath(file)) !== file) throw new HttpFailure(403, 'WEB_ESCAPE');
      const info = await stat(file);
      if (!info.isFile() || info.size > 8 * 1024 * 1024)
        throw new HttpFailure(404, 'WEB_NOT_FOUND');
      const bytes = await readFile(file);
      response.setHeader(
        'Content-Type',
        relative.endsWith('.js')
          ? 'text/javascript'
          : relative.endsWith('.css')
            ? 'text/css'
            : 'text/html; charset=utf-8',
      );
      response.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      );
      response.setHeader('Content-Length', bytes.length);
      response.statusCode = 200;
      response.end(request.method === 'HEAD' ? undefined : bytes);
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT')
        throw new HttpFailure(503, 'WEB_BUILD_REQUIRED');
      throw e;
    }
  };
}
