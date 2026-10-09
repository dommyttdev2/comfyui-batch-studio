import { useEffect, useRef, useState } from 'react';
import { api, type ResourceBindings } from './api';
import { assertModalContext, type ModalContext } from './modal';
import { workspace } from './workspace';
export interface ToolState {
  search: string;
  bucket: string;
  path: string;
  scroll: number;
  values?: Record<string, string>;
}
export interface ToolConfirmation {
  title: string;
  summary: Record<string, unknown>;
  submit: () => Promise<void>;
}
type Item = {
  modelId: number;
  modelName: string;
  modelType?: string;
  versionId: number;
  versionName: string;
  modelUrl?: string;
  trainedWords?: string[];
  files: { id: number; name: string }[];
  versions?: {
    versionId: number;
    versionName: string;
    files: { id: number; name: string }[];
    trainedWords?: string[];
  }[];
};
type Stage = {
  expectedHash: string | null;
  id: string;
  name: string;
  size: number;
  offset: number;
  state: string;
  projectId: string;
};
type Transfer = {
  id: string;
  receiptId: string;
  projectId: string;
  name: string;
  key: string;
  state: string;
  size: number;
  transferredBytes: number;
  canPause: boolean;
  canResume: boolean;
  canCancel: boolean;
};
const query = (fields: Record<string, string>) => new URLSearchParams(fields).toString();
export function Observation({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span>未設定</span>;
  if (Array.isArray(value))
    return (
      <ul>
        {value.map((v, i) => (
          <li key={String(i)}>
            <Observation value={v} />
          </li>
        ))}
      </ul>
    );
  if (typeof value === 'object')
    return (
      <dl>
        {Object.entries(value).map(([k, v]) => (
          <div key={k}>
            <dt>{labels[k] ?? k}</dt>
            <dd>
              <Observation value={v} />
            </dd>
          </div>
        ))}
      </dl>
    );
  return <span>{typeof value === 'boolean' ? (value ? 'はい' : 'いいえ') : String(value)}</span>;
}
const labels: Record<string, string> = {
  bucket: 'Bucket',
  key: '対象',
  destination: 'コピー先',
  name: '名前',
  size: 'サイズ（byte）',
  sha256: 'SHA-256',
  fingerprint: 'Host fingerprint',
  previousFingerprint: '以前のfingerprint',
  instanceId: 'Instance',
  projectId: 'Project',
  operation: '操作',
  conditionalCheck: '条件確認',
  sourceId: '転送元',
  price: '料金',
  storageGb: 'ディスク（GB）',
  hourlyTotal: '料金／時間',
  expiresAt: '有効期限',
  state: '状態',
  revision: '世代',
};
export function IntegrationTool({
  tool,
  state,
  mode,
  origin,
  onOrigin,
  onConfirm,
}: {
  tool: string;
  state: ToolState;
  mode: string;
  origin: ModalContext | null;
  onOrigin: (context: ModalContext) => void;
  onConfirm: (confirmation: ToolConfirmation) => void;
}) {
  const [, render] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [output, setOutput] = useState<unknown>(null),
    [status, setStatus] = useState('読み込み中'),
    [canManage, setCanManage] = useState(false);
  const [items, setItems] = useState<Item[]>([]),
    [objects, setObjects] = useState<{ key: string; size: number }[]>([]),
    [buckets, setBuckets] = useState<string[]>([]),
    [templates, setTemplates] = useState<
      { id: string; name: string; objects: { key: string; name: string; size: number }[] }[]
    >([]),
    [downloadLinks, setDownloadLinks] = useState<{ url: string; name: string }[]>([]),
    [transfers, setTransfers] = useState<Transfer[]>([]),
    [resources, setResources] = useState<{ id: string; name: string }[]>([]),
    [roots, setRoots] = useState<{ id: string; name: string }[]>([]),
    [file, setFile] = useState<File | null>(null),
    [stage, setStage] = useState<Stage | null>(null);
  const [instances, setInstances] = useState<{ id: number; status: string; gpuName?: string }[]>(
      [],
    ),
    [offers, setOffers] = useState<{ id: number; gpuName?: string; hourlyTotal?: number }[]>([]),
    [template, setTemplate] = useState<{ hashId: string } | null>(null),
    [sshKeys, setSshKeys] = useState<{ id: string; user: string }[]>([]),
    [settings, setSettings] = useState<{
      configured: boolean;
      revision: number;
      canManage: boolean;
      canRegisterSecrets: boolean;
      providers: {
        provider: string;
        state: string;
        revision: number;
        account?: string;
        publicUrl?: string | null;
      }[];
    } | null>(null),
    [secrets, setSecrets] = useState<Record<string, string>>({});
  const latestOrigin = useRef(origin);
  latestOrigin.current = origin;
  const savedBindings = origin
    ? workspace.tabs.find((t) => t.id === origin.projectId)?.project.resourceBindings
    : null;
  const lifetime = useRef({ live: true, serial: 0, user: workspace.user }),
    cancelUpload = useRef(false);
  const hashWorker = useRef<{ worker: Worker; reject(error: Error): void } | null>(null);
  function stopHash() {
    hashWorker.current?.worker.terminate();
    hashWorker.current?.reject(Error('FILE_HASH_CANCELLED'));
    hashWorker.current = null;
  }
  state.values ??= {};
  const values = state.values,
    value = (key: string, initial = '') => values[key] ?? initial;
  const set = (key: string, v: string) => {
    values[key] = v;
    render((n) => n + 1);
  };
  useEffect(() => {
    delete values.token;
    delete values.nextToken;
    delete values.object;
    setObjects([]);
    setTemplates([]);
    setDownloadLinks([]);
  }, [state.bucket, state.path, value('objectSearch')]);
  const projectId = value('projectId', origin?.projectId ?? ''),
    item = items[Number(value('item', '-1'))],
    version = item?.versions?.find((v) => String(v.versionId) === value('version')) ?? item,
    selectedFile = version?.files.find((f) => String(f.id) === value('file'));
  const still = () =>
    lifetime.current.live && workspace.authenticated && workspace.user === lifetime.current.user;
  const request = async <T,>(...args: Parameters<typeof api.request>): Promise<T> => {
    const scope = [state.search, state.bucket, state.path].join('\0');
    const result = await api.request<T>(...args);
    if (!still() || scope !== [state.search, state.bucket, state.path].join('\0'))
      throw Error('MODAL_VIEW_CHANGED');
    return result;
  };
  const run = async (work: () => Promise<unknown>) => {
    const n = ++lifetime.current.serial;
    setBusy(true);
    setError('');
    try {
      const result = await work();
      if (still() && n === lifetime.current.serial && result !== undefined) setOutput(result);
    } catch (e) {
      if (still() && n === lifetime.current.serial) setError((e as Error).message);
    } finally {
      if (still() && n === lifetime.current.serial) setBusy(false);
    }
  };
  useEffect(() => {
    lifetime.current.live = true;
    const provider =
      tool === 'Civitai Explorer'
        ? 'civitai'
        : tool === 'R2 Browser'
          ? 'r2'
          : tool === 'Vast.ai'
            ? 'vast'
            : null;
    void api
      .request<any>(provider ? '/integrations/' + provider + '/status' : '/integrations/settings')
      .then((v) => {
        if (!still()) return;
        if (provider) {
          setStatus(v.state);
          setCanManage(!!v.canManage);
        } else {
          setSettings(v);
          setStatus(v.configured ? '設定済み' : '未登録');
          setCanManage(v.canManage);
        }
      })
      .catch((e) => {
        if (still()) {
          setStatus('利用できません');
          setError(e.message);
        }
      });
    return () => {
      lifetime.current.live = false;
      lifetime.current.serial++;
      cancelUpload.current = true;
      stopHash();
    };
  }, [tool]);
  async function capture() {
    const origin = latestOrigin.current;
    if (!origin) throw Error('PROJECT_ORIGIN_REQUIRED');
    const initial = assertModalContext(workspace, origin);
    await workspace.flush(initial.id);
    if (!still()) throw Error('MODAL_CLOSED');
    const tab = workspace.tabs.find(
      (t) => t.id === origin.projectId && t.generation === origin.generation,
    );
    if (!tab || tab.key !== origin.key || !tab.project.lease?.ownedByCurrentSession)
      throw Error('MODAL_CONTEXT_CHANGED');
    const context = {
      ...origin,
      revision: tab.project.revision,
      leaseId: tab.project.lease.leaseId ?? '',
    };
    assertModalContext(workspace, context);
    latestOrigin.current = context;
    onOrigin(context);
    return {
      context,
      binding: {
        projectId: context.projectId,
        expectedRevision: context.revision,
        leaseId: context.leaseId,
      },
    };
  }
  async function prepare(
    operation: string,
    path: string,
    input: Record<string, unknown>,
    projectBound = false,
  ) {
    const bound = projectBound ? await capture() : null;
    const target = await request<{ targetId: string }>(path, input);
    if (!still()) return;
    if (bound) assertModalContext(workspace, bound.context);
    const prepared = await request<{
      confirmationId: string;
      summary: Record<string, unknown>;
      expiresAt: number;
    }>('/integrations/operations/prepare', {
      operation,
      targetId: target.targetId,
      binding: bound?.binding ?? null,
    });
    if (!still()) return;
    if (bound) assertModalContext(workspace, bound.context);
    onConfirm({
      title: '外部操作の確認',
      summary: {
        operation,
        ...prepared.summary,
        expiresAt: new Date(prepared.expiresAt).toLocaleString(),
      },
      submit: async () => {
        if (!still()) throw Error('MODAL_CLOSED');
        if (bound) assertModalContext(workspace, bound.context);
        const receipt = await request<any>('/integrations/operations/confirm', {
          operation,
          targetId: target.targetId,
          confirmationId: prepared.confirmationId,
        });
        if (still()) {
          set('receiptId', receipt.id);
          setOutput(receipt);
        }
      },
    });
  }
  const jobProject = (
    <label>
      Jobの対象Project
      <select
        aria-label="Jobの対象Project"
        value={projectId}
        onChange={(e) => set('projectId', e.target.value)}
      >
        <option value="">選択してください</option>
        {workspace.projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.displayName}
          </option>
        ))}
      </select>
    </label>
  );
  const refreshTransfers = async () => {
    const result = await request<{ transfers: Transfer[] }>('/integrations/r2/transfers');
    if (still()) setTransfers(result.transfers);
    return result;
  };
  async function readObjects(mode: 'list' | 'search', next = false) {
    const r = await request<{
      objects: { key: string; size: number }[];
      nextToken?: string | null;
    }>(
      '/integrations/r2/' +
        mode +
        '?' +
        query({
          bucket: state.bucket,
          ...(mode === 'list' ? { prefix: state.path } : { query: value('objectSearch') }),
          ...(next ? { token: value('nextToken') } : {}),
        }),
    );
    setObjects(r.objects);
    set('object', '');
    set('nextToken', r.nextToken ?? '');
    set('pageMode', mode);
    return { 件数: r.objects.length };
  }
  async function upload() {
    if (!file || !projectId) throw Error('SOURCE_REQUIRED');
    cancelUpload.current = false;
    const sha256 = await new Promise<string>((resolve, reject) => {
      const worker = new Worker(new URL('./file-hash-worker.ts', import.meta.url), {
        type: 'module',
      });
      hashWorker.current = { worker, reject };
      const finish = () => {
        worker.terminate();
        hashWorker.current = null;
      };
      worker.onerror = () => {
        finish();
        reject(Error('FILE_HASH_FAILED'));
      };
      worker.onmessage = (e) => {
        if (e.data.sha256) {
          finish();
          resolve(e.data.sha256);
        } else if (e.data.error) {
          finish();
          reject(Error(e.data.error));
        }
      };
      worker.postMessage(file);
    });
    if (!still() || cancelUpload.current) throw Error('FILE_HASH_CANCELLED');
    let current = stage;
    if (!current) {
      current = await request<Stage>('/resources/staging', {
        projectId,
        name: file.name,
        size: file.size,
        sha256,
      });
      if (still()) {
        setStage(current);
        set('stagingId', current.id);
      }
    } else {
      current = await request<Stage>('/resources/staging/' + current.id);
      if (
        current.projectId !== projectId ||
        current.name !== file.name ||
        current.expectedHash !== sha256 ||
        current.size !== file.size
      )
        throw Error('SOURCE_CHANGED');
    }
    while (current.offset < file.size) {
      if (cancelUpload.current || !still())
        return { state: '一時停止', stagingId: current.id, offset: current.offset };
      const bytes = new Uint8Array(
        await file.slice(current.offset, current.offset + 8 * 1024 * 1024).arrayBuffer(),
      );
      current = (await api.uploadChunk(current.id, current.offset, bytes)) as Stage;
      if (still()) setStage(current);
    }
    if (cancelUpload.current || !still())
      return { state: '一時停止', stagingId: current.id, offset: current.offset };
    const complete = await request<Stage>('/resources/staging/' + current.id + '/complete', {});
    if (still()) {
      setStage(complete);
      set('sourceKind', 'staging');
      set('sourceId', complete.id);
    }
    return complete;
  }
  const input = (label: string, key: string, initial = '', type = 'text') => (
    <label>
      {label}
      <input type={type} value={value(key, initial)} onChange={(e) => set(key, e.target.value)} />
    </label>
  );
  async function projectCommand(action: string, extra: Record<string, unknown>) {
    const { context } = await capture();
    assertModalContext(workspace, context);
    const p = await workspace.action(context.projectId, action, extra);
    if (!still()) return;
    const next = { ...context, revision: p.revision, leaseId: p.lease?.leaseId ?? '' };
    latestOrigin.current = next;
    onOrigin(next);
    return { state: 'Projectへ保存しました' };
  }
  const selection = () => {
    if (!item || !version || !selectedFile) throw Error('MODEL_FILE_REQUIRED');
    return {
      ref: 'checkpoint.main',
      modelId: item.modelId,
      modelName: item.modelName,
      versionId: version.versionId,
      versionName: version.versionName,
      fileId: selectedFile.id,
      fileName: selectedFile.name,
      modelUrl: item.modelUrl ?? 'https://civitai.com/models/' + item.modelId,
      trainedWords: version.trainedWords ?? [],
      reason: 'Civitai Explorerで選択',
    };
  };
  return (
    <section className="integration-tool">
      <p role="status">接続: {status}</p>
      {error && <p role="alert">{error}</p>}
      {tool === 'Civitai Explorer' && (
        <>
          <div className="tool-actions">
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const r = await request<{ items: Item[] }>(
                    '/integrations/civitai/search?' + query({ query: state.search }),
                  );
                  if (still()) {
                    setItems(r.items);
                    set('item', '-1');
                  }
                  return { 件数: r.items.length };
                })
              }
            >
              検索する
            </button>
            <button
              disabled={busy}
              onClick={() => void run(() => request('/integrations/civitai/collections'))}
            >
              Collection一覧
            </button>
          </div>
          {jobProject}
          <button
            disabled={busy || !projectId || status !== 'ready'}
            onClick={() => void run(() => request('/integrations/civitai/sync', { projectId }))}
          >
            Catalogを同期
          </button>
          <label>
            モデル
            <select
              aria-label="モデル候補"
              value={value('item', '-1')}
              onChange={(e) => {
                set('item', e.target.value);
                set('version', '');
                set('file', '');
              }}
            >
              <option value="-1">選択してください</option>
              {items.map((i, n) => (
                <option key={i.modelId + ':' + i.versionId} value={n}>
                  {i.modelName} / {i.versionName}
                </option>
              ))}
            </select>
          </label>
          {item && (
            <>
              <label>
                Version
                <select
                  value={value('version', String(item.versionId))}
                  onChange={(e) => {
                    set('version', e.target.value);
                    set('file', '');
                  }}
                >
                  {(item.versions ?? [item]).map((v) => (
                    <option key={v.versionId} value={v.versionId}>
                      {v.versionName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Weight file
                <select value={value('file')} onChange={(e) => set('file', e.target.value)}>
                  <option value="">選択してください</option>
                  {version?.files.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={busy}
                onClick={() =>
                  void run(() => request('/integrations/civitai/models/' + item.modelId))
                }
              >
                モデル詳細
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void run(() => request('/integrations/civitai/versions/' + version?.versionId))
                }
              >
                Version詳細
              </button>
            </>
          )}
          {mode === 'select' && (
            <>
              <label>
                Model family
                <select
                  value={value('family', 'illustrious')}
                  onChange={(e) => set('family', e.target.value)}
                >
                  <option value="illustrious">Illustrious</option>
                  <option value="anima">Anima</option>
                </select>
              </label>
              {value('family', 'illustrious') === 'anima' && (
                <>
                  {input('Text Encoder file', 'encoder')}
                  {input('VAE file', 'vae')}
                </>
              )}
              <button
                disabled={busy || !origin || !selectedFile}
                onClick={() =>
                  void run(() =>
                    projectCommand('configure-models', {
                      family: value('family', 'illustrious'),
                      base: selection(),
                      ...(value('family', 'illustrious') === 'anima'
                        ? {
                            textEncoder: {
                              ref: 'text_encoder.main',
                              fileName: value('encoder'),
                              reason: 'Explorerで選択',
                            },
                            vae: {
                              ref: 'vae.main',
                              fileName: value('vae'),
                              reason: 'Explorerで選択',
                            },
                          }
                        : {}),
                    }),
                  )
                }
              >
                Projectへ選択を確定
              </button>
              {input('LoRA ref', 'loraRef', 'lora.selected')}
              <button
                disabled={busy || !origin || !selectedFile}
                onClick={() =>
                  void run(async () => {
                    const { context } = await capture();
                    const tab = assertModalContext(workspace, context);
                    const source = tab.project.drafts.models ?? tab.project.artifacts.models;
                    if (!source) throw Error('MODELS_REQUIRED');
                    const models = JSON.parse(source.content),
                      chosen = {
                        ...selection(),
                        ref: value('loraRef', 'lora.selected'),
                      };
                    return projectCommand('import-loras', {
                      stage: 'models',
                      payload: {
                        schemaVersion: 1,
                        loras: [
                          ...models.loras.filter((l: { ref: string }) => l.ref !== chosen.ref),
                          chosen,
                        ],
                      },
                    });
                  })
                }
              >
                LoRAを下書きへ追加・更新
              </button>
              {input('置き換えるmodel ref', 'modelRef', 'checkpoint.main')}
              <button
                disabled={busy || !origin || !selectedFile}
                onClick={() =>
                  void run(async () => {
                    const { context } = await capture();
                    const tab = assertModalContext(workspace, context),
                      raw = tab.project.drafts.models ?? tab.project.artifacts.models;
                    if (!raw) throw Error('MODELS_REQUIRED');
                    const models = JSON.parse(raw.content),
                      expected = [
                        models.checkpoint,
                        models.diffusionModel,
                        ...(models.loras ?? []),
                      ].find((s) => s?.ref === value('modelRef', 'checkpoint.main'));
                    if (!expected) throw Error('MODEL_SLOT_REQUIRED');
                    return projectCommand('replace-models', {
                      expected,
                      next: { ...selection(), ref: expected.ref },
                    });
                  })
                }
              >
                既存モデルを置換
              </button>
            </>
          )}
        </>
      )}
      {tool === 'R2 Browser' && (
        <>
          <div className="tool-actions">
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const r = await request<{ buckets: { name: string }[] }>(
                    '/integrations/r2/buckets',
                  );
                  if (still()) setBuckets(r.buckets.map((b) => b.name));
                  return r;
                })
              }
            >
              Bucket一覧
            </button>
            <button
              disabled={busy || !state.bucket}
              onClick={() => void run(() => readObjects('list'))}
            >
              Object一覧
            </button>
            <button
              disabled={busy || !value('nextToken')}
              onClick={() =>
                void run(() => readObjects(value('pageMode') as 'list' | 'search', true))
              }
            >
              次ページ
            </button>
          </div>
          {buckets.length > 0 && <p>Bucket: {buckets.join(' / ')}</p>}
          {input('Object検索', 'objectSearch')}
          <button
            disabled={busy || !state.bucket}
            onClick={() => void run(() => readObjects('search'))}
          >
            Indexを検索
          </button>
          <button
            disabled={busy || !canManage || !projectId}
            onClick={() => void run(() => request('/integrations/r2/index', { projectId }))}
          >
            Indexを同期
          </button>
          <button
            disabled={busy}
            onClick={() => void run(() => request('/integrations/r2/metrics'))}
          >
            転送・Index情報
          </button>
          <label>
            Object
            <select
              aria-label="Object"
              value={value('object')}
              onChange={(e) => set('object', e.target.value)}
            >
              <option value="">選択してください</option>
              {objects.map((o) => (
                <option key={o.key}>{o.key}</option>
              ))}
            </select>
          </label>
          <div className="tool-actions">
            <button
              disabled={busy || !value('object')}
              onClick={() =>
                void run(() =>
                  request(
                    '/integrations/r2/metadata?' +
                      query({ bucket: state.bucket, key: value('object') }),
                  ),
                )
              }
            >
              Object詳細
            </button>
            <button
              disabled={busy || !canManage || !value('object')}
              onClick={() =>
                void run(async () => {
                  const r = await request<{ url: string; expiresAt: number }>(
                    '/integrations/r2/download-info',
                    { bucket: state.bucket, key: value('object'), expiresIn: 300 },
                  );
                  if (!still()) return;
                  const link = document.createElement('a');
                  link.href = r.url;
                  link.download = value('object').split('/').at(-1) ?? '';
                  link.rel = 'noreferrer';
                  link.target = '_blank';
                  link.click();
                  return {
                    state: 'ダウンロードを開始しました',
                    expiresAt: new Date(r.expiresAt).toLocaleString(),
                  };
                })
              }
            >
              ダウンロード
            </button>
          </div>
          {input('コピー・移動先key', 'destination')}
          <div className="tool-actions">
            {['copy-object', 'move-object', 'delete-objects', 'create-bucket', 'delete-bucket'].map(
              (operation) => (
                <button
                  key={operation}
                  disabled={
                    busy ||
                    !canManage ||
                    !state.bucket ||
                    (['copy-object', 'move-object'].includes(operation) && !origin)
                  }
                  onClick={() =>
                    void run(() =>
                      prepare(
                        operation,
                        '/integrations/r2/targets',
                        {
                          operation,
                          bucket: state.bucket,
                          keys: operation.endsWith('bucket') ? [] : [value('object')],
                          ...(['copy-object', 'move-object'].includes(operation)
                            ? { destination: value('destination'), projectId: origin?.projectId }
                            : {}),
                        },
                        ['copy-object', 'move-object'].includes(operation),
                      ),
                    )
                  }
                >
                  {
                    (
                      {
                        'copy-object': 'コピーを確認',
                        'move-object': '移動を確認',
                        'delete-objects': '削除を確認',
                        'create-bucket': 'Bucket作成を確認',
                        'delete-bucket': 'Bucket削除を確認',
                      } as Record<string, string>
                    )[operation]
                  }
                </button>
              ),
            )}
          </div>
          <h3>転送元</h3>
          {jobProject}
          <label>
            Browser file
            <input
              type="file"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
              }}
            />
          </label>
          {input('再開するstaging ID', 'stagingId')}
          <button
            disabled={busy || !value('stagingId')}
            onClick={() =>
              void run(async () => {
                const r = await request<Stage>('/resources/staging/' + value('stagingId'));
                if (still()) setStage(r);
                return r;
              })
            }
          >
            stagingを開く
          </button>
          <button disabled={busy || !file || !projectId} onClick={() => void run(upload)}>
            Browser fileをstagingへ送る
          </button>
          <button
            disabled={!busy || !file}
            onClick={() => {
              cancelUpload.current = true;
              stopHash();
            }}
          >
            staging送信を一時停止
          </button>
          {stage && (
            <p>
              staging: {stage.name} / {stage.offset} / {stage.size} / {stage.state}
            </p>
          )}
          <button
            disabled={busy || !stage}
            onClick={() =>
              void run(async () => {
                const r = await request('/resources/staging/' + stage!.id + '/delete', {});
                if (still()) {
                  setStage(null);
                  set('stagingId', '');
                }
                return r;
              })
            }
          >
            stagingを削除
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const r = await request<{ resources: { id: string; name: string }[] }>(
                  '/resources/files',
                );
                if (still()) setResources(r.resources);
                return { 件数: r.resources.length };
              })
            }
          >
            登録済みserver file
          </button>
          <label>
            転送するresource
            <select
              value={value('sourceId')}
              onChange={(e) => {
                set('sourceId', e.target.value);
                set('sourceKind', 'server-file');
              }}
            >
              <option value="">選択してください</option>
              {stage?.state === 'complete' && (
                <option value={stage.id}>{stage.name}（staging）</option>
              )}
              {resources.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={busy || !origin || !canManage || !value('sourceId')}
            onClick={() =>
              void run(() =>
                prepare(
                  'upload-object',
                  '/integrations/r2/transfers/targets',
                  {
                    projectId: origin!.projectId,
                    sourceKind: stage?.id === value('sourceId') ? 'staging' : 'server-file',
                    sourceId: value('sourceId'),
                    bucket: state.bucket,
                    prefix: state.path.replace(/\/$/, ''),
                  },
                  true,
                ),
              )
            }
          >
            R2転送を確認
          </button>
          <h3>転送job</h3>
          <button disabled={busy} onClick={() => void run(refreshTransfers)}>
            転送状況を更新
          </button>
          {transfers.map((t) => (
            <article key={t.id}>
              <p>
                {t.name} / {t.state} / {t.transferredBytes} / {t.size}
              </p>
              {(['pause', 'resume', 'cancel', 'reconcile'] as const).map((action) => (
                <button
                  key={action}
                  disabled={
                    busy ||
                    (action === 'pause' && !t.canPause) ||
                    (action === 'resume' && (!t.canResume || origin?.projectId !== t.projectId)) ||
                    (action === 'cancel' && !t.canCancel)
                  }
                  onClick={() =>
                    void run(async () => {
                      let body = {};
                      if (action === 'resume') {
                        const bound = await capture();
                        if (bound.context.projectId !== t.projectId)
                          throw Error('MODAL_CONTEXT_CHANGED');
                        body = { binding: bound.binding };
                      }
                      const r = await request(
                        '/integrations/r2/transfers/' + t.id + '/' + action,
                        body,
                      );
                      await refreshTransfers();
                      return r;
                    })
                  }
                >
                  {{ pause: '停止', resume: '再開', cancel: '取消', reconcile: '照合' }[action]}
                </button>
              ))}
            </article>
          ))}
          <h3>Download template</h3>
          {input('Template名', 'templateName')}
          <button
            disabled={busy || !state.bucket}
            onClick={() =>
              void run(async () => {
                const r = await request<any>(
                  '/integrations/r2/templates?' + query({ bucket: state.bucket }),
                );
                set('templateRevision', String(r.revision));
                setTemplates(r.templates);
                return r;
              })
            }
          >
            Template一覧
          </button>
          <button
            disabled={busy || !canManage || !value('templateRevision') || !value('object')}
            onClick={() =>
              void run(() =>
                request('/integrations/r2/save-template', {
                  expectedRevision: Number(value('templateRevision')),
                  template: {
                    name: value('templateName'),
                    bucket: state.bucket,
                    objects: [{ key: value('object'), name: value('object').split('/').at(-1) }],
                  },
                }),
              )
            }
          >
            選択ObjectをTemplate保存
          </button>
          <label>
            Download template
            <select
              aria-label="Download template"
              value={value('downloadTemplate')}
              onChange={(e) => set('downloadTemplate', e.target.value)}
            >
              <option value="">選択してください</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={busy || !canManage || !value('downloadTemplate')}
            onClick={() =>
              void run(async () => {
                const template = templates.find((t) => t.id === value('downloadTemplate'));
                if (!template) throw Error('TEMPLATE_REQUIRED');
                const r = await request<{
                  objects: { url: string; name: string }[];
                  expiresAt: number;
                }>('/integrations/r2/batch-download-info', {
                  bucket: state.bucket,
                  objects: template.objects,
                  expiresIn: 300,
                });
                setDownloadLinks(r.objects);
                return {
                  state: '取得リンクを発行しました',
                  expiresAt: new Date(r.expiresAt).toLocaleString(),
                };
              })
            }
          >
            Templateの取得リンクを発行
          </button>
          {downloadLinks.map((link, i) => (
            <p key={String(i)}>
              <a href={link.url} target="_blank" rel="noreferrer" download={link.name}>
                {link.name}を取得
              </a>
            </p>
          ))}
          {input('PUT先Object key', 'putKey')}
          {input('PUT Content-Type', 'putType', 'application/octet-stream')}
          <button
            disabled={busy || !canManage || !state.bucket || !value('putKey')}
            onClick={() =>
              void run(() =>
                request('/integrations/r2/put-url-info', {
                  bucket: state.bucket,
                  key: value('putKey'),
                  contentType: value('putType', 'application/octet-stream'),
                  expiresIn: 300,
                }),
              )
            }
          >
            条件付きPUT URLを発行
          </button>
          {input('削除するTemplate ID', 'templateId')}
          <button
            disabled={busy || !canManage || !value('templateId')}
            onClick={() =>
              void run(() =>
                request('/integrations/r2/delete-template', {
                  expectedRevision: Number(value('templateRevision')),
                  id: value('templateId'),
                }),
              )
            }
          >
            Template削除
          </button>
          {mode === 'select' && (
            <button
              disabled={busy || !origin || !state.bucket || status !== 'ready'}
              onClick={() =>
                void run(() =>
                  projectCommand('configure-resources', {
                    bindings: {
                      executionTarget: 'remote',
                      localRootId: null,
                      r2Bucket: state.bucket,
                      r2Prefix: state.path.replace(/\/$/, ''),
                      remoteInstanceId: null,
                    },
                  }),
                )
              }
            >
              Projectへ選択を確定
            </button>
          )}
        </>
      )}
      {tool === 'Vast.ai' && (
        <>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const r = await request<{ instances: typeof instances }>(
                  '/integrations/vast/instances',
                );
                if (still()) setInstances(r.instances);
                return r;
              })
            }
          >
            Instance一覧
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const r = await request<{ template: { hashId: string } }>(
                  '/integrations/vast/template',
                );
                if (still()) setTemplate(r.template);
                return r;
              })
            }
          >
            Templateを取得
          </button>
          {input('ディスク（GB）', 'disk', '100', 'number')}
          {input('最小TFLOPS', 'flops', '0', 'number')}
          {input('GPU数', 'gpuCount', '1', 'number')}
          {input('最小reliability', 'reliability', '0.98', 'number')}
          {input('除外国（カンマ区切り）', 'countries')}
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const r = await request<{
                  offers: typeof offers;
                  template: { hashId: string };
                }>('/integrations/vast/search', {
                  storageGb: Number(value('disk', '100')),
                  minTflops: Number(value('flops', '0')),
                  gpuCount: Number(value('gpuCount', '1')),
                  minReliability: Number(value('reliability', '0.98')),
                  excludedCountries: value('countries')
                    .split(',')
                    .map((c) => c.trim())
                    .filter(Boolean),
                });
                if (still()) {
                  setOffers(r.offers);
                  setTemplate(r.template);
                }
                return { 件数: r.offers.length };
              })
            }
          >
            Offerを検索
          </button>
          <label>
            Offer
            <select value={value('offer')} onChange={(e) => set('offer', e.target.value)}>
              <option value="">選択してください</option>
              {offers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.gpuName} / {o.id} / {o.hourlyTotal ?? ''}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={busy || !canManage || !template || !value('offer')}
            onClick={() =>
              void run(() =>
                prepare('rent-instance', '/integrations/vast/targets', {
                  operation: 'rent-instance',
                  rent: {
                    offerId: Number(value('offer')),
                    storageGb: Number(value('disk', '100')),
                    templateHashId: template!.hashId,
                  },
                }),
              )
            }
          >
            RENT料金を確認
          </button>
          <label>
            Instance
            <select value={value('instance')} onChange={(e) => set('instance', e.target.value)}>
              <option value="">選択してください</option>
              {instances.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.id} / {i.status} / {i.gpuName}
                </option>
              ))}
            </select>
          </label>
          <div className="tool-actions">
            {['start-instance', 'stop-instance', 'reboot-instance', 'delete-instance'].map(
              (operation) => (
                <button
                  key={operation}
                  disabled={busy || !canManage || !value('instance')}
                  onClick={() =>
                    void run(() =>
                      prepare(operation, '/integrations/vast/targets', {
                        operation,
                        instanceId: Number(value('instance')),
                      }),
                    )
                  }
                >
                  {
                    (
                      {
                        'start-instance': '起動を確認',
                        'stop-instance': '停止を確認',
                        'reboot-instance': '再起動を確認',
                        'delete-instance': '破棄を確認',
                      } as Record<string, string>
                    )[operation]
                  }
                </button>
              ),
            )}
          </div>
          <button
            disabled={busy || !canManage}
            onClick={() =>
              void run(async () => {
                const r = await request<{ resources: typeof sshKeys }>('/integrations/ssh/keys');
                if (still()) setSshKeys(r.resources);
                return r;
              })
            }
          >
            登録SSH key一覧
          </button>
          <label>
            SSH key
            <select value={value('sshKey')} onChange={(e) => set('sshKey', e.target.value)}>
              <option value="">選択してください</option>
              {sshKeys.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.id} / {k.user}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={busy || !value('instance') || !value('sshKey') || !canManage}
            onClick={() =>
              void run(() =>
                prepare('trust-ssh', '/integrations/ssh/targets', {
                  instanceId: Number(value('instance')),
                  keyId: value('sshKey'),
                }),
              )
            }
          >
            Host fingerprintを確認
          </button>
          <button
            disabled={busy || !value('instance') || !canManage}
            onClick={() =>
              void run(() =>
                request('/integrations/ssh/endpoint', {
                  instanceId: Number(value('instance')),
                }),
              )
            }
          >
            信頼済みSSH接続を確認
          </button>
          {mode === 'select' && (
            <button
              disabled={busy || !origin || !value('instance')}
              onClick={() =>
                void run(async () => {
                  const { context } = await capture();
                  const p = assertModalContext(workspace, context).project;
                  if (!p.resourceBindings) throw Error('RESOURCE_BINDINGS_REQUIRED');
                  return projectCommand('configure-resources', {
                    bindings: {
                      ...p.resourceBindings,
                      executionTarget: 'remote',
                      remoteInstanceId: Number(value('instance')),
                    },
                  });
                })
              }
            >
              Projectへ選択を確定
            </button>
          )}
        </>
      )}
      {tool === 'サービス連携' && (
        <>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const r = await request<typeof settings>('/integrations/settings');
                if (still()) setSettings(r);
                return r;
              })
            }
          >
            連携設定を更新
          </button>
          {settings && (
            <>
              <Observation value={settings.providers} />
              {!settings.configured && <p>新Webの設定元を管理CLIで明示登録してください。</p>}
              <label>
                設定するサービス
                <select
                  value={value('provider', 'civitai')}
                  onChange={(e) => {
                    set('provider', e.target.value);
                    setSecrets({});
                  }}
                >
                  <option value="civitai">Civitai</option>
                  <option value="r2">R2</option>
                  <option value="vast">Vast.ai</option>
                </select>
              </label>
              {value('provider', 'civitai') === 'r2' && (
                <>
                  {input('R2 account', 'account')}
                  {input('公開URL', 'publicUrl')}
                </>
              )}
              {settings.canRegisterSecrets ? (
                (['r2'].includes(value('provider', 'civitai'))
                  ? ['accessKeyId', 'secretAccessKey']
                  : ['apiKey']
                ).map((key) => (
                  <label key={key}>
                    {key}
                    <input
                      type="password"
                      autoComplete="off"
                      value={secrets[key] ?? ''}
                      onChange={(e) => setSecrets((s) => ({ ...s, [key]: e.target.value }))}
                    />
                  </label>
                ))
              ) : (
                <p>認証情報は管理CLIで指定した環境変数を使います。</p>
              )}
              <button
                disabled={busy || !settings.canManage || !settings.configured}
                onClick={() =>
                  void run(async () => {
                    try {
                      const provider = value('provider', 'civitai'),
                        payload = {
                          enabled: true,
                          ...(provider === 'r2'
                            ? {
                                account: value(
                                  'account',
                                  settings.providers.find((p) => p.provider === 'r2')?.account ??
                                    '',
                                ),
                                ...(value('publicUrl') ? { publicUrl: value('publicUrl') } : {}),
                              }
                            : {}),
                          ...(Object.values(secrets).some(Boolean) ? { secrets } : {}),
                        };
                      const r = await request<typeof settings>('/integrations/settings', {
                        provider,
                        expectedRevision: settings.revision,
                        settings: payload,
                      });
                      if (still()) setSettings(r);
                      return { state: '設定を保存しました' };
                    } finally {
                      setSecrets({});
                    }
                  })
                }
              >
                設定を保存
              </button>
              <button
                disabled={busy || !settings.canManage || !settings.configured}
                onClick={() =>
                  void run(async () => {
                    const provider = value('provider', 'civitai'),
                      previous = settings.providers.find((p) => p.provider === provider);
                    const r = await request<typeof settings>('/integrations/settings', {
                      provider,
                      expectedRevision: settings.revision,
                      settings: {
                        enabled: false,
                        ...(provider === 'r2' ? { account: previous?.account } : {}),
                      },
                    });
                    if (still()) setSettings(r);
                    return { state: 'サービスを無効化しました' };
                  })
                }
              >
                サービスを無効化
              </button>
            </>
          )}
        </>
      )}
      {tool === '環境設定' && (
        <>
          {!origin ? (
            <p>Projectタブから環境設定を開いてください。</p>
          ) : (
            <>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const r = await request<{ roots: typeof roots }>(
                      '/projects/' + origin.projectId + '/resource-roots',
                    );
                    if (still()) setRoots(r.roots);
                    return { 件数: r.roots.length };
                  })
                }
              >
                登録モデルrootを取得
              </button>
              <label>
                実行先
                <select
                  aria-label="実行先"
                  value={value(
                    'executionTarget',
                    workspace.tabs.find((t) => t.id === origin.projectId)?.project.resourceBindings
                      ?.executionTarget ?? 'local',
                  )}
                  onChange={(e) => set('executionTarget', e.target.value)}
                >
                  <option value="local">Local</option>
                  <option value="remote">Remote</option>
                </select>
              </label>
              <label>
                モデルroot
                <select
                  value={value(
                    'localRootId',
                    workspace.tabs.find((t) => t.id === origin.projectId)?.project.resourceBindings
                      ?.localRootId ?? '',
                  )}
                  onChange={(e) => set('localRootId', e.target.value)}
                >
                  <option value="">未設定</option>
                  {roots.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              {input(
                'モデルR2 Bucket',
                'resourceBucket',
                workspace.tabs.find((t) => t.id === origin.projectId)?.project.resourceBindings
                  ?.r2Bucket ?? '',
              )}
              {input(
                'モデルR2 prefix',
                'resourcePrefix',
                workspace.tabs.find((t) => t.id === origin.projectId)?.project.resourceBindings
                  ?.r2Prefix ?? '',
              )}
              {input(
                'Remote Instance',
                'resourceInstance',
                String(
                  workspace.tabs.find((t) => t.id === origin.projectId)?.project.resourceBindings
                    ?.remoteInstanceId ?? '',
                ),
                'number',
              )}
              <button
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    projectCommand('configure-resources', {
                      bindings: {
                        executionTarget: value(
                          'executionTarget',
                          savedBindings?.executionTarget ?? 'local',
                        ) as ResourceBindings['executionTarget'],
                        localRootId: value('localRootId', savedBindings?.localRootId ?? '') || null,
                        r2Bucket: value('resourceBucket', savedBindings?.r2Bucket ?? '') || null,
                        r2Prefix: value('resourcePrefix', savedBindings?.r2Prefix ?? ''),
                        remoteInstanceId: value(
                          'resourceInstance',
                          String(savedBindings?.remoteInstanceId ?? ''),
                        )
                          ? Number(
                              value(
                                'resourceInstance',
                                String(savedBindings?.remoteInstanceId ?? ''),
                              ),
                            )
                          : null,
                      } satisfies ResourceBindings,
                    }),
                  )
                }
              >
                Project環境を保存
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const { context } = await capture();
                    const r = await request('/projects/' + context.projectId + '/availability');
                    if (still()) assertModalContext(workspace, context);
                    return r;
                  })
                }
              >
                モデル可用性を確認
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const { context } = await capture();
                    const r = await request('/projects/' + context.projectId + '/preflight');
                    if (still()) assertModalContext(workspace, context);
                    return r;
                  })
                }
              >
                Preflightを確認
              </button>
            </>
          )}
        </>
      )}
      {value('receiptId') && (
        <aside>
          <p>外部操作receipt: {value('receiptId')}</p>
          <button
            disabled={busy}
            onClick={() =>
              void run(() => request('/integrations/operations/receipts/' + value('receiptId')))
            }
          >
            外部操作の状態を更新
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void run(() =>
                request('/integrations/operations/reconcile/' + value('receiptId'), {}),
              )
            }
          >
            外部操作を照合
          </button>
        </aside>
      )}
      {busy && <p>処理中…</p>}
      {output !== null && (
        <div className="tool-result" aria-label="操作結果">
          <Observation value={output} />
        </div>
      )}
    </section>
  );
}
