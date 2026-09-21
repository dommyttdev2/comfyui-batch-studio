import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { GrokTask } from '../shared/types.js';
import { internalDir } from './artifact-service.js';
import { readJson, readText, writeJsonAtomic, writeTextAtomic } from './fs-utils.js';

type Stage = GrokTask['stage'];
type WorkspaceRecord = {
  workspaceId: string;
  stage: Stage;
  threadId: string;
  turnId: string;
};
type Index = { schemaVersion: 1; records: WorkspaceRecord[] };
export type FileArtifactWorkspace = {
  workspaceId: string;
  directory: string;
  outputPath: string;
  fileName: string;
  stage: Stage;
};
const MAX_REFERENCE_BYTES = 12_000_000;
const MAX_OUTPUT_BYTES = 10_000_000;
const FILES: Partial<Record<Stage, string>> = {
  'story-finalize': 'story.md',
  'story-fix': 'story.md',
  models: 'model_loras.json',
  'models-fix': 'model_loras.json',
  'prompt-plan': 'prompt_plan.json',
  'prompt-plan-fix': 'prompt_plan.json',
  'prompt-plan-patch': 'prompt_plan_patch.json',
  caption: 'caption_content.json',
};
const safeId = (id: string) => /^[0-9a-f-]{36}$/i.test(id);
function workspaceBase(userData: string) {
  return path.join(userData, 'batch-studio-codex-workspaces');
}
function indexPath(root: string) {
  return path.join(internalDir(root), 'codex-file-artifacts.json');
}
export function workspaceFor(
  userData: string,
  stage: Stage,
  workspaceId: string,
): FileArtifactWorkspace {
  const fileName = FILES[stage];
  if (!fileName || !safeId(workspaceId)) throw new Error('Codex作業領域が不正です。');
  const directory = path.join(workspaceBase(userData), workspaceId);
  return {
    workspaceId,
    directory,
    outputPath: path.join(directory, 'output', fileName),
    fileName,
    stage,
  };
}
export async function prepareCodexFileWorkspace(
  userData: string,
  stage: Stage,
  references: Array<{ name: string; content: string }>,
): Promise<FileArtifactWorkspace> {
  const workspace = workspaceFor(userData, stage, randomUUID());
  await mkdir(path.join(workspace.directory, 'input'), { recursive: true });
  await mkdir(path.join(workspace.directory, 'output'), { recursive: true });
  let total = 0;
  const used = new Set<string>();
  for (const [index, reference] of references.entries()) {
    total += Buffer.byteLength(reference.content, 'utf8');
    if (total > MAX_REFERENCE_BYTES)
      throw new Error('Codex参照ファイルの合計が12MBを超えています。');
    const clean = path.basename(reference.name).replace(/[^a-zA-Z0-9_.-]/g, '_');
    const fileName = `${index + 1}-${clean || 'reference.txt'}`;
    if (used.has(fileName)) throw new Error('参照ファイル名が重複しています。');
    used.add(fileName);
    await writeTextAtomic(path.join(workspace.directory, 'input', fileName), reference.content);
  }
  return workspace;
}
export function workspaceOutputInstruction(workspace: FileArtifactWorkspace): string {
  return [
    '## Codex向け出力契約',
    `回答の最後に ${workspace.fileName} の生成状況のみを短く報告してください。JSONやMarkdownの全文はチャットへ出力しないでください。`,
    `作業ディレクトリ内の output/${workspace.fileName} に完成した成果物をファイルとして直接書き込んでください。`,
    'input/ 内の参照ファイルは読み取り専用として扱い、変更しないでください。',
    'input/ や output/ 以外、プロジェクト本体、既存下書き、確定版ファイルを変更しないでください。',
    '既存の成果物がinput/にある場合、修正元として参照し、完成版をoutput/に別ファイルで保存してください。',
    'ファイルを書き終える前に完了と報告しないでください。書き込めない場合は理由を報告してください。',
    'Batch Studioが処理完了後にoutput/のファイルを読み込み、Schemaと内容を検証した場合だけ下書きに反映します。',
  ].join('\n');
}
async function readIndex(root: string): Promise<Index> {
  const value = await readJson<Index>(indexPath(root));
  return value?.schemaVersion === 1 && Array.isArray(value.records)
    ? value
    : { schemaVersion: 1, records: [] };
}
export async function rememberCodexWorkspace(
  root: string,
  workspace: FileArtifactWorkspace,
  threadId: string,
  turnId: string,
): Promise<void> {
  if (!threadId || !turnId) throw new Error('Codex Turn IDがありません。');
  const index = await readIndex(root);
  index.records = [
    ...index.records.filter(
      (record) => !(record.threadId === threadId && record.turnId === turnId),
    ),
    { workspaceId: workspace.workspaceId, stage: workspace.stage, threadId, turnId },
  ].slice(-300);
  await writeJsonAtomic(indexPath(root), index);
}
export async function findCodexWorkspace(
  root: string,
  userData: string,
  threadId: string,
  turnId: string,
  stage: Stage,
): Promise<FileArtifactWorkspace | null> {
  const index = await readIndex(root);
  const record = index.records.find(
    (item) => item.threadId === threadId && item.turnId === turnId && item.stage === stage,
  );
  return record && safeId(record.workspaceId)
    ? workspaceFor(userData, stage, record.workspaceId)
    : null;
}
export async function readCodexOutput(workspace: FileArtifactWorkspace): Promise<string> {
  let stat;
  try {
    stat = await lstat(workspace.outputPath);
  } catch {
    throw new Error(
      `Codexが output/${workspace.fileName} を生成しませんでした。最終回答ではなく、ファイルへ直接書き込む必要があります。`,
    );
  }
  if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || stat.size > MAX_OUTPUT_BYTES)
    throw new Error('Codex成果物が通常のファイルではない、空、または10MBを超えています。');
  const [directory, output] = await Promise.all([
    realpath(path.join(workspace.directory, 'output')),
    realpath(workspace.outputPath),
  ]);
  if (output !== path.join(directory, workspace.fileName))
    throw new Error('Codex成果物の保存先が作業領域外を指しています。');
  const content = await readFile(workspace.outputPath, 'utf8');
  if (!content.trim()) throw new Error('Codexが生成した成果物ファイルは空です。');
  return content;
}
