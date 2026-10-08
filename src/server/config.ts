import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const API_VERSION = '1';
export interface ServerConfig {
  host: '127.0.0.1' | '::1';
  port: number;
  dataDir: string;
  resourceDir: string;
  buildId: string;
  webBuildId: string;
  webDir: string;
}
export async function loadConfig(input: {
  host?: string;
  port?: number;
  dataDir: string;
  resourceDir?: string;
}): Promise<ServerConfig> {
  const host = input.host ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== '::1')
    throw new Error('Only loopback binding is supported.');
  const port = input.port ?? 3210;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port.');
  if (!input.dataDir || !path.isAbsolute(input.dataDir))
    throw new Error('An absolute dataDir is required.');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const resourceInput = input.resourceDir ?? root;
  if (!path.isAbsolute(resourceInput)) throw new Error('An absolute resourceDir is required.');
  const resourceDir = await realpath(resourceInput);
  for (const name of ['schemas', 'templates'])
    if (!(await stat(path.join(resourceDir, name))).isDirectory())
      throw new Error('Required resources are unavailable.');
  await mkdir(input.dataDir, { recursive: true, mode: 0o700 });
  const dataDir = await realpath(input.dataDir);
  // The generated manifest hashes core, controllers and runtime resources.
  const build = JSON.parse(await readFile(new URL('../build.json', import.meta.url), 'utf8'));
  if (!/^[a-f0-9]{64}$/.test(build.buildId)) throw new Error('Invalid build manifest.');
  const buildId = createHash('sha256').update(build.buildId).digest('hex');
  if (!/^[a-f0-9]{64}$/.test(build.webBuildId)) throw new Error('Invalid web build manifest.');
  return {
    host,
    port,
    dataDir,
    resourceDir,
    buildId,
    webBuildId: build.webBuildId,
    webDir: path.join(root, 'dist-web'),
  };
}
