import { api, type Project, type Job, type Packet } from './api';
import { Drafts, type DraftRecord } from './drafts';
export interface Tab {
  id: string;
  name: string;
  generation: string;
  project: Project;
  key: string;
  dirty: Record<string, string>;
  baseRevision: number;
  scroll: number;
  provider: string;
  assistantInput: string;
  pane: number;
  recovery: DraftRecord[];
  error: string;
}
export const artifactKeys = [
  'brief',
  'story',
  'models',
  'promptPlan',
  'workflow',
  'caption',
  'thumbnail',
  'marketplace',
];
export class Workspace {
  tabs: Tab[] = [];
  selected = 'home';
  projects: { id: string; displayName: string }[] = [];
  roots: { id: string; displayName: string }[] = [];
  jobs = new Map<string, Job>();
  error = '';
  eventStatus = '';
  user = '';
  private revision = 0;
  private listeners = new Set<() => void>();
  private queues = new Map<string, Promise<unknown>>();
  private nav = Promise.resolve();
  private renewal?: ReturnType<typeof setInterval>;
  readonly drafts = new Drafts();
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  snapshot = () => this.revision;
  emit = () => {
    this.revision++;
    for (const fn of this.listeners) fn();
  };
  async initialize() {
    if (this.user && this.user !== api.userId) {
      await this.drafts.purge(this.user);
      this.tabs = [];
      this.selected = 'home';
    }
    this.user = api.userId;
    for (const t of this.tabs) {
      const result = await api.request<{ project: Project }>('/projects/' + t.id);
      t.project = result.project;
    }
    await this.drafts.purge(this.user, api.projectIds);
    await this.refresh();
    const jobs = await api.request<{ jobs: Job[] }>('/jobs');
    for (const j of jobs.jobs) this.jobs.set(j.id, j);
    api.subscribe(api.projectIds, (p) => this.packet(p));
    this.renewal && clearInterval(this.renewal);
    this.renewal = setInterval(() => {
      for (const t of this.tabs)
        if (t.project.lease?.ownedByCurrentSession)
          void this.action(t.id, 'renew-lease').catch((e) => {
            t.error = e.message;
            this.emit();
          });
    }, 20000);
    const last = localStorage.getItem('workspace:last:' + this.user);
    if (last && this.projects.some((p) => p.id === last)) await this.open(last);
    else if (last) {
      this.error = '最後のProjectは利用できません。Homeから選択してください。';
      this.emit();
    }
  }
  async refresh() {
    this.projects = (
      await api.request<{ projects: { id: string; displayName: string }[] }>('/projects')
    ).projects;
    try {
      this.roots = (
        await api.request<{ roots: { id: string; displayName: string }[] }>('/project-roots')
      ).roots;
    } catch (e) {
      if ((e as { status: number }).status !== 403) throw e;
    }
    this.emit();
  }
  private serial<T>(id: string, work: () => Promise<T>): Promise<T> {
    const pending = this.queues.get(id) ?? Promise.resolve();
    const next = pending.catch(() => {}).then(work);
    this.queues.set(id, next);
    void next
      .finally(() => {
        if (this.queues.get(id) === next) this.queues.delete(id);
      })
      .catch(() => {});
    return next;
  }
  private current(id: string, generation?: string) {
    return this.tabs.find((t) => t.id === id && (!generation || t.generation === generation));
  }
  async open(id: string) {
    if (this.current(id)) {
      await this.select(id);
      return;
    }
    const summary = this.projects.find((p) => p.id === id);
    if (!summary) throw Error('PROJECT_NOT_AVAILABLE');
    const { project } = await api.request<{ project: Project }>('/projects/' + id);
    if (this.current(id)) {
      await this.select(id);
      return;
    }
    const t: Tab = {
      id,
      name: summary.displayName,
      generation: crypto.randomUUID(),
      project,
      key: 'brief',
      dirty: {},
      baseRevision: project.revision,
      scroll: 0,
      provider: 'codex',
      assistantInput: '',
      pane: 30,
      recovery: await this.drafts.recover(this.user, id),
      error: '',
    };
    this.tabs.push(t);
    try {
      await this.action(id, 'acquire-lease');
    } catch (e) {
      t.error = (e as Error).message;
    }
    await this.select(id);
  }
  async action(id: string, action: string, extra: Record<string, unknown> = {}) {
    const tab = this.current(id);
    if (!tab) throw Error('TAB_CLOSED');
    const generation = tab.generation;
    return this.serial(id, async () => {
      const t = this.current(id, generation);
      if (!t) throw Error('TAB_CLOSED');
      const input =
        action === 'acquire-lease'
          ? {}
          : { expectedRevision: t.project.revision, leaseId: t.project.lease?.leaseId, ...extra };
      const result = await api.request<{ project: Project; eventDelivery?: string }>(
        '/projects/' + id + '/commands/' + action,
        input,
      );
      const current = this.current(id, generation);
      if (current) {
        if (result.project.revision >= current.project.revision) current.project = result.project;
        current.error = '';
        if (result.eventDelivery === 'pending')
          current.error = '保存済み。変更通知の配信を待っています。';
        this.emit();
      }
      return result.project;
    });
  }
  async edit(id: string, key: string, value: string) {
    const t = this.current(id);
    if (!t) return;
    if (!Object.keys(t.dirty).length) t.baseRevision = t.project.revision;
    t.dirty[key] = value;
    this.emit();
    await this.drafts.put({
      userId: this.user,
      projectId: id,
      key,
      content: value,
      baseRevision: t.baseRevision,
    });
  }
  async flush(id: string) {
    const t = this.current(id);
    if (!t) return;
    for (const [key, content] of Object.entries({ ...t.dirty })) {
      await this.action(id, 'save-draft', { key, content });
      const current = this.current(id, t.generation);
      if (current && current.dirty[key] === content) {
        delete current.dirty[key];
        await this.drafts.remove(this.user, id, key);
      }
    }
    this.emit();
  }
  async select(id: string) {
    const work = this.nav
      .catch(() => {})
      .then(async () => {
        if (id !== this.selected && this.selected !== 'home') await this.flush(this.selected);
        if (id !== 'home' && !this.current(id)) throw Error('TAB_CLOSED');
        this.selected = id;
        if (id !== 'home') localStorage.setItem('workspace:last:' + this.user, id);
        this.emit();
      });
    this.nav = work;
    return work;
  }
  async stage(id: string, key: string) {
    await this.flush(id);
    const t = this.current(id);
    if (t) {
      t.key = key;
      t.scroll = 0;
      this.emit();
    }
  }
  async close(id: string, discard = false) {
    const t = this.current(id);
    if (!t) return;
    if (discard) {
      for (const key of Object.keys(t.dirty)) await this.drafts.remove(this.user, id, key);
      t.dirty = {};
    } else await this.flush(id);
    if (t.project.lease?.ownedByCurrentSession) await this.action(id, 'release-lease');
    this.tabs = this.tabs.filter((x) => x.generation !== t.generation);
    if (this.selected === id) this.selected = 'home';
    this.emit();
  }
  move(id: string, direction: number) {
    const i = this.tabs.findIndex((t) => t.id === id);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= this.tabs.length) return;
    [this.tabs[i], this.tabs[j]] = [this.tabs[j], this.tabs[i]];
    this.emit();
  }
  async restore(id: string, record: DraftRecord) {
    const t = this.current(id);
    if (!t || record.baseRevision !== t.baseRevision) throw Error('DRAFT_REVISION_CONFLICT');
    await this.edit(id, record.key, record.content);
    t.key = record.key;
    t.recovery = t.recovery.filter((r) => r.id !== record.id);
    this.emit();
  }
  async discardRecovery(id: string, record: DraftRecord) {
    await this.drafts.remove(this.user, id, record.key);
    const t = this.current(id);
    if (t) t.recovery = t.recovery.filter((r) => r.id !== record.id);
    this.emit();
  }
  private packet(packet: Packet) {
    if (packet.type === 'snapshot') {
      for (const j of packet.jobs ?? []) this.jobs.set(j.id, j);
      for (const p of packet.projects ?? []) this.invalidate(p.id, p.revision);
    }
    if (packet.type === 'job.changed' && packet.job) this.jobs.set(packet.job.id, packet.job);
    if (packet.type === 'project.changed' && packet.projectId && packet.revision !== undefined)
      this.invalidate(packet.projectId, packet.revision);
    if (['error', 'connection.closed', 'connection.error'].includes(packet.type))
      this.eventStatus = packet.code ?? '接続が切れました。再接続してください。';
    else this.eventStatus = '';
    this.emit();
  }
  private invalidate(id: string, revision: number) {
    const tab = this.current(id);
    if (!tab || tab.project.revision >= revision) return;
    const generation = tab.generation;
    void this.serial(id, async () => {
      const result = await api.request<{ project: Project }>('/projects/' + id);
      const t = this.current(id, generation);
      if (t && result.project.revision >= t.project.revision) {
        t.project = result.project;
        this.emit();
      }
    }).catch((e) => {
      this.error = e.message;
      this.emit();
    });
  }
  suspend() {
    api.disconnect();
    clearInterval(this.renewal);
    this.emit();
  }
  async logout() {
    await api.request('/logout', {});
    this.suspend();
    await this.drafts.purge(this.user);
    this.tabs = [];
    this.jobs.clear();
    this.selected = 'home';
    this.user = '';
    this.emit();
  }
}
export const workspace = new Workspace();
