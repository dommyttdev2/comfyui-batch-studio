import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { ArtifactSummary, ProjectSummary } from '../shared/types.js';

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readProjectIdentity(rootPath: string): Promise<{ title: string; id: string | null }> {
  const briefPath = path.join(rootPath, 'project_brief.json');

  if (await exists(briefPath)) {
    try {
      const parsed = JSON.parse(await readFile(briefPath, 'utf8')) as {
        project?: { title?: unknown; id?: unknown };
      };
      const title = typeof parsed.project?.title === 'string' && parsed.project.title.trim()
        ? parsed.project.title.trim()
        : path.basename(rootPath);
      const id = typeof parsed.project?.id === 'string' && parsed.project.id.trim()
        ? parsed.project.id.trim()
        : null;
      return { title, id };
    } catch {
      // Phase 1 is read-only: malformed artifacts are surfaced as present, never rewritten.
    }
  }

  return { title: path.basename(rootPath), id: null };
}

export async function scanProject(rootPath: string): Promise<ProjectSummary> {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const fileNames = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  const workflowName = [...fileNames].find((name) => /^LoRA_.+\.json$/i.test(name)) ?? null;

  const artifact = (
    key: ArtifactSummary['key'],
    label: string,
    relativePath: string,
    legacy = false,
  ): ArtifactSummary => ({
    key,
    label,
    relativePath: fileNames.has(relativePath) ? relativePath : null,
    state: fileNames.has(relativePath) ? (legacy ? 'legacy' : 'present') : 'missing',
  });

  const identity = await readProjectIdentity(rootPath);

  return {
    rootPath,
    title: identity.title,
    id: identity.id,
    artifacts: [
      artifact('projectBrief', '基本設定', 'project_brief.json'),
      artifact('story', 'ストーリー', 'story.md'),
      artifact('models', 'モデル選定', 'models.json'),
      artifact('promptPlan', 'プロンプト設計', 'prompt_plan.json'),
      {
        key: 'workflow',
        label: 'ワークフロー',
        relativePath: workflowName,
        state: workflowName ? 'present' : 'missing',
      },
      artifact('legacyPromptTree', '旧 Prompt Tree', 'prompt_tree.md', true),
    ],
  };
}
