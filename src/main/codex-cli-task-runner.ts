import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promptPlanPatchInstructions } from '../domain/agent-task-policy.js';
import type {
  AgentEvent,
  AgentModelSelection,
  AgentTurn,
  AutoArtifactEvent,
  GrokContextStage,
  GrokTask,
} from '../shared/types.js';
import { expectedArtifact, importAutoArtifact } from './agent-artifact-import.js';
import type { AgentCliAdapter } from './agent-cli-adapter.js';
import { AgentSessionStateStore } from './agent-session-state.js';
import {
  type AgentConversationWorkspace,
  type AgentWorkspace,
  agentWorkspaceOutputInstruction,
  prepareAgentConversationWorkspace,
  prepareAgentWorkspace,
  readAgentWorkspaceOutput,
  rememberAgentWorkspace,
  removeAgentConversationWorkspace,
  removeAgentWorkspace,
} from './agent-workspace.js';
import { AgentTurnCancelledError } from './codex-cli-adapter.js';
import { artifactFileOutputRules, buildGrokTask } from './grok-context.js';
import { promptPlanPatchBase } from './prompt-plan-patch.js';

type TaskBuilder = (root: string, stage: GrokTask['stage'], extra: string) => Promise<GrokTask>;
type ArtifactImporter = typeof importAutoArtifact;

export interface CodexCliTaskRunnerOptions {
  userDataPath: string;
  adapter: AgentCliAdapter;
  sessions: AgentSessionStateStore;
  onEvent: (
    context: { root: string; stage: GrokContextStage; taskStage: GrokTask['stage'] },
    event: AgentEvent,
  ) => void;
  onArtifact: (event: AutoArtifactEvent) => void;
  buildTask?: TaskBuilder;
  importArtifact?: ArtifactImporter;
  resolveModel?: (
    root: string,
    stage: GrokContextStage,
  ) => Promise<AgentModelSelection | undefined>;
}

type ActiveRun = {
  turn: AgentTurn;
  taskStage: GrokTask['stage'];
  workspace: AgentWorkspace | null;
  conversationWorkspace: AgentConversationWorkspace | null;
  fileName: string | null;
};

const TASK_CONTEXTS: Record<GrokContextStage, GrokTask['stage'][]> = {
  story: ['story-initial', 'story-finalize', 'story-fix'],
  models: ['models', 'models-fix'],
  'prompt-plan': ['prompt-plan', 'prompt-plan-fix', 'prompt-plan-patch'],
  caption: ['caption'],
};

function key(root: string, stage: GrokContextStage) {
  const resolved = path.resolve(root);
  const project = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  return `${project}\0${stage}`;
}

function safeReferenceName(value: string) {
  return path.basename(value).replace(/[^a-zA-Z0-9_.-]/g, '_') || 'reference.txt';
}

async function buildDefaultCodexTask(
  root: string,
  stage: GrokTask['stage'],
  extra: string,
): Promise<GrokTask> {
  if (stage === 'prompt-plan-patch') {
    const baseline = await promptPlanPatchBase(root);
    const prompt = promptPlanPatchInstructions(baseline, extra, 'input/1-prompt_plan.json');
    return {
      stage,
      title: 'Prompt Planを部分修正',
      prompt,
      attachments: [
        {
          name: 'prompt_plan.json',
          path: baseline.filePath,
          purpose: '現在のPrompt Plan',
          exists: true,
        },
      ],
    };
  }

  const task = await buildGrokTask(root, stage, extra);
  const artifactFile = expectedArtifact(stage);
  let prompt = task.prompt.replaceAll('Grok', 'Codex');
  if (artifactFile) prompt = prompt.replace(artifactFileOutputRules(artifactFile), '').trim();
  if (stage === 'story-initial')
    prompt +=
      '\n\n## Codex向け出力契約\nこれは対話用の検討依頼です。成果物ファイルはまだ作成しません。';
  return { ...task, prompt };
}

export class CodexCliTaskRunner {
  private readonly userDataPath: string;
  private readonly adapter: AgentCliAdapter;
  private readonly sessions: AgentSessionStateStore;
  private readonly onEvent: CodexCliTaskRunnerOptions['onEvent'];
  private readonly onArtifact: CodexCliTaskRunnerOptions['onArtifact'];
  private readonly buildTask: TaskBuilder;
  private readonly importArtifact: ArtifactImporter;
  private readonly resolveModel?: CodexCliTaskRunnerOptions['resolveModel'];
  private readonly active = new Map<string, ActiveRun>();

  constructor(options: CodexCliTaskRunnerOptions) {
    if (options.adapter.provider !== 'codex') throw new Error('Codex adapter is required.');
    this.userDataPath = options.userDataPath;
    this.adapter = options.adapter;
    this.sessions = options.sessions;
    this.onEvent = options.onEvent;
    this.onArtifact = options.onArtifact;
    this.buildTask = options.buildTask ?? buildDefaultCodexTask;
    this.importArtifact = options.importArtifact ?? importAutoArtifact;
    this.resolveModel = options.resolveModel;
  }

  async run(
    root: string,
    contextStage: GrokContextStage,
    taskStage: GrokTask['stage'],
    extra = '',
  ): Promise<AgentTurn> {
    if (!TASK_CONTEXTS[contextStage].includes(taskStage))
      throw new Error('選択した工程に対応しないCodex依頼です。');
    const activeKey = key(root, contextStage);
    if (this.active.has(activeKey)) throw new Error('この工程のCodex CLIは回答生成中です。');

    const availability = await this.adapter.checkAvailability();
    if (availability.state !== 'available')
      throw new Error(availability.message ?? 'Codex CLIを利用できません。');

    let model: AgentModelSelection | undefined;
    if (this.resolveModel) model = await this.resolveModel(root, contextStage);
    else if (this.adapter.getModels) model = (await this.adapter.getModels()).selection;

    const task = await this.buildTask(root, taskStage, extra);
    const saved = await this.sessions.get(root, contextStage, 'codex');
    const artifactFile = expectedArtifact(taskStage);
    const references: Array<{ name: string; content: string }> = [];
    const referenceGuide: string[] = [];
    for (const attachment of task.attachments) {
      if (!attachment.exists) continue;
      const content = await readFile(attachment.path, 'utf8');
      const name = safeReferenceName(attachment.name);
      references.push({ name, content });
      referenceGuide.push(`input/${references.length}-${name} — ${attachment.purpose}`);
    }

    const workspace = artifactFile
      ? await prepareAgentWorkspace(this.userDataPath, 'codex', taskStage, references)
      : null;
    const conversationWorkspace = artifactFile
      ? null
      : await prepareAgentConversationWorkspace(this.userDataPath, 'codex', references);
    const taskWorkspace = workspace ?? conversationWorkspace;
    const prompt = [
      task.prompt,
      referenceGuide.length ? `## 参照ファイル\n${referenceGuide.join('\n')}` : '',
      artifactFile && workspace
        ? agentWorkspaceOutputInstruction(workspace)
        : referenceGuide.length
          ? 'CLI実行では上記ファイルを作業ディレクトリの input/ から参照してください。'
          : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const request = {
      context: { root, stage: contextStage },
      taskStage,
      prompt,
      extra,
      ...(taskWorkspace ? { workspace: taskWorkspace } : {}),
      ...(model ? { model } : {}),
    };
    const forward = (event: AgentEvent) =>
      this.onEvent({ root, stage: contextStage, taskStage }, event);
    let turn: AgentTurn | null = null;
    try {
      turn = saved.activeSessionId
        ? await this.adapter.resumeTask(saved.activeSessionId, request, forward)
        : await this.adapter.startTask(request, forward);
      await this.sessions.remember(root, contextStage, 'codex', turn.sessionId);
      if (workspace) await rememberAgentWorkspace(root, workspace, turn.sessionId, turn.turnId);
    } catch (error) {
      if (turn) await this.adapter.stop(turn.turnId).catch(() => {});
      if (conversationWorkspace)
        await removeAgentConversationWorkspace(this.userDataPath, conversationWorkspace).catch(
          () => {},
        );
      if (workspace) await removeAgentWorkspace(this.userDataPath, workspace).catch(() => {});
      throw error;
    }
    if (!turn) throw new Error('Codex CLI turnを開始できませんでした。');

    const run: ActiveRun = {
      turn,
      taskStage,
      workspace,
      conversationWorkspace,
      fileName: artifactFile,
    };
    this.active.set(activeKey, run);

    if (artifactFile) {
      this.onArtifact({
        provider: 'codex',
        root,
        stage: taskStage,
        fileName: artifactFile,
        sourceId: turn.sessionId,
        phase: 'waiting',
      });
    }

    void this.finish(activeKey, root, run);
    return turn;
  }

  async stop(root: string, contextStage: GrokContextStage): Promise<void> {
    const run = this.active.get(key(root, contextStage));
    if (!run) return;
    await this.adapter.stop(run.turn.turnId);
  }

  isBusy(root: string, contextStage: GrokContextStage) {
    return this.active.has(key(root, contextStage));
  }

  private async finish(activeKey: string, root: string, run: ActiveRun) {
    try {
      await this.adapter.waitForCompletion(run.turn.turnId);
      if (!run.workspace || !run.fileName) return;
      const raw = await readAgentWorkspaceOutput(run.workspace);
      await this.importArtifact(
        root,
        'codex',
        run.taskStage,
        `${run.turn.sessionId}/${run.turn.turnId}`,
        raw,
        this.onArtifact,
      );
    } catch (error) {
      if (run.fileName) {
        this.onArtifact({
          provider: 'codex',
          root,
          stage: run.taskStage,
          fileName: run.fileName,
          sourceId: run.turn.sessionId,
          phase: 'failed',
          message:
            error instanceof AgentTurnCancelledError
              ? 'Codex CLIの処理を中止しました。'
              : error instanceof Error
                ? error.message
                : String(error),
        });
      }
    } finally {
      if (run.conversationWorkspace)
        await removeAgentConversationWorkspace(this.userDataPath, run.conversationWorkspace).catch(
          () => {},
        );
      if (this.active.get(activeKey) === run) this.active.delete(activeKey);
    }
  }
}
