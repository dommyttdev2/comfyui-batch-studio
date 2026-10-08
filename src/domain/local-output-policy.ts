import type { ExecutionRun } from './artifact-types.js';
import type { ApiGraph } from './workflow-graph.js';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
export const LOCAL_FILE_SCOPE = 'local-generated-file';
export function localRunOutputRelative(run: ExecutionRun) {
  if (!/^[A-Za-z0-9_-]+$/.test(run.projectId) || !/^[0-9a-f-]{36}$/i.test(run.runId))
    throw new Error('Invalid project or Run ID for isolated Local output.');
  return ['BatchStudio', run.projectId, run.runId].join('/');
}
export function isolateBranchSavePaths(graph: ApiGraph, run: ExecutionRun, branchId: string) {
  const saveNodes = Object.entries(graph).filter(([, node]) => node.class_type === 'SaveImage');
  if (!saveNodes.length) throw new Error(`Branch ${branchId} has no SaveImage output.`);
  // Alter only the submitted API graph. The Compiler snapshot and the user's
  // legacy output folders remain untouched.
  for (const [, node] of saveNodes)
    node.inputs.filename_prefix = [
      localRunOutputRelative(run),
      encodeURIComponent(branchId),
      encodeURIComponent(node._meta!.batchStudio!.leafId),
    ].join('/');
  return saveNodes.map(([id]) => id);
}
export function promptOutputReferences(history: any, promptId: string, saveNodeIds: string[]) {
  const entry = history?.[promptId];
  const images = saveNodeIds.flatMap((id) => entry?.outputs?.[id]?.images ?? []);
  if (images.length !== 1)
    throw new Error(`ComfyUI prompt ${promptId} must return exactly one SaveImage file.`);
  for (const image of images) {
    if (
      image?.type !== 'output' ||
      typeof image.filename !== 'string' ||
      /[\\/]/.test(image.filename) ||
      typeof image.subfolder !== 'string' ||
      !IMAGE_EXTENSIONS.has(image.filename.slice(image.filename.lastIndexOf('.')).toLowerCase())
    )
      throw new Error(`ComfyUI prompt ${promptId} returned an invalid image reference.`);
  }
  return images as { filename: string; subfolder: string; type: 'output' }[];
}
