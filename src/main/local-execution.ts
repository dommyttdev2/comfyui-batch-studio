import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createLocalExecutionRuntime,
  type LocalComfyPort,
  type SettingsProvider,
} from '../application/local-execution-runtime.js';
import { verifyGeneratedLocalOutputs } from '../application/local-output-verification.js';
import {
  LOCAL_FILE_SCOPE,
  localRunOutputRelative,
  promptOutputReferences,
} from '../domain/local-output-policy.js';
import {
  clearCurrentGenerationTiming,
  markGenerationCompleted,
  markGenerationStarted,
} from '../shared/execution-progress.js';
import type { ExecutionError, ExecutionRun } from '../shared/types.js';
import { ComfyUiClient } from './comfyui-client.js';
import {
  getExecutionRun,
  mutateExecutionRun,
  readExecutionWorkflow,
  recordExecutionEvidence,
  validatedExecutionEvidence,
} from './execution-run.js';
import { readJson } from './fs-utils.js';
import { enumerateImageTasks, graphToWorkflow } from './image-tasks.js';
import type { ApiGraph } from './workflow-api.js';
import { hashCanonicalJson } from './workflow-api.js';

function localRunOutputRoot(installPath: string, run: ExecutionRun) {
  return path.join(installPath, 'output', ...localRunOutputRelative(run).split('/'));
}
function within(root: string, target: string) {
  const relative = path.relative(root, target);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}
async function sha256File(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function materializeOutput(
  run: ExecutionRun,
  installPath: string,
  promptId: string,
  image: { filename: string; subfolder: string },
  comfy: ComfyUiClient,
) {
  const outputBase = path.join(installPath, 'output'),
    runRoot = localRunOutputRoot(installPath, run);
  const file = path.resolve(outputBase, image.subfolder, image.filename);
  if (!within(runRoot, file))
    throw new Error(`ComfyUI prompt ${promptId} reported an image outside its Run output.`);

  // ComfyUI Desktop and --output-directory can save outside
  // <installPath>/output. A validated History reference can be fetched from
  // /view and mirrored into Batch Studio's isolated, locally verified output.
  let actualFile: string;
  try {
    actualFile = await realpath(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const imageBytes = await comfy.outputImage(image.filename, image.subfolder);
    await mkdir(path.dirname(file), { recursive: true });
    const actualRoot = await realpath(runRoot),
      actualOutputBase = await realpath(outputBase),
      actualParent = await realpath(path.dirname(file));
    if (
      !within(actualOutputBase, actualRoot) ||
      (actualParent !== actualRoot && !within(actualRoot, actualParent))
    )
      throw new Error('Generated image destination contains a symlink outside its Run output.');
    try {
      await writeFile(file, imageBytes, { flag: 'wx' });
    } catch (writeError) {
      if ((writeError as NodeJS.ErrnoException).code !== 'EEXIST') throw writeError;
    }
    actualFile = await realpath(file);
  }
  const actualRoot = await realpath(runRoot);
  if (!within(actualRoot, actualFile))
    throw new Error(`ComfyUI prompt ${promptId} reported a symlink outside its Run output.`);
  const relativePath = path.relative(runRoot, file),
    metadata = await stat(actualFile);
  return {
    relativePath,
    isFile: metadata.isFile(),
    size: metadata.size,
    sha256: await sha256File(actualFile),
  };
}
async function observeLocalOutput(installPath: string, run: ExecutionRun, relativePath: string) {
  const outputRoot = localRunOutputRoot(installPath, run),
    realRoot = await realpath(outputRoot);
  const file = path.resolve(outputRoot, relativePath);
  if (!within(outputRoot, file))
    throw new Error('Local output evidence contains an invalid file path.');
  const realFile = await realpath(file);
  if (!within(realRoot, realFile))
    throw new Error('Local output evidence points outside its Run output.');
  const metadata = await stat(realFile);
  return { isFile: metadata.isFile(), size: metadata.size, sha256: await sha256File(realFile) };
}
export async function verifyLocalOutputs(installPath: string, run: ExecutionRun) {
  const result = await verifyGeneratedLocalOutputs(run, hashCanonicalJson, (relative) =>
    observeLocalOutput(installPath, run, relative),
  );
  return { ...result, outputRoot: localRunOutputRoot(installPath, run) };
}

export class LocalExecutionService {
  private readonly runtime: ReturnType<typeof createLocalExecutionRuntime>;
  constructor(
    settingsProvider: SettingsProvider,
    clientFactory = (endpoint: string) => ({ comfy: new ComfyUiClient(endpoint) }),
  ) {
    this.runtime = createLocalExecutionRuntime(
      {
        load: getExecutionRun,
        mutate: mutateExecutionRun,
        workflow: readExecutionWorkflow,
        materializeOutput: (run, install, prompt, image, comfy) =>
          materializeOutput(run, install, prompt, image, comfy as ComfyUiClient),
        observeOutput: observeLocalOutput,
        evidence: recordExecutionEvidence,
        now: () => ({ ticks: Date.now(), iso: new Date().toISOString() }),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        nextId: randomUUID,
        hashValue: hashCanonicalJson,
        hash: (value) => createHash('sha256').update(value).digest('hex'),
      },
      settingsProvider,
      clientFactory,
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
}
