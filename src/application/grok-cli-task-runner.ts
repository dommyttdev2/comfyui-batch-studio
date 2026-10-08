import { agentTaskContexts as TASK_CONTEXTS } from '../domain/agent-stage-policy.js';
import type {
  AgentConversationMessage,
  AgentEvent,
  AgentModelSelection,
  AgentProvider,
  AgentTaskRequest,
  AgentTurn,
  GrokContextStage,
  GrokTask,
  AgentWorkspace,
  AgentConversationWorkspace,
} from '../domain/agent-runtime-types.js';
import type { AutoArtifactEvent } from '../domain/auto-artifact-types.js';
import { expectedArtifact } from '../domain/agent-artifact-policy.js';
import {
  artifactFileOutputRules,
  promptPlanPatchInstructions,
} from '../domain/agent-task-policy.js';
import type { AgentCliAdapter } from './agent-cli-port.js';
import type {
  AgentSessionStatePort,
  AgentConversationPort,
  AgentRuntimePorts,
} from './agent-runtime-ports.js';

type TaskBuilder = (root: string, stage: GrokTask['stage'], extra: string) => Promise<GrokTask>;
type ArtifactImporter = AgentRuntimePorts['importAutoArtifact'];

export interface GrokCliTaskRunnerOptions {
  userDataPath: string;
  adapter: AgentCliAdapter;
  sessions: AgentSessionStatePort;
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

export interface GrokCliTaskRunnerContract {
  run(
    root: string,
    contextStage: GrokContextStage,
    taskStage: GrokTask['stage'],
    extra?: string,
  ): Promise<AgentTurn>;
  stop(root: string, contextStage: GrokContextStage): Promise<void>;
  isBusy(root: string, contextStage: GrokContextStage): boolean;
  shutdown(): Promise<void>;
}
export function createGrokCliTaskRunner(
  io: AgentRuntimePorts,
): new (
  options: GrokCliTaskRunnerOptions,
) => GrokCliTaskRunnerContract {
  const {
    path,
    readFile,
    prepareAgentConversationWorkspace,
    prepareAgentWorkspace,
    removeAgentConversationWorkspace,
    removeAgentWorkspace,
    rememberAgentWorkspace,
    readAgentWorkspaceOutput,
    agentWorkspaceOutputInstruction,
    buildGrokTask,
    importAutoArtifact,
  } = io;
  type ActiveRun = {
    turn: AgentTurn;
    taskStage: GrokTask['stage'];
    workspace: AgentWorkspace | null;
    conversationWorkspace: AgentConversationWorkspace | null;
    fileName: string | null;
  };

  function key(root: string, stage: GrokContextStage) {
    const resolved = path.resolve(root);
    const project = io.caseInsensitivePaths ? resolved.toLowerCase() : resolved;
    return `${project}\0${stage}`;
  }

  function safeReferenceName(value: string) {
    return path.basename(value).replace(/[^a-zA-Z0-9_.-]/g, '_') || 'reference.txt';
  }

  class GrokCliTaskRunner {
    private readonly userDataPath: string;
    private readonly adapter: AgentCliAdapter;
    private readonly sessions: AgentSessionStatePort;
    private readonly onEvent: GrokCliTaskRunnerOptions['onEvent'];
    private readonly onArtifact: GrokCliTaskRunnerOptions['onArtifact'];
    private readonly buildTask: TaskBuilder;
    private readonly importArtifact: ArtifactImporter;
    private readonly resolveModel?: GrokCliTaskRunnerOptions['resolveModel'];
    private readonly starting = new Set<string>();
    private readonly active = new Map<string, ActiveRun>();

    constructor(options: GrokCliTaskRunnerOptions) {
      if (options.adapter.provider !== 'grok') throw new Error('Grok adapter is required.');
      this.userDataPath = options.userDataPath;
      this.adapter = options.adapter;
      this.sessions = options.sessions;
      this.onEvent = options.onEvent;
      this.onArtifact = options.onArtifact;
      this.buildTask = options.buildTask ?? buildGrokTask;
      this.importArtifact = options.importArtifact ?? importAutoArtifact;
      this.resolveModel = options.resolveModel;
    }

    async run(
      root: string,
      contextStage: GrokContextStage,
      taskStage: GrokTask['stage'],
      extra = '',
    ): Promise<AgentTurn> {
      const reservation = key(root, contextStage);
      if (this.starting.has(reservation) || this.active.has(reservation))
        throw new Error('この会話は回答生成中です。');
      this.starting.add(reservation);
      try {
        return await this.runReserved(root, contextStage, taskStage, extra);
      } finally {
        this.starting.delete(reservation);
      }
    }
    private async runReserved(
      root: string,
      contextStage: GrokContextStage,
      taskStage: GrokTask['stage'],
      extra = '',
    ): Promise<AgentTurn> {
      if (!TASK_CONTEXTS[contextStage].includes(taskStage))
        throw new Error('選択した工程に対応しないGrok依頼です。');
      const activeKey = key(root, contextStage);
      if (this.active.has(activeKey)) throw new Error('この工程のGrok CLIは回答生成中です。');

      const availability = await this.adapter.checkAvailability();
      if (availability.state !== 'available')
        throw new Error(availability.message ?? 'Grok CLIを利用できません。');

      let model: AgentModelSelection | undefined;
      if (this.resolveModel) model = await this.resolveModel(root, contextStage);
      else if (this.adapter.getModels) {
        const settings = await this.adapter.getModels();
        model = settings.selection;
      }

      const task = await this.buildTask(root, taskStage, extra);
      const saved = await this.sessions.get(root, contextStage, 'grok');
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
        ? await prepareAgentWorkspace(this.userDataPath, 'grok', taskStage, references)
        : null;
      const conversationWorkspace = artifactFile
        ? null
        : await prepareAgentConversationWorkspace(this.userDataPath, 'grok', references);
      const taskWorkspace = workspace ?? conversationWorkspace;

      const prompt =
        workspace && artifactFile
          ? [
              task.prompt.replace(artifactFileOutputRules(artifactFile), '').trim(),
              referenceGuide.length ? `## 参照ファイル\n${referenceGuide.join('\n')}` : '',
              agentWorkspaceOutputInstruction(workspace),
            ]
              .filter(Boolean)
              .join('\n\n')
          : [
              task.prompt,
              referenceGuide.length ? `## 参照ファイル\n${referenceGuide.join('\n')}` : '',
              referenceGuide.length
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
        await this.sessions.remember(root, contextStage, 'grok', turn.sessionId);
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
      if (!turn) throw new Error('Grok CLI turnを開始できませんでした。');

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
          provider: 'grok',
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

    async shutdown(): Promise<void> {
      await this.adapter.shutdown();
    }

    isBusy(root: string, contextStage: GrokContextStage) {
      return this.starting.has(key(root, contextStage)) || this.active.has(key(root, contextStage));
    }

    private async finish(activeKey: string, root: string, run: ActiveRun) {
      try {
        await this.adapter.waitForCompletion(run.turn.turnId);
        if (!run.workspace || !run.fileName) return;
        const raw = await readAgentWorkspaceOutput(run.workspace);
        await this.importArtifact(
          root,
          'grok',
          run.taskStage,
          `${run.turn.sessionId}/${run.turn.turnId}`,
          raw,
          this.onArtifact,
        );
      } catch (error) {
        if (run.fileName) {
          this.onArtifact({
            provider: 'grok',
            root,
            stage: run.taskStage,
            fileName: run.fileName,
            sourceId: run.turn.sessionId,
            phase: 'failed',
            message: io.isCancelled(error)
              ? 'Grok CLIの処理を中止しました。'
              : error instanceof Error
                ? error.message
                : String(error),
          });
        }
      } finally {
        if (run.conversationWorkspace)
          await removeAgentConversationWorkspace(
            this.userDataPath,
            run.conversationWorkspace,
          ).catch(() => {});
        if (this.active.get(activeKey) === run) this.active.delete(activeKey);
      }
    }
  }

  return GrokCliTaskRunner;
}
