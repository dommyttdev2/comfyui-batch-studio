import { useEffect, useState } from 'react';
import type { FinalArtifactStatus, ProjectSummary } from '../shared/types';
import type { Runner } from './ui';

const FINAL_ARTIFACT_STATE_LABELS: Record<FinalArtifactStatus['state'], string> = {
  unconfigured: '最終成果物ディレクトリ未設定',
  'source-missing': '最終成果物ディレクトリが見つかりません',
  empty: '対象画像がありません',
  ready: '後工程で使用できます',
};

export function FinalArtifactStage({
  project,
  setProject,
  run,
}: {
  project: ProjectSummary;
  setProject: (project: ProjectSummary) => void;
  run: Runner;
}) {
  const [status, setStatus] = useState<FinalArtifactStatus | null>(null);

  const load = () =>
    run(async () => {
      setStatus(await window.batchStudio.finalArtifact.status(project.rootPath));
    });

  useEffect(() => {
    void load();
  }, [project.rootPath]);

  return (
    <section className="panel">
      <div className="panelhead">
        <div>
          <h3>最終成果物ディレクトリ</h3>
          <p>
            手作業で選定・モザイク処理を終えたディレクトリを指定します。キャプションやサムネイルなどの後工程は、原則ここで指定したディレクトリを入力元として参照します。
          </p>
        </div>
        <div className="actions">
          <button
            className="primary"
            onClick={() =>
              run(async () => {
                setStatus(await window.batchStudio.finalArtifact.selectDirectory(project.rootPath));
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
          状態 <b>{status ? FINAL_ARTIFACT_STATE_LABELS[status.state] : '読み込み中'}</b>
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
        <input value={status?.directory ?? ''} readOnly placeholder="未設定" />
      </label>

      {status?.directory && !status.exists && (
        <div className="issue error">✕ 指定されたディレクトリが見つかりません。</div>
      )}
      {status?.exists && status.imageCount === 0 && (
        <div className="issue warning">⚠ 対象画像がありません。</div>
      )}
    </section>
  );
}
