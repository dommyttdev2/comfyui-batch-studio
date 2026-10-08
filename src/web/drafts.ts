export interface DraftRecord {
  id: string;
  schema: 'web-draft/1';
  userId: string;
  projectId: string;
  key: string;
  baseRevision: number;
  content: string;
  updatedAt: number;
}
export class Drafts {
  private pending: Promise<unknown> = Promise.resolve();
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.pending.catch(() => {}).then(work);
    this.pending = next;
    return next;
  }
  private connection?: Promise<IDBDatabase>;
  private db() {
    return (this.connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('batch-studio-drafts', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('drafts', { keyPath: 'id' });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(Error('DRAFT_STORAGE_UNAVAILABLE'));
    }));
  }
  async all(): Promise<DraftRecord[]> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const r = db.transaction('drafts').objectStore('drafts').getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(Error('DRAFT_STORAGE_UNAVAILABLE'));
    });
  }
  private async write(work: (store: IDBObjectStore) => void) {
    const db = await this.db();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite');
      work(tx.objectStore('drafts'));
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(Error('DRAFT_STORAGE_UNAVAILABLE'));
      tx.onerror = () => reject(Error('DRAFT_STORAGE_UNAVAILABLE'));
    });
  }
  async put(value: Omit<DraftRecord, 'id' | 'schema' | 'updatedAt'>) {
    return this.serial(async () => {
      const record: DraftRecord = {
        ...value,
        id: [value.userId, value.projectId, value.key].join(':'),
        schema: 'web-draft/1',
        updatedAt: Date.now(),
      };
      const all = (await this.all()).filter(
        (r) =>
          r.userId === value.userId &&
          r.id !== record.id &&
          Date.now() - r.updatedAt <= 7 * 86400000,
      );
      if (new TextEncoder().encode(JSON.stringify([...all, record])).length > 20 * 1024 * 1024)
        throw Error('DRAFT_STORAGE_LIMIT');
      await this.write((s) => s.put(record));
    });
  }
  async remove(user: string, project: string, key: string) {
    await this.serial(() => this.write((s) => s.delete([user, project, key].join(':'))));
  }
  async purge(user: string, allowed?: string[]) {
    return this.serial(async () => {
      const all = await this.all();
      await this.write((s) => {
        for (const r of all)
          if (
            r.userId === user &&
            (!allowed || !allowed.includes(r.projectId) || Date.now() - r.updatedAt > 7 * 86400000)
          )
            s.delete(r.id);
      });
    });
  }
  async recover(user: string, project: string) {
    await this.purge(
      user,
      undefined === project
        ? []
        : [project, ...(await this.all()).filter((r) => r.userId === user).map((r) => r.projectId)],
    );
    return (await this.all()).filter(
      (r) => r.schema === 'web-draft/1' && r.userId === user && r.projectId === project,
    );
  }
}
