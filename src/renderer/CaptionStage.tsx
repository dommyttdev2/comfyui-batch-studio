import { useEffect, useState } from 'react';
import type {
  AssistantPaneProvider,
  CaptionStatus,
  ImportResult,
  ProjectSummary,
} from '../shared/types';
import { GrokBridge } from './GrokStages';
import type { Runner } from './ui';
import { issuesView } from './ui';

const CAPTION_STATE_LABELS: Record<CaptionStatus['state'], string> = {
  unconfigured: '最終成果物工程でディレクトリを指定してください',
  'source-missing': '最終成果物ディレクトリが見つかりません',
  'missing-content': 'タイトル・説明文が未生成',
  'invalid-content': 'タイトル・説明文に検証エラーがあります',
  ready: 'caption.txt を生成できます',
  generated: '生成済み',
  stale: '更新必要',
};

export function CaptionStage({
  project,
  run,
  provider,
}: {
  project: ProjectSummary;
  run: Runner;
  provider: AssistantPaneProvider;
}) {
  const [status, setStatus] = useState<CaptionStatus | null>(null);
  const [pixivJa, setPixivJa] = useState('');
  const [pixivEn, setPixivEn] = useState('');

  const load = () =>
    run(async () => {
      setStatus(await window.batchStudio.caption.status(project.rootPath));
    });

  useEffect(() => {
    void load();
  }, [project.rootPath]);

  useEffect(() => {
    setPixivJa(status?.content?.pixivTitle?.ja ?? '');
    setPixivEn(status?.content?.pixivTitle?.en ?? '');
  }, [project.rootPath, status?.content?.pixivTitle?.ja, status?.content?.pixivTitle?.en]);

  const importCaption = async (raw: string): Promise<ImportResult> => {
    const result = await window.batchStudio.caption.importGrok(project.rootPath, raw);
    setStatus(await window.batchStudio.caption.status(project.rootPath));
    return result;
  };

  const pixivJaLength = Array.from(pixivJa).length;
  const pixivEnLength = Array.from(pixivEn).length;
  const pixivChanged =
    pixivJa.trim() !== (status?.content?.pixivTitle?.ja ?? '') ||
    pixivEn.trim() !== (status?.content?.pixivTitle?.en ?? '');
  const canSavePixiv =
    Boolean(status?.content) &&
    pixivChanged &&
    Boolean(pixivJa.trim()) &&
    Boolean(pixivEn.trim()) &&
    pixivJaLength <= 32 &&
    pixivEnLength <= 32 &&
    !/[\r\n\u2028\u2029]/.test(pixivJa + pixivEn);

  const canGenerate =
    status?.sourceExists === true &&
    status.imageCount > 0 &&
    status.contentValidation.valid &&
    status.content !== null;

  return (
    <>
      <GrokBridge
        project={project}
        stage="caption"
        provider={provider}
        title="1. タイトル・説明文・Pixiv用タイトルを生成"
        run={run}
        onImport={importCaption}
        onAutoImported={async () =>
          setStatus(await window.batchStudio.caption.status(project.rootPath))
        }
      />

      <section className="panel">
        <div className="panelhead">
          <div>
            <h3>2. Pixiv用タイトル</h3>
            <p>日本語・英語とも32文字以内です。編集後は保存してください。</p>
          </div>
          <button
            className="primary"
            disabled={!canSavePixiv}
            onClick={() =>
              void run(async () => {
                setStatus(
                  await window.batchStudio.caption.savePixivTitle(project.rootPath, {
                    ja: pixivJa,
                    en: pixivEn,
                  }),
                );
              })
            }
          >
            Pixiv用タイトルを保存
          </button>
        </div>
        {status?.content?.schemaVersion === 1 && (
          <div className="issue warning">
            既存のキャプションは旧形式です。Grokで再生成するか、日本語・英語タイトルを入力して保存してください。
          </div>
        )}
        <div className="caption-pixiv-fields">
          <label className="caption-pixiv-field">
            <span>日本語タイトル</span>
            <input
              type="text"
              value={pixivJa}
              onChange={(event) => setPixivJa(event.target.value)}
              placeholder="Pixiv用日本語タイトル"
              disabled={!status?.content}
            />
          </label>
          <div className="caption-pixiv-actions">
            <span className={pixivJaLength > 32 ? 'issue error' : 'hint'}>
              {pixivJaLength} / 32文字
            </span>
            <button
              disabled={!pixivJa.trim() || pixivJaLength > 32}
              onClick={() => void window.batchStudio.clipboard.writeText(pixivJa)}
            >
              日本語タイトルをコピー
            </button>
          </div>
          <label className="caption-pixiv-field">
            <span>English title</span>
            <input
              type="text"
              value={pixivEn}
              onChange={(event) => setPixivEn(event.target.value)}
              placeholder="English title for Pixiv"
              disabled={!status?.content}
            />
          </label>
          <div className="caption-pixiv-actions">
            <span className={pixivEnLength > 32 ? 'issue error' : 'hint'}>
              {pixivEnLength} / 32 characters
            </span>
            <button
              disabled={!pixivEn.trim() || pixivEnLength > 32}
              onClick={() => void window.batchStudio.clipboard.writeText(pixivEn)}
            >
              English titleをコピー
            </button>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panelhead">
          <div>
            <h3>3. caption.txt</h3>
            <p>
              最終成果物工程で指定したディレクトリを参照し、取り込んだタイトル・説明文に実測した収録枚数と定型注意書きを組み合わせます。
            </p>
          </div>
          <div className="actions">
            <button onClick={() => void load()}>再スキャン</button>
            {status?.captionExists && (
              <button onClick={() => window.batchStudio.file.showInFolder(status.captionPath)}>
                場所を開く
              </button>
            )}
            <button
              className="primary"
              disabled={!canGenerate}
              onClick={() =>
                run(async () => {
                  setStatus(await window.batchStudio.caption.generate(project.rootPath));
                })
              }
            >
              caption.txt を生成
            </button>
          </div>
        </div>

        <div className="facts">
          <div>
            状態 <b>{status ? CAPTION_STATE_LABELS[status.state] : '読み込み中'}</b>
          </div>
          <div>
            最終成果物 <b>{status?.sourceDirectory ?? '未設定'}</b>
          </div>
          <div>
            画像枚数 <b>{status?.imageCount ?? 0} 枚</b>
          </div>
        </div>

        {status?.sourceDirectory && !status.sourceExists && (
          <div className="issue error">✕ 指定された最終成果物ディレクトリが見つかりません。</div>
        )}
        {status?.sourceExists && status.imageCount === 0 && (
          <div className="issue warning">⚠ 最終成果物ディレクトリに対象画像がありません。</div>
        )}
        {status?.stale && (
          <div className="issue warning">
            ⚠ 最終成果物の画像枚数またはキャプション本文が生成時から変更されています。caption.txt
            を再生成してください。
          </div>
        )}

        {status && issuesView(status.contentValidation.issues)}

        {status?.content && (
          <div className="facts">
            <div>
              日本語タイトル <b>{status.content.title.ja}</b>
            </div>
            <div>
              English title <b>{status.content.title.en}</b>
            </div>
            <div>
              説明文 <b>{status.content.description.ja.length} 段落</b>
            </div>
            <div>
              内容一覧 <b>{status.content.contents?.ja.length ?? 0} 件</b>
            </div>
          </div>
        )}

        <label className="wide">
          プレビュー
          <textarea
            className="editor"
            readOnly
            value={status?.preview ?? ''}
            placeholder="タイトル・説明文・最終成果物ディレクトリ・画像が揃うとプレビューを表示します。"
          />
        </label>

        {status?.build && (
          <p className="hint">
            前回生成: {status.build.imageCount} 枚 · {status.build.generatedAt}
          </p>
        )}
      </section>
    </>
  );
}
