import { useEffect, useState } from 'react';
import type {
  CatalogItem,
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
}: {
  entry: SelectionEntry;
  catalog: ModelCatalog;
  family?: ModelFamily;
  onSave: (current: ModelSelectionBase, next: ModelSelectionBase) => Promise<void>;
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

  const item: CatalogItem | null = catalogItemForSelection(catalog, selection, role, family);
  const matches = item ? candidateVersions(item, role, family) : [];
  const match = matches.find((candidate) => candidate.version.versionId === pending.versionId);
  const file = match?.files.find((candidate) => candidate.id === pending.fileId);
  const changed = pending.versionId !== selection.versionId || pending.fileId !== selection.fileId;
  const image = match?.version.thumbnailUrl ?? item?.thumbnailUrl;
  const trained =
    match?.version.trainedWords ??
    (match?.version.versionId === item?.versionId ? item?.trainedWords : undefined) ??
    [];
  const modelUrl = `https://civitai.com/models/${selection.modelId}?modelVersionId=${match?.version.versionId ?? selection.versionId}`;
  const baseline =
    match?.version.strengthBaseline ??
    (match?.version.versionId === item?.versionId ? item?.strengthBaseline : undefined);

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
            このモデルの使用可能なバージョンがカタログにありません。Civitaiモデルカタログを同期してください。
          </div>
        )}
        {error && <div className="issue error">✕ {error}</div>}
      </div>
    </article>
  );
}

export function SelectedModelCards({
  models,
  catalog,
  onSave,
}: {
  models: ModelsArtifact;
  catalog: ModelCatalog;
  onSave: (current: ModelSelectionBase, next: ModelSelectionBase) => Promise<void>;
}) {
  const base = models.modelFamily === 'anima' ? models.diffusionModel : models.checkpoint;
  const entries: SelectionEntry[] = [
    ...(base
      ? [
          {
            selection: base,
            role: 'checkpoint' as const,
            label: models.modelFamily === 'anima' ? 'Diffusion Model' : 'Checkpoint',
          },
        ]
      : []),
    ...models.loras.map((selection) => ({
      selection,
      role: 'lora' as const,
      label: 'LoRA',
    })),
  ];
  if (!entries.length) return null;
  return (
    <section className="panel selected-models">
      <div className="panelhead">
        <div>
          <h3>選定済みモデル</h3>
          <p>
            バージョンとファイルを後から手動で指定できます。
            変更はmodels.jsonの下書きへ保存され、確定時に後工程の整合性を更新します。
          </p>
        </div>
        <strong>{entries.length}件</strong>
      </div>
      <div className="civit-model-grid">
        {entries.map((entry) => (
          <SelectionCard
            key={entry.selection.ref}
            entry={entry}
            catalog={catalog}
            family={entry.role === 'checkpoint' ? models.modelFamily : undefined}
            onSave={onSave}
          />
        ))}
      </div>
    </section>
  );
}
