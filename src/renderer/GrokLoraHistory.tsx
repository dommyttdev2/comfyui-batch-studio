import { useEffect, useMemo, useState } from 'react';
import type {
  GrokLoraSelectionHistoryEntry,
  GrokLoraSelectionStage,
  LoraFileAvailability,
  LoraSelection,
  ModelCatalog,
  ProjectSummary,
} from '../shared/types';

function catalogLoraMatch(catalog: ModelCatalog | null, lora: LoraSelection) {
  if (!catalog) return null;
  for (const collection of catalog.collections)
    for (const item of collection.items) {
      if (item.modelId !== lora.modelId) continue;
      const rootVersion = {
        versionId: item.versionId,
        baseModel: item.baseModel,
        files: item.files,
        thumbnailUrl: item.thumbnailUrl,
      };
      const versions = [rootVersion, ...(item.versions ?? [])];
      const version = versions.find((v) => v.versionId === lora.versionId);
      if (!version) continue;
      const file = version.files.find((f) => f.id === lora.fileId && f.name === lora.fileName);
      if (file)
        return {
          collectionName: collection.name,
          thumbnailUrl: version.thumbnailUrl ?? item.thumbnailUrl ?? null,
          baseModel: version.baseModel?.trim() || null,
        };
    }
  return null;
}
function createdAtLabel(value: string) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ja-JP');
}
function visibleStageEntries(all: GrokLoraSelectionHistoryEntry[], stage: GrokLoraSelectionStage) {
  const matching = all.filter((x) => x.stage === stage);
  return stage === 'models' && matching.length ? matching.slice(-1) : matching;
}

export function GrokLoraHistory({
  project,
  stage,
  catalog,
  revision = 0,
}: {
  project: ProjectSummary;
  stage: GrokLoraSelectionStage;
  catalog: ModelCatalog | null;
  revision?: number;
}) {
  const [entries, setEntries] = useState<GrokLoraSelectionHistoryEntry[]>([]),
    [placements, setPlacements] = useState<LoraFileAvailability[] | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setError('');
      setPlacements(null);
      const all = await window.batchStudio.artifact.grokLoraHistory(project.rootPath),
        next = visibleStageEntries(all, stage),
        fileNames = [...new Set(next.flatMap((x) => x.loras.map((l) => l.fileName)))];
      const nextPlacements = fileNames.length
        ? await window.batchStudio.availability.checkLoraFiles(project.rootPath, fileNames)
        : [];
      if (cancelled) return;
      setEntries(next);
      setPlacements(nextPlacements);
    })().catch((e) => {
      if (!cancelled) {
        setError(e instanceof Error ? e.message : String(e));
        setPlacements([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [project.rootPath, stage, revision, catalog?.generation, catalog?.generatedAt]);
  const placementByFile = useMemo(
    () => new Map((placements ?? []).map((x) => [x.fileName, x])),
    [placements],
  );
  if (!entries.length && !error) return null;
  const prefix = stage === 'models' ? '選定' : '再選定';
  return (
    <div className="grok-lora-history">
      {error && <div className="issue error">✕ LoRA選定履歴を読み込めませんでした: {error}</div>}
      {entries.map((entry, index) => (
        <section className="panel grok-lora-summary" key={entry.id}>
          <div className="panelhead">
            <div>
              <h3>
                Grok選定LoRA · {prefix} {index + 1}
              </h3>
              <p>
                {stage === 'models'
                  ? 'Grokの最新の初回LoRA選定です。再取り込み時はこの「選定 1」を更新します。'
                  : 'この時点でGrokが返したLoRA再選定です。'}{' '}
                ローカル / R2 / Civitai Collectionの状態は現在の情報で確認します。
              </p>
              {createdAtLabel(entry.createdAt) && (
                <small className="grok-lora-history-time">{createdAtLabel(entry.createdAt)}</small>
              )}
            </div>
            <strong>{entry.loras.length}件</strong>
          </div>
          <div className="grok-lora-list">
            {entry.loras.map((lora) => {
              const placement = placementByFile.get(lora.fileName),
                catalogMatch = catalogLoraMatch(catalog, lora),
                local = !!placement?.local,
                r2 = !!placement?.r2,
                civit = !!catalogMatch,
                nowhere = placements != null && !local && !r2 && !civit;
              return (
                <article className="grok-lora-row" key={`${entry.id}:${lora.ref}`}>
                  <div className="grok-lora-thumb">
                    {catalogMatch?.thumbnailUrl ? (
                      <img src={catalogMatch.thumbnailUrl} alt="" loading="lazy" />
                    ) : (
                      <span>NO IMAGE</span>
                    )}
                  </div>
                  <div className="grok-lora-copy">
                    <div className="grok-lora-title">
                      <strong>{lora.fileName}</strong>
                      <button
                        className="model-civitai-link"
                        aria-label={`${lora.modelName} のCivitaiページを開く`}
                        onClick={() =>
                          void window.batchStudio.catalog.openModel(
                            `https://civitai.com/models/${lora.modelId}?modelVersionId=${lora.versionId}`,
                          )
                        }
                      >
                        Civitai ↗
                      </button>
                    </div>
                    <small>
                      {lora.modelName} · {lora.versionName}
                    </small>
                    <small>Base Model: {catalogMatch?.baseModel ?? '—'}</small>
                    {catalogMatch && <small>{catalogMatch.collectionName}</small>}
                    <div className="grok-lora-indicators">
                      <span
                        className={`grok-lora-indicator ${local ? 'active local' : 'inactive'}`}
                      >
                        {local ? '✓' : '—'} ローカル
                      </span>
                      <span className={`grok-lora-indicator ${r2 ? 'active r2' : 'inactive'}`}>
                        {r2 ? '✓' : '—'} R2
                      </span>
                      <span
                        className={`grok-lora-indicator ${civit ? 'active civit' : 'inactive'}`}
                      >
                        {civit ? '✓' : '—'} Civitai Collection
                      </span>
                      {placements == null && (
                        <span className="grok-lora-indicator checking">… 配置確認中</span>
                      )}
                      {nowhere && (
                        <span className="grok-lora-indicator missing">✕ いずれにもない</span>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
