import {
  assertCaptionBuildable,
  assessCaptionBuild,
  captionContentHash,
  captionRenderInputHash,
} from '../domain/caption-build-policy.js';
import { importCaptionResponse, updatePixivTitle } from '../domain/caption-import-policy.js';
import type {
  CaptionBuildInfo,
  CaptionContent,
  CaptionStatus,
  ImportResult,
  ProjectBriefInput,
} from '../domain/artifact-types.js';
import {
  renderCaption,
  validateCaptionContent,
  validatePixivTitle,
} from '../domain/caption-policy.js';
import type { FinalArtifactStatus } from '../domain/artifact-types.js';
export interface CaptionFilePorts {
  path: { join(...parts: string[]): string; resolve(file: string): string };
  readJson<T>(file: string): Promise<T | null>;
  readText(file: string): Promise<string | null>;
  writeJsonAtomic(file: string, value: unknown): Promise<void>;
  writeTextAtomic(file: string, value: string): Promise<void>;
  getFinalArtifactStatus(root: string): Promise<FinalArtifactStatus>;
  sha256(value: string): string;
  now(): string;
  nextId(): string;
}
export function createCaptionFileService(io: CaptionFilePorts) {
  const { path, readJson, writeJsonAtomic, writeTextAtomic, getFinalArtifactStatus, sha256 } = io;
  function internalDir(root: string) {
    return path.join(root, '._batch_studio');
  }

  function draftPath(root: string) {
    return path.join(internalDir(root), 'drafts', 'caption_content.json');
  }

  function buildPath(root: string) {
    return path.join(internalDir(root), 'caption-build.json');
  }

  function outputPath(root: string) {
    return path.join(root, 'caption.txt');
  }

  async function readDraft(root: string) {
    const value = await readJson<unknown>(draftPath(root));
    if (value == null)
      return {
        content: null,
        validation: {
          valid: false,
          issues: [
            {
              severity: 'error' as const,
              code: 'CAPTION_CONTENT_MISSING',
              message: 'caption_content.json の下書きがありません。',
            },
          ],
        },
      };
    const validation = validateCaptionContent(value);
    return { content: validation.valid ? (value as CaptionContent) : null, validation };
  }

  async function getCaptionStatus(root: string): Promise<CaptionStatus> {
    const finalArtifact = await getFinalArtifactStatus(root);
    const sourceDirectory = finalArtifact.directory;
    const sourceExists = finalArtifact.exists;
    const imageCount = finalArtifact.imageCount;
    const draft = await readDraft(root);
    const captionPath = outputPath(root);
    const actualCaption = await io.readText(captionPath);
    const captionExists = actualCaption !== null;
    const build = await readJson<CaptionBuildInfo>(buildPath(root));
    const brief = await readJson<ProjectBriefInput & { schemaVersion?: number }>(
      path.join(root, 'project_brief.json'),
    );
    const copyrightedCharacter = brief?.subject?.copyrightedCharacter === true;
    const { state, stale, preview } = assessCaptionBuild(
      {
        sourceDirectory: sourceDirectory ? path.resolve(sourceDirectory) : null,
        sourceExists,
        imageCount,
        content: draft.content,
        validation: draft.validation,
        actualCaption,
        build: build
          ? {
              ...build,
              sourceDirectory: build.sourceDirectory ? path.resolve(build.sourceDirectory) : '',
            }
          : null,
        copyrightedCharacter,
      },
      sha256,
    );

    return {
      state,
      sourceDirectory,
      sourceExists,
      imageCount,
      imageExtensions: finalArtifact.imageExtensions,
      content: draft.content,
      contentValidation: draft.validation,
      captionPath,
      captionExists,
      stale,
      build,
      preview,
    };
  }

  async function saveRawResponse(root: string, raw: string, provider: 'grok' | 'codex') {
    const stamp = io.now().replace(/[:.]/g, '-');
    const file = path.join(
      internalDir(root),
      provider === 'codex' ? 'codex-responses' : 'grok-responses',
      'caption',
      `${stamp}-${io.nextId()}.txt`,
    );
    await writeTextAtomic(file, raw);
  }

  async function importCaptionGrok(
    root: string,
    raw: string,
    options: { automatic?: boolean; provider?: 'grok' | 'codex' } = {},
  ): Promise<ImportResult> {
    await saveRawResponse(root, raw, options.provider ?? 'grok');
    const result = importCaptionResponse(raw);
    if (result.validation.valid)
      await writeJsonAtomic(draftPath(root), JSON.parse(result.extracted));
    return result;
  }

  async function savePixivTitle(root: string, value: unknown): Promise<CaptionStatus> {
    const draft = await readDraft(root);
    if (!draft.content) throw new Error('有効な caption_content.json の下書きがありません。');
    const next = updatePixivTitle(draft.content, value);
    await writeJsonAtomic(draftPath(root), next);
    return getCaptionStatus(root);
  }

  async function generateCaption(root: string): Promise<CaptionStatus> {
    const status = await getCaptionStatus(root);
    assertCaptionBuildable(
      {
        sourceDirectory: status.sourceDirectory,
        sourceExists: status.sourceExists,
        content: status.content,
        validation: status.contentValidation,
        imageCount: status.imageCount,
        actualCaption: null,
        build: null,
        copyrightedCharacter: false,
      },
      status.preview,
    );

    await writeTextAtomic(status.captionPath, status.preview!);
    const brief = await readJson<ProjectBriefInput>(path.join(root, 'project_brief.json'));
    const build: CaptionBuildInfo = {
      schemaVersion: 1,
      sourceDirectory: status.sourceDirectory!,
      imageCount: status.imageCount,
      contentSha256: captionContentHash(status.content!, sha256),
      renderInputSha256: captionRenderInputHash(
        status.content!,
        status.imageCount,
        path.resolve(status.sourceDirectory!),
        brief?.subject?.copyrightedCharacter === true,
        sha256,
      ),
      outputSha256: sha256(status.preview!),
      generatedAt: io.now(),
    };
    await writeJsonAtomic(buildPath(root), build);
    return getCaptionStatus(root);
  }

  return { getCaptionStatus, importCaptionGrok, savePixivTitle, generateCaption };
}
