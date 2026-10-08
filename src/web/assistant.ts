import { api, ApiError, type Job, type Project } from './api';
import { workspace as w, type Tab } from './workspace';
export interface History {
  activeConversationId: string | null;
  messages: { id: string; role: string; text: string }[];
  conversations: { id: string; resumable: boolean; messageCount: number }[];
  records: {
    jobId: string;
    state: string;
    imported: boolean;
    importError: string | null;
    artifact: unknown;
  }[];
}
export interface AssistantState {
  key: string;
  user: string;
  projectId: string;
  generation: string;
  stage: string;
  provider: string;
  input: string;
  extra: string;
  task: string;
  error: string;
  loading: boolean;
  sending: boolean;
  availability?: { state: string; message: string };
  models: { id: string; supportedReasoningEfforts?: string[] }[];
  model: string;
  effort: string;
  defaultModel: string;
  history: History;
  pending?: { path: string; body: unknown; id: string };
  refreshing?: Promise<void>;
  refreshAgain?: boolean;
}
export const tasks: Record<string, string[]> = {
  story: ['story-initial', 'story-finalize', 'story-fix'],
  models: ['models', 'models-fix'],
  promptPlan: ['prompt-plan', 'prompt-plan-fix', 'prompt-plan-patch'],
  caption: ['caption'],
};
class AssistantController {
  private states = new Map<string, AssistantState>();
  private revision = 0;
  private listeners = new Set<() => void>();
  private epoch = 0;
  private authenticated = false;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  snapshot = () => this.revision;
  emit = () => {
    this.revision++;
    for (const fn of this.listeners) fn();
  };
  constructor() {
    w.subscribe(() => {
      if (this.authenticated !== w.authenticated) {
        this.epoch++;
        this.authenticated = w.authenticated;
      }
      for (const [key, s] of this.states) {
        if (
          !w.authenticated ||
          s.user !== w.user ||
          !w.tabs.some((t) => t.id === s.projectId && t.generation === s.generation)
        )
          this.states.delete(key);
      }
      this.emit();
    });
    w.onPacket((p) => {
      if (!['job.changed', 'snapshot'].includes(p.type)) return;
      for (const s of this.states.values())
        if (
          p.type === 'snapshot' ||
          (p.job?.projectId === s.projectId &&
            p.job.stage === s.stage &&
            p.job.provider === s.provider)
        )
          void this.refresh(s);
    });
  }
  state(tab: Tab) {
    const key = JSON.stringify([w.user, tab.id, tab.generation, tab.key, tab.provider]);
    let s = this.states.get(key);
    if (!s) {
      s = {
        key,
        user: w.user,
        projectId: tab.id,
        generation: tab.generation,
        stage: tab.key,
        provider: tab.provider,
        input: '',
        extra: '',
        task: tasks[tab.key]?.[0] ?? '',
        error: '',
        loading: false,
        sending: false,
        models: [],
        model: '',
        effort: '',
        defaultModel: '',
        history: { activeConversationId: null, messages: [], conversations: [], records: [] },
      };
      this.states.set(key, s);
    }
    return s;
  }
  private live(s: AssistantState, epoch = this.epoch) {
    return (
      w.authenticated &&
      epoch === this.epoch &&
      w.user === s.user &&
      this.states.get(s.key) === s &&
      w.tabs.some((t) => t.id === s.projectId && t.generation === s.generation)
    );
  }
  private path(s: AssistantState, action: string) {
    return '/projects/' + s.projectId + '/agents/' + s.stage + '/' + s.provider + '/' + action;
  }
  jobs(s: AssistantState) {
    return [...w.jobs.values()].filter(
      (j) =>
        j.kind === 'agent' &&
        j.projectId === s.projectId &&
        j.stage === s.stage &&
        j.provider === s.provider,
    );
  }
  busy(s: AssistantState) {
    return (
      s.sending ||
      !!s.pending ||
      this.jobs(s).some((j) => ['reserved', 'running', 'cancelling', 'uncertain'].includes(j.state))
    );
  }
  async load(s: AssistantState) {
    if (!tasks[s.stage] || s.loading || s.availability) return;
    s.loading = true;
    this.emit();
    const epoch = this.epoch;
    try {
      const availability = await api.request<AssistantState['availability']>(
        this.path(s, 'availability'),
      );
      if (!this.live(s, epoch)) return;
      s.availability = availability;
      if (availability?.state === 'available') {
        const [models, prefs] = await Promise.all([
          api.request<{ models: AssistantState['models']; selection: { model: string | null } }>(
            this.path(s, 'models'),
          ),
          api.request<{ model?: { model: string | null; reasoningEffort?: string } }>(
            this.path(s, 'preferences'),
          ),
        ]);
        if (!this.live(s, epoch)) return;
        s.models = models.models;
        s.defaultModel = models.selection.model ?? '';
        s.model = prefs.model?.model ?? '';
        s.effort = prefs.model?.reasoningEffort ?? '';
      }
      await this.refresh(s);
    } catch (e) {
      if (this.live(s, epoch)) s.error = (e as Error).message;
    } finally {
      if (this.live(s, epoch)) {
        s.loading = false;
        this.emit();
      }
    }
  }
  refresh(s: AssistantState): Promise<void> {
    if (!this.live(s)) return Promise.resolve();
    if (s.refreshing) {
      s.refreshAgain = true;
      return s.refreshing;
    }
    const epoch = this.epoch;
    const work = async () => {
      do {
        s.refreshAgain = false;
        try {
          const h = await api.request<History>(this.path(s, 'history'));
          if (this.live(s, epoch)) s.history = h;
        } catch (e) {
          if (this.live(s, epoch)) s.error = (e as Error).message;
        }
      } while (s.refreshAgain && this.live(s, epoch));
    };
    s.refreshing = work().finally(() => {
      s.refreshing = undefined;
      if (this.live(s, epoch)) this.emit();
    });
    return s.refreshing;
  }
  async mutate(s: AssistantState, action: string, body: unknown, flush = false) {
    if (!this.live(s) || s.sending) return;
    const epoch = this.epoch;
    s.sending = true;
    s.error = '';
    this.emit();
    try {
      if (flush) {
        await w.flush(s.projectId);
        if (!this.live(s, epoch)) return;
      }
      const operation = s.pending ?? { path: this.path(s, action), body, id: crypto.randomUUID() };
      s.pending = operation;
      const value = await api.request<{ job?: Job; project?: Project }>(
        operation.path,
        operation.body,
        operation.id,
      );
      if (!this.live(s, epoch)) return;
      s.pending = undefined;
      if (value.job) w.jobs.set(value.job.id, value.job);
      const tab = w.tabs.find((t) => t.id === s.projectId && t.generation === s.generation);
      if (value.project && tab && value.project.revision >= tab.project.revision)
        tab.project = value.project;
      w.emit();
      await this.refresh(s);
    } catch (e) {
      if (this.live(s, epoch)) {
        s.error = (e as Error).message;
        if (e instanceof ApiError && e.status < 500 && e.code !== 'RUNTIME_UNCERTAIN')
          s.pending = undefined;
      }
    } finally {
      if (this.live(s, epoch)) {
        s.sending = false;
        this.emit();
      }
    }
  }
  async start(s: AssistantState, task: boolean) {
    if (this.busy(s) || s.availability?.state !== 'available') return;
    await this.mutate(
      s,
      task ? 'task' : 'chat',
      task
        ? { stage: s.task, extra: s.extra }
        : { text: s.input, conversationId: s.history.activeConversationId },
      true,
    );
  }
  async saveModel(s: AssistantState) {
    if (this.busy(s)) return;
    await w.flush(s.projectId);
    if (!this.live(s)) return;
    const tab = w.tabs.find((t) => t.id === s.projectId && t.generation === s.generation)!;
    await this.mutate(s, 'preferences', {
      expectedRevision: tab.project.revision,
      leaseId: tab.project.lease?.leaseId,
      model: s.model || null,
      reasoningEffort: s.effort || null,
    });
  }
}
export const assistant = new AssistantController();
