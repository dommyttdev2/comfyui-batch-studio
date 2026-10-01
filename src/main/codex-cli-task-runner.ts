import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  AgentEvent,
  AgentModelSelection,
  AgentTurn,
  AutoArtifactEvent,
  GrokContextStage,
  GrokTask,
} from '../shared/types.js';
import type { AgentCliAdapter } from './agent-cli-adapter.js';
import { expectedArtifact, importAutoArtifact } from './agent-artifact-import.js';
import { AgentSessionStateStore } from './agent-session-state.js';
import {
  agentWorkspaceOutputInstruction,
  prepareAgentConversationWorkspace,
  prepareAgentWorkspace,
  readAgentWorkspaceOutput,
  rememberAgentWorkspace,
  removeAgentConversationWorkspace,
  removeAgentWorkspace,
  type AgentConversationWorkspace,
  type AgentWorkspace,
} from './agent-workspace.js';
import { artifactFileOutputRules, buildGrokTask } from './grok-context.js';
import { AgentTurnCancelledError } from './codex-cli-adapter.js';
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
    const prompt = `## Task
あなたはComfyUI Batch StudioのPrompt Plan Schema v2を修正します。
これは相談や全文再生成ではなく、この会話で合意した変更を、現在の既存計画へ部分適用するための差分生成依頼です。
作業ディレクトリの input/1-prompt_plan.json を読み込み、該当Branch/Leafを実際に確認してください。入力ファイルは変更しません。
現在のファイル本文のSHA-256（UTF-8のバイト列）: ${baseline.baseSha256}
現在の計画: ${baseline.branches} Branch / ${baseline.leaves} Leaf。
この会話の修正対象以外のBranch/Leaf、ID、枚数、モデル設定、タグを絶対に変更しないでください。

## 差分JSON形式（厳守）
{
  "schemaVersion": 1,
  "baseSha256": "${baseline.baseSha256}",
  "operations": [
    {
      "scope": "branch",
      "branchId": "既存Branch ID（例: b19）",
      "path": "prompt.triggerWords",
      "before": [{"modelRef": "実際の既存ref", "words": ["修正前の値"]}],
      "after": [{"modelRef": "実際の既存ref", "words": ["修正後の値"]}]
    }
  ]
}
- 上記のbefore/afterは構造例であり、実際の元ファイルから対象配列の全要素を正確に転記してください。推測で記載しないでください。
- 操作対象は、commonならscope=commonでpath=triggerWords、positive.category、positive.camera.pov/angle/framing/gaze/focus、negative.category、Branch/Leafならscope=branch/leafでpathの先頭にprompt.を付けた同じ形式です。
- BranchにはbranchId、LeafにはbranchIdとleafIdを指定します。共通Scopeにはどちらも指定しません。
- beforeとafterはどちらも対象の配列全体を入れ、beforeは現在のファイル内容と完全一致させてください。変更対象外の要素は維持してください。
- この差分はBatch Studioが基準ハッシュとbeforeを照合して原子的に下書きへ適用し、計画全件を検証します。
- JSONは上記3つのroot fieldのみ、operationはscope/branchId/leafId/path/before/afterのみを使用してください。
- 同じscope・Branch・Leaf・pathへの変更は1操作に統合してください。操作数は100件以下です。
- 修正する既存配列が見つからない、または配列の全値を正確に読めない場合、差分を作成したと主張せず理由を示してください。
- 原本全体や修正案だけの会話は出力しません。次の出力契約に従い、差分JSONをファイルに書き込んでください。
${extra ? `\n## 追加の修正条件\n${extra}` : ''}`;
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
