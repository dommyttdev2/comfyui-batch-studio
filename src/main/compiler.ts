import { createHash } from 'node:crypto';
import path from 'node:path';
import { compileWorkflowFiles } from '../application/workflow-file-compilation.js';
import { readJson, readText, removeIfExists, writeJsonAtomic } from './fs-utils.js';
import { readProjectMeta, saveWorkflowBuild } from './project-meta.js';
import { withProjectMutationLock } from './project-transaction.js';
import { hashCanonicalJson, hashWorkflowModelInputs } from './workflow-api.js';
import { hashWorkflowTemplate } from './workflow-template-integrity.js';
import { resolveWorkflowTemplatePaths } from './workflow-template-paths.js';
export async function compileWorkflow(root: string) {
  return withProjectMutationLock(root, () =>
    compileWorkflowFiles(
      {
        readJson,
        readText,
        removeIfExists,
        writeJsonAtomic,
        readProjectMeta,
        saveWorkflowBuild,
        hashCanonicalJson,
        hashWorkflowModelInputs,
        hashWorkflowTemplate,
        resolveWorkflowTemplatePaths,
        path,
        now: () => new Date().toISOString(),
        hashText: (raw) => createHash('sha256').update(raw).digest('hex'),
      },
      root,
    ),
  );
}
