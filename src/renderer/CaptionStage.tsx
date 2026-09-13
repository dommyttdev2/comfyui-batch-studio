import { useEffect, useState } from 'react';
import type { CaptionStatus, ImportResult, ProjectSummary } from '../shared/types';
import { GrokBridge } from './GrokStages';
import type { Runner } from './ui';
import { issuesView } from './ui';

const CAPTION_STATE_LABELS: Record<CaptionStatus['state'], string> = {
  unconfigured: '最終成果物ディレクトリ未設定',
  'source-missing': '最終成果物ディレクトリが見つかりません',
  'missing-content': 'Grok本文未生成',
  'invalid-content': 'Grok本文に検証エラーがあります',
  ready: 'caption.txt を生成できます',
  generated: '生成済み',
  stale: '更新必要',
};

export function CaptionStage({
  project,
  setProject,
  run,
}: {
  project: ProjectSummary;
  setProject: (project: ProjectSummary) => void;
  run: Runner;
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
        title="1. Grokでタイトル・説明文を生成"
        run={run}
        onImport={importCaption}
      />

      <section className="panel">
        <div className="panelhead">
          <div>
            <h3>2. 最終成果物を指定</h3>
            <p>
              手作業で選定・モザイク処理を終えたディレクトリを指定します。配下の画像ファイルを実測して収録枚数に使用します。
            </p>
          </div>
          <div className="actions">
            <button
              onClick={() =>
                run(async () => {
                  setStatus(
                    await window.batchStudio.caption.selectSourceDirectory(project.rootPath),
                  );
                  setProject(await window.batchStudio.project.scan(project.rootPath));
                })
              }
            >
              ディレクトリを選択
            </button>
            <button onClick={() => void load()}>再スキャン</button>
          </div>
        </div>

        <div className="facts">
          <div>
            状態 <b>{status ? CAPTION_STATE_LABELS[status.state] : '読み込み中'}</b>
          </div>
          <div>
            画像枚数 <b>{status?.imageCount ?? 0} 枚</b>
          </div>
          <div>
            対象拡張子 <code>{status?.imageExtensions.join(' / ') ?? '-'}</code>
          </div>
        </div>

        <label className="wide">
          最終成果物ディレクトリ
          <input value={status?.sourceDirectory ?? ''} readOnly placeholder="未設定" />
        </label>

        {status?.sourceDirectory && !status.sourceExists && (
          <div className="issue error">✕ 指定されたディレクトリが見つかりません。</div>
        )}
        {status?.sourceExists && status.imageCount === 0 && (
          <div className="issue warning">⚠ 対象画像がありません。</div>
        )}
        {status?.stale && (
          <div className="issue warning">
            ⚠ 最終成果物の画像枚数またはキャプション本文が生成時から変更されています。caption.txt
            を再生成してください。
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panelhead">
          <div>
            <h3>3. caption.txt</h3>
            <p>
              Grokは意味情報だけを作成し、収録枚数と定型注意書きはComfyUI Batch
              Studioが組み立てます。
            </p>
          </div>
          <div className="actions">
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
            placeholder="Grok本文・最終成果物ディレクトリ・画像が揃うとプレビューを表示します。"
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
