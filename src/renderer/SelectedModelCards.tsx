import { useEffect, useState } from 'react';
import type {
  CatalogItem,
  LoraFileAvailability,
  LoraSelection,
  ModelCatalog,
  ModelFamily,
  ModelSelectionBase,
  ModelsArtifact,
} from '../shared/types';
import { candidateVersions } from '../shared/model-selection';
import {
  catalogItemForSelection,
  replaceSelectedModelVersion,
} from '../shared/model-version-change';
import './civit-explorer.css';
import './model-selection.css';

type EditableRole = 'checkpoint' | 'lora';
type SelectionEntry = {
  selection: ModelSelectionBase;
  role: EditableRole;
  label: string;
};
type PendingChoice = { versionId: number; fileId: number };

function SelectionCard({
  entry,
  catalog,
  family,
  onSave,
  placement,
  placementLoading = false,
  placementError = '',
}: {
  entry: SelectionEntry;
  catalog: ModelCatalog | null;
  family?: ModelFamily;
  onSave: (current: ModelSelectionBase, next: ModelSelectionBase) => Promise<void>;
  placement?: LoraFileAvailability;
  placementLoading?: boolean;
  placementError?: string;
}) {
  const { selection, role, label } = entry;
  const [pending, setPending] = useState<PendingChoice>({
    versionId: selection.versionId,
    fileId: selection.fileId,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setPending({ versionId: selection.versionId, fileId: selection.fileId });
    setError('');
  }, [selection.versionId, selection.fileId, selection.modelId]);

  const item: CatalogItem | null = catalog
    ? catalogItemForSelection(catalog, selection, role, family)
    : null;
  const matches = item ? candidateVersions(item, role, family) : [];
  const match = matches.find((candidate) => candidate.version.versionId === pending.versionId);
  const file = match?.files.find((candidate) => candidate.id === pending.fileId);
  const changed = pending.versionId !== selection.versionId || pending.fileId !== selection.fileId;
  const image = match?.version.thumbnailUrl ?? item?.thumbnailUrl;
  const trained =
    match?.version.trainedWords ??
    (match?.version.versionId === item?.versionId ? item?.trainedWords : undefined) ??
    selection.trainedWords;
  const modelUrl = `https://civitai.com/models/${selection.modelId}?modelVersionId=${match?.version.versionId ?? selection.versionId}`;
  const baseline =
    match?.version.strengthBaseline ??
    (match?.version.versionId === item?.versionId ? item?.strengthBaseline : undefined) ??
    (role === 'lora' ? (selection as LoraSelection).strengthBaseline : undefined);
  const selectedVersion = matches.find(
    (candidate) => candidate.version.versionId === selection.versionId,
  );
  const inCivitai = Boolean(
    selectedVersion?.files.some(
      (candidate) => candidate.id === selection.fileId && candidate.name === selection.fileName,
    ),
  );

  const save = async () => {
    if (!item || !match || !file || !changed || saving) return;
    setSaving(true);
    setError('');
    try {
      const updated = replaceSelectedModelVersion(
        selection,
        item,
        role,
        match.version.versionId,
        file.id,
        family,
      );
      await onSave(selection, updated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className="civit-model-card selected-model-card">
      <div className="civit-model-image">
        {image ? (
          <img src={image} alt="" loading="lazy" />
        ) : (
          <div className="civit-model-placeholder">MODEL</div>
        )}
        <span>{label}</span>
      </div>
      <div className="civit-model-content">
        <div className="civit-model-title">
          <div>
            <strong>{selection.modelName}</strong>
            <small>Model ID {selection.modelId}</small>
          </div>
          <button onClick={() => void window.batchStudio.catalog.openModel(modelUrl)}>
            Civitai
          </button>
        </div>
        {item && matches.length ? (
          <>
            <label className="civit-version-select">
              <span>Version</span>
              <select
                aria-label={`${selection.modelName} のバージョン`}
                value={match?.version.versionId ?? ''}
                disabled={saving}
                onChange={(event) => {
                  const versionId = Number(event.target.value);
                  const next = matches.find(
                    (candidate) => candidate.version.versionId === versionId,
                  );
                  if (!next) return;
                  const preferredFile =
                    versionId === selection.versionId
                      ? next.files.find((candidate) => candidate.id === selection.fileId)
                      : undefined;
                  const nextFile =
                    preferredFile ??
                    next.files.find((candidate) => candidate.primary) ??
                    next.files[0];
                  setPending({ versionId, fileId: nextFile.id });
                  setError('');
                }}
              >
                {!match && <option value="">バージョンがカタログにありません</option>}
                {matches.map(({ version }) => (
                  <option key={version.versionId} value={version.versionId}>
                    {version.versionName}
                  </option>
                ))}
              </select>
            </label>
            <div className="civit-version-static">
              <span>Base Model</span>
              <b>{match?.version.baseModel ?? '—'}</b>
            </div>
            <label className="selected-model-file">
              <span>File</span>
              <select
                aria-label={`${selection.modelName} のファイル`}
                value={file?.id ?? ''}
                disabled={!match || saving}
                onChange={(event) =>
                  setPending((previous) => ({
                    ...previous,
                    fileId: Number(event.target.value),
                  }))
                }
              >
                {!file && <option value="">ファイルを選択してください</option>}
                {match?.files.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="civit-meta-block">
              <span>TRIGGER WORDS</span>
              {trained.length ? (
                <div className="civit-chips words">
                  {trained.map((word) => (
                    <code key={word}>{word}</code>
                  ))}
                </div>
              ) : (
                <small>—</small>
              )}
            </div>
            <div className="civit-card-footer">
              <span>Version ID {match?.version.versionId ?? '—'}</span>
              <span>{baseline ? `Baseline ${baseline.value}` : 'Baseline —'}</span>
            </div>
            {changed && (
              <p className="selected-model-pending">
                現在: {selection.versionName} / {selection.fileName}
              </p>
            )}
            <button
              className="primary selected-model-save"
              disabled={!changed || !match || !file || saving}
              onClick={() => void save()}
            >
              {saving ? '保存中…' : '変更を下書きへ保存'}
            </button>
          </>
        ) : (
          <div className="issue warning">
            <div>
              現在の選定: {selection.versionName} / {selection.fileName}
            </div>
            Civitaiモデルカタログに選定中のバージョンがありません。カタログを同期してください。
          </div>
        )}
        {role === 'lora' && (
          <>
            <div className="grok-lora-indicators" aria-label="LoRAの配置状態">
              <span
                className={`grok-lora-indicator ${placement?.local ? 'active local' : 'inactive'}`}
              >
                {placement?.local ? '✓' : '—'} ローカル
              </span>
              <span className={`grok-lora-indicator ${placement?.r2 ? 'active r2' : 'inactive'}`}>
                {placement?.r2 ? '✓' : '—'} R2
              </span>
              <span className={`grok-lora-indicator ${inCivitai ? 'active civit' : 'inactive'}`}>
                {inCivitai ? '✓' : '—'} Civitai Collection
              </span>
              {placementLoading && (
                <span className="grok-lora-indicator checking">… 配置確認中</span>
              )}
              {!placementLoading &&
                !placementError &&
                !placement?.local &&
                !placement?.r2 &&
                !inCivitai && <span className="grok-lora-indicator missing">✕ いずれにもない</span>}
            </div>
            {placementError && (
              <small className="issue warning">配置確認失敗: {placementError}</small>
            )}
            {selection.reason && (
              <details className="selected-model-reason">
                <summary>選定理由</summary>
                <p>{selection.reason}</p>
              </details>
            )}
          </>
        )}
        {error && <div className="issue error">✕ {error}</div>}
      </div>
    </article>
  );
}

export function SelectedModelCards({
  models,
  catalog,
  projectRoot,
  onSave,
  view = 'all',
}: {
  models: ModelsArtifact;
  catalog: ModelCatalog | null;
  projectRoot: string;
  onSave: (current: ModelSelectionBase, next: ModelSelectionBase) => Promise<void>;
  view?: 'all' | 'base' | 'loras';
}) {
  const [placements, setPlacements] = useState<LoraFileAvailability[] | null>(null);
  const [placementError, setPlacementError] = useState('');
  const fileNamesKey = models.loras.map((selection) => selection.fileName).join('\0');
  useEffect(() => {
    if (view === 'base') return;
    let cancelled = false;
    setPlacements(null);
    setPlacementError('');
    const fileNames = [...new Set(models.loras.map((selection) => selection.fileName))];
    if (!fileNames.length) {
      setPlacements([]);
      return;
    }
    void window.batchStudio.availability
      .checkLoraFiles(projectRoot, fileNames)
      .then((next) => {
        if (!cancelled) setPlacements(next);
      })
      .catch((cause) => {
        if (cancelled) return;
        setPlacements([]);
        setPlacementError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [projectRoot, fileNamesKey, catalog?.generation, catalog?.generatedAt, view]);

  const placementByFile = new Map((placements ?? []).map((value) => [value.fileName, value]));
  const base = models.modelFamily === 'anima' ? models.diffusionModel : models.checkpoint;
  const baseEntry: SelectionEntry | null = base
    ? {
        selection: base,
        role: 'checkpoint',
        label: models.modelFamily === 'anima' ? 'Diffusion Model' : 'Checkpoint',
      }
    : null;
  return (
    <>
      {view !== 'loras' && baseEntry && (
        <section className="panel selected-models">
          <div className="panelhead">
            <div>
              <h3>基盤モデル</h3>
              <p>基盤モデルのバージョンとファイルは従来どおり変更できます。</p>
            </div>
          </div>
          <div className="civit-model-grid">
            <SelectionCard
              entry={baseEntry}
              catalog={catalog}
              family={models.modelFamily}
              onSave={onSave}
            />
          </div>
        </section>
      )}
      {view !== 'base' && <section className="panel selected-models">
        <div className="panelhead">
          <div>
            <h3>最終選定LoRA</h3>
            <p>
              現在のmodels.jsonに保存されたLoRAのみを表示します。
              変更は下書きへ保存され、確定後に後工程の整合性を更新します。
            </p>
          </div>
          <strong>{models.loras.length}件</strong>
        </div>
        {models.loras.length ? (
          <div className="civit-model-grid">
            {models.loras.map((selection) => (
              <SelectionCard
                key={selection.ref}
                entry={{ selection, role: 'lora', label: 'LoRA' }}
                catalog={catalog}
                onSave={onSave}
                placement={placementByFile.get(selection.fileName)}
                placementLoading={placements === null}
                placementError={placementError}
              />
            ))}
          </div>
        ) : (
          <p className="selected-models-empty">
            LoRAは未選定です。選定結果を取り込むとここに表示されます。
          </p>
        )}
      </section>}
    </>
  );
}
