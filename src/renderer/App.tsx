import { useMemo, useState } from 'react';
import type { ArtifactSummary, ProjectSummary } from '../shared/types';

const stages = [
  '概要',
  '基本設定',
  'ストーリー',
  'モデル選定',
  'プロンプト設計',
  'ワークフロー',
  'モデル配置',
  '実行前チェック',
];

function statusLabel(artifact: ArtifactSummary): string {
  if (artifact.state === 'legacy') return '旧形式';
  if (artifact.state === 'present') return '検出済み';
  return '未作成';
}

function App() {
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [activeStage, setActiveStage] = useState('概要');
  const [grokVisible, setGrokVisible] = useState(true);
  const [ratio, setRatio] = useState(0.45);
  const [error, setError] = useState<string | null>(null);

  const detectedCount = useMemo(
    () => project?.artifacts.filter((artifact) => artifact.state === 'present').length ?? 0,
    [project],
  );

  async function selectProject() {
    setError(null);
    try {
      const selected = await window.batchStudio.project.select();
      if (selected) setProject(selected);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function toggleGrok() {
    const state = await window.batchStudio.grok.setVisible(!grokVisible);
    setGrokVisible(state.visible);
  }

  async function changeRatio(next: number) {
    setRatio(next);
    const state = await window.batchStudio.grok.setRatio(next);
    setRatio(state.ratio);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">ComfyUI Batch Studio</div>
          <h1>{project?.title ?? 'プロジェクトを選択してください'}</h1>
          {project && <div className="project-path">{project.rootPath}</div>}
        </div>
        <div className="toolbar">
          <button onClick={selectProject}>プロジェクトを開く</button>
          <button disabled={!project} onClick={() => project && window.batchStudio.project.openFolder(project.rootPath)}>
            フォルダーを開く
          </button>
        </div>
      </header>

      <div className="content-grid">
        <nav className="sidebar" aria-label="工程">
          <div className="nav-title">工程</div>
          {stages.map((stage) => (
            <button
              key={stage}
              className={activeStage === stage ? 'nav-item active' : 'nav-item'}
              onClick={() => setActiveStage(stage)}
            >
              {stage}
            </button>
          ))}
        </nav>

        <section className="workspace">
          <div className="workspace-heading">
            <div>
              <div className="eyebrow">現在の工程</div>
              <h2>{activeStage}</h2>
            </div>
            <div className="grok-controls">
              <button onClick={toggleGrok}>{grokVisible ? 'Grokを隠す' : 'Grokを表示'}</button>
              <button onClick={() => window.batchStudio.grok.reload()}>Grokを再読み込み</button>
              <button onClick={() => window.batchStudio.grok.openExternal()}>ブラウザで開く</button>
            </div>
          </div>

          <label className="ratio-control">
            <span>ローカル作業領域</span>
            <input
              type="range"
              min="0.3"
              max="0.7"
              step="0.05"
              value={ratio}
              onChange={(event) => void changeRatio(Number(event.target.value))}
              disabled={!grokVisible}
            />
            <span>{Math.round(ratio * 100)}%</span>
          </label>

          {error && <div className="error-banner">{error}</div>}

          {!project ? (
            <section className="empty-state">
              <div className="empty-icon">BS</div>
              <h3>既存プロジェクトを読み取り専用で確認できます</h3>
              <p>Phase 1ではプロジェクト内のファイルを変更しません。フォルダーを選択すると既存Artifactを走査します。</p>
              <button className="primary" onClick={selectProject}>プロジェクトを選択</button>
            </section>
          ) : (
            <>
              <section className="next-action">
                <div>
                  <div className="eyebrow">次にすること</div>
                  <h3>プロジェクトの現在状態を確認してください</h3>
                  <p>{detectedCount}件の標準Artifactを検出しました。Phase 1では内容を変更せず状態だけ確認します。</p>
                </div>
              </section>

              <section className="panel">
                <div className="panel-header">
                  <div>
                    <div className="eyebrow">Project scan</div>
                    <h3>Artifact</h3>
                  </div>
                  <button onClick={async () => setProject(await window.batchStudio.project.scan(project.rootPath))}>再読み込み</button>
                </div>

                <div className="artifact-list">
                  {project.artifacts.map((artifact) => (
                    <div className="artifact-row" key={artifact.key}>
                      <div>
                        <strong>{artifact.label}</strong>
                        <div className="muted">{artifact.relativePath ?? '対象ファイルなし'}</div>
                      </div>
                      <span className={`badge ${artifact.state}`}>{statusLabel(artifact)}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="panel compact">
                <div className="eyebrow">識別情報</div>
                <dl className="facts">
                  <div><dt>プロジェクト名</dt><dd>{project.title}</dd></div>
                  <div><dt>プロジェクトID</dt><dd>{project.id ?? '未設定'}</dd></div>
                </dl>
              </section>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

export default App;
