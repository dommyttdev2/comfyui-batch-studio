import type { LoraSelection } from '../domain/artifact-types.js';
import type {
  GrokLoraSelectionHistoryEntry,
  GrokLoraSelectionStage,
} from '../domain/resource-observation-types.js';
export interface LoraHistoryPorts {
  path: { join(...parts: string[]): string };
  readText(file: string): Promise<string | null>;
  listFiles(directory: string): Promise<string[]>;
  modifiedAt(file: string): Promise<string>;
}
export function createLoraSelectionHistory(io: LoraHistoryPorts) {
  const { path, readText } = io;
  function jsonCandidate(raw: string) {
    const fenced = raw.match(/```json\s*\n([\s\S]*?)```/i)?.[1]?.trim();
    if (fenced) return fenced;
    const a = raw.indexOf('{'),
      b = raw.lastIndexOf('}');
    return a >= 0 && b > a ? raw.slice(a, b + 1).trim() : raw.trim();
  }
  function validLora(value: unknown): value is LoraSelection {
    if (!value || typeof value !== 'object') return false;
    const x = value as Partial<LoraSelection>;
    return (
      typeof x.ref === 'string' &&
      typeof x.modelId === 'number' &&
      typeof x.modelName === 'string' &&
      typeof x.versionId === 'number' &&
      typeof x.versionName === 'string' &&
      typeof x.fileId === 'number' &&
      typeof x.fileName === 'string' &&
      typeof x.modelUrl === 'string' &&
      Array.isArray(x.trainedWords) &&
      typeof x.reason === 'string'
    );
  }
  async function readStage(
    root: string,
    stage: GrokLoraSelectionStage,
  ): Promise<GrokLoraSelectionHistoryEntry[]> {
    const dir = path.join(root, '._batch_studio', 'grok-responses', stage);
    let names: string[];
    try {
      names = (await io.listFiles(dir)).filter((name) => name.endsWith('.txt')).sort();
    } catch {
      return [];
    }
    const entries: GrokLoraSelectionHistoryEntry[] = [];
    for (const name of names) {
      const file = path.join(dir, name),
        raw = await readText(file);
      if (!raw) continue;
      let payload: any;
      try {
        payload = JSON.parse(jsonCandidate(raw));
      } catch {
        continue;
      }
      if (
        payload?.schemaVersion !== 1 ||
        !Array.isArray(payload?.loras) ||
        !payload.loras.every(validLora)
      )
        continue;
      let createdAt = '';
      try {
        createdAt = await io.modifiedAt(file);
      } catch {}
      entries.push({ id: `${stage}:${name}`, stage, createdAt, loras: payload.loras });
    }
    return entries;
  }
  async function readGrokLoraSelectionHistory(
    root: string,
  ): Promise<GrokLoraSelectionHistoryEntry[]> {
    const initial = await readStage(root, 'models'),
      fixes = await readStage(root, 'models-fix');
    return [...initial, ...fixes].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
  }

  return { readGrokLoraSelectionHistory };
}
