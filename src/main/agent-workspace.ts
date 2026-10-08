import { expectedArtifact } from '../domain/agent-artifact-policy.js';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import type { AgentProvider, GrokTask } from '../shared/types.js';
import { internalDir } from './artifact-service.js';
import { readJson, writeJsonAtomic, writeTextAtomic } from './fs-utils.js';

type Stage = GrokTask['stage'];

export type { AgentWorkspace, AgentConversationWorkspace } from '../domain/agent-runtime-types.js';
import type { AgentWorkspace, AgentConversationWorkspace } from '../domain/agent-runtime-types.js';

type WorkspaceRecord = {
  workspaceId: string;
  provider: AgentProvider;
  stage: Stage;
  sessionId: string;
  turnId: string;
};
type WorkspaceIndex = { schemaVersion: 1; records: WorkspaceRecord[] };

const MAX_REFERENCE_BYTES = 12_000_000;
const MAX_OUTPUT_BYTES = 10_000_000;

function safeWorkspaceId(value: string) {
  return /^[0-9a-f-]{36}$/i.test(value);
}

function workspaceBase(userData: string, provider: AgentProvider) {
  return path.join(userData, 'batch-studio-agent-workspaces', provider);
}

function workspaceIndexPath(root: string) {
  return path.join(internalDir(root), 'agent-file-artifacts.json');
}

export function agentWorkspaceFor(
  userData: string,
  provider: AgentProvider,
  stage: Stage,
  workspaceId: string,
): AgentWorkspace {
  const fileName = expectedArtifact(stage);
  if (!fileName || !safeWorkspaceId(workspaceId)) throw new Error('AI作業領域が不正です。');
  const directory = path.join(workspaceBase(userData, provider), workspaceId);
  const inputDirectory = path.join(directory, 'input');
  const outputDirectory = path.join(directory, 'output');
  return {
    workspaceId,
    provider,
    directory,
    inputDirectory,
    outputDirectory,
    outputPath: path.join(outputDirectory, fileName),
    fileName,
    stage,
  };
}

async function writeWorkspaceReferences(
  inputDirectory: string,
  references: Array<{ name: string; content: string }>,
): Promise<void> {
  let totalBytes = 0;
  const used = new Set<string>();
  for (const [index, reference] of references.entries()) {
    totalBytes += Buffer.byteLength(reference.content, 'utf8');
    if (totalBytes > MAX_REFERENCE_BYTES)
      throw new Error('AI参照ファイルの合計が12MBを超えています。');
    const clean = path.basename(reference.name).replace(/[^a-zA-Z0-9_.-]/g, '_');
    const fileName = `${index + 1}-${clean || 'reference.txt'}`;
    if (used.has(fileName)) throw new Error('参照ファイル名が重複しています。');
    used.add(fileName);
    await writeTextAtomic(path.join(inputDirectory, fileName), reference.content);
  }
}

export async function prepareAgentConversationWorkspace(
  userData: string,
  provider: AgentProvider,
  references: Array<{ name: string; content: string }>,
): Promise<AgentConversationWorkspace> {
  const workspaceId = randomUUID();
  const directory = path.join(workspaceBase(userData, provider), workspaceId);
  const inputDirectory = path.join(directory, 'input');
  const workspace = { workspaceId, provider, directory, inputDirectory };
  try {
    await mkdir(inputDirectory, { recursive: true });
    await writeWorkspaceReferences(inputDirectory, references);
    return workspace;
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function removeWorkspaceDirectory(
  userData: string,
  workspace: { workspaceId: string; provider: AgentProvider; directory: string },
): Promise<void> {
  if (!safeWorkspaceId(workspace.workspaceId)) throw new Error('AI作業領域が不正です。');
  const expected = path.join(workspaceBase(userData, workspace.provider), workspace.workspaceId);
  if (path.resolve(workspace.directory) !== path.resolve(expected))
    throw new Error('AI作業領域が不正です。');
  await rm(expected, { recursive: true, force: true });
}

export async function removeAgentConversationWorkspace(
  userData: string,
  workspace: AgentConversationWorkspace,
): Promise<void> {
  await removeWorkspaceDirectory(userData, workspace);
}

export async function removeAgentWorkspace(
  userData: string,
  workspace: AgentWorkspace,
): Promise<void> {
  await removeWorkspaceDirectory(userData, workspace);
}

export async function prepareAgentWorkspace(
  userData: string,
  provider: AgentProvider,
  stage: Stage,
  references: Array<{ name: string; content: string }>,
): Promise<AgentWorkspace> {
  const workspace = agentWorkspaceFor(userData, provider, stage, randomUUID());
  try {
    await mkdir(workspace.inputDirectory, { recursive: true });
    await mkdir(workspace.outputDirectory, { recursive: true });
    await writeWorkspaceReferences(workspace.inputDirectory, references);
    return workspace;
  } catch (error) {
    await rm(workspace.directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export { agentWorkspaceOutputInstruction } from '../domain/agent-workspace-policy.js';

async function readIndex(root: string): Promise<WorkspaceIndex> {
  const value = await readJson<WorkspaceIndex>(workspaceIndexPath(root));
  return value?.schemaVersion === 1 && Array.isArray(value.records)
    ? value
    : { schemaVersion: 1, records: [] };
}

export async function rememberAgentWorkspace(
  root: string,
  workspace: AgentWorkspace,
  sessionId: string,
  turnId: string,
): Promise<void> {
  if (!sessionId.trim() || !turnId.trim()) throw new Error('AI Session / Turn IDがありません。');
  const index = await readIndex(root);
  index.records = [
    ...index.records.filter(
      (record) =>
        !(
          record.provider === workspace.provider &&
          record.sessionId === sessionId &&
          record.turnId === turnId
        ),
    ),
    {
      workspaceId: workspace.workspaceId,
      provider: workspace.provider,
      stage: workspace.stage,
      sessionId,
      turnId,
    },
  ].slice(-500);
  await writeJsonAtomic(workspaceIndexPath(root), index);
}

export async function findAgentWorkspace(
  root: string,
  userData: string,
  provider: AgentProvider,
  sessionId: string,
  turnId: string,
  stage: Stage,
): Promise<AgentWorkspace | null> {
  const index = await readIndex(root);
  const record = index.records.find(
    (item) =>
      item.provider === provider &&
      item.sessionId === sessionId &&
      item.turnId === turnId &&
      item.stage === stage,
  );
  return record && safeWorkspaceId(record.workspaceId)
    ? agentWorkspaceFor(userData, provider, stage, record.workspaceId)
    : null;
}

export async function readAgentWorkspaceOutput(workspace: AgentWorkspace): Promise<string> {
  let stat;
  try {
    stat = await lstat(workspace.outputPath);
  } catch {
    throw new Error(
      `AIが output/${workspace.fileName} を生成しませんでした。最終回答ではなく、ファイルへ直接書き込む必要があります。`,
    );
  }
  if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || stat.size > MAX_OUTPUT_BYTES)
    throw new Error('AI成果物が通常のファイルではない、空、または10MBを超えています。');

  const [workspaceStat, inputStat, outputStat, workspaceReal, inputReal, outputReal, fileReal] =
    await Promise.all([
      lstat(workspace.directory),
      lstat(workspace.inputDirectory),
      lstat(workspace.outputDirectory),
      realpath(workspace.directory),
      realpath(workspace.inputDirectory),
      realpath(workspace.outputDirectory),
      realpath(workspace.outputPath),
    ]);

  if (
    workspaceStat.isSymbolicLink() ||
    inputStat.isSymbolicLink() ||
    outputStat.isSymbolicLink() ||
    !inputStat.isDirectory() ||
    !outputStat.isDirectory() ||
    inputReal !== path.join(workspaceReal, 'input') ||
    outputReal !== path.join(workspaceReal, 'output') ||
    fileReal !== path.join(outputReal, workspace.fileName)
  )
    throw new Error('AI成果物の保存先が作業領域外を指しています。');

  const content = await readFile(workspace.outputPath, 'utf8');
  if (!content.trim()) throw new Error('AIが生成した成果物ファイルは空です。');
  return content;
}
