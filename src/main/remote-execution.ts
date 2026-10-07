import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRemoteExecutionRuntime } from '../application/remote-execution-runtime.js';
import {
  getExecutionRun,
  mutateExecutionRun,
  readExecutionWorkflow,
  recordExecutionEvidence,
} from './execution-run.js';
import { exists, readJson } from './fs-utils.js';
import { readProjectMeta } from './project-meta.js';
import { R2_SINGLE_PUT_LIMIT, type R2Manager } from './r2-manager.js';
import type { RemoteControlPlane } from './remote-control-plane.js';
import { hashCanonicalJson } from './workflow-api.js';

async function sha256File(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export class RemoteExecutionService {
  private readonly runtime: ReturnType<typeof createRemoteExecutionRuntime>;
  constructor(
    remote: RemoteControlPlane,
    r2: R2Manager,
    onSettled?: (root: string, runId: string) => Promise<void>,
  ) {
    this.runtime = createRemoteExecutionRuntime(
      {
        load: getExecutionRun,
        mutate: mutateExecutionRun,
        workflow: readExecutionWorkflow,
        evidence: recordExecutionEvidence,
        settings: async (root) => {
          const meta = await readProjectMeta(root);
          return {
            r2Bucket:
              (process.env.BATCH_STUDIO_R2_BUCKET ?? '').trim() ||
              meta?.settings.r2Bucket?.trim() ||
              '',
            artifactOutputPath: meta?.settings.artifactOutputPath?.trim() || root,
          };
        },
        join: path.join,
        exists,
        stat,
        readText: (id, encoding) => readFile(id, encoding),
        readJson,
        writeText: writeFile,
        mkdir,
        remove: rm,
        rename,
        hashFile: sha256File,
        hashText: (value) => createHash('sha256').update(value).digest('hex'),
        hashValue: hashCanonicalJson,
        now: () => ({ ticks: Date.now(), iso: new Date().toISOString() }),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        singlePutLimit: R2_SINGLE_PUT_LIMIT,
      },
      remote,
      r2,
      onSettled,
    );
  }
  start(root: string, runId: string) {
    return this.runtime.start(root, runId);
  }
  recover(root: string, runId: string) {
    return this.runtime.recover(root, runId);
  }
  waitForSettled(runId: string) {
    return this.runtime.waitForSettled(runId);
  }
  forceInterrupt(root: string, runId: string) {
    return this.runtime.forceInterrupt(root, runId);
  }
  stopScheduling(root: string, runId: string) {
    return this.runtime.stopScheduling(root, runId);
  }
  beginDiscard(runId: string) {
    return this.runtime.beginDiscard(runId);
  }
  endDiscard(runId: string) {
    return this.runtime.endDiscard(runId);
  }
  discardArtifacts(root: string, runId: string) {
    return this.runtime.discardArtifacts(root, runId);
  }
}
