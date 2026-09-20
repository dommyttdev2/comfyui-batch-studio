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

  const load = () =>
    run(async () => {
      setStatus(await window.batchStudio.caption.status(project.rootPath));
    });

  useEffect(() => {
    void load();
  }, [project.rootPath]);

  const importCaption = async (raw: string): Promise<ImportResult> => {
    const result = await window.batchStudio.caption.importGrok(project.rootPath, raw);
    setStatus(await window.batchStudio.caption.status(project.rootPath));
    return result;
  };

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
        title="1. タイトル・説明文を生成"
        run={run}
        onImport={importCaption}
        onAutoImported={async () =>
          setStatus(await window.batchStudio.caption.status(project.rootPath))
        }
      />

      <section className="panel">
        <div className="panelhead">
          <div>
            <h3>2. caption.txt</h3>
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
