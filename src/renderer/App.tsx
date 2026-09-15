import { useEffect, useRef, useState } from 'react';
import type { ProjectBriefInput, ProjectSummary } from '../shared/types';
import { grokContextStage, stages, shouldShowGrok, statusDot, type Runner, type Stage } from './ui';
import { Overview, Settings } from './ProjectStages';
import { StoryStage, ModelsStage } from './GrokStages';
import { PromptPlanStage } from './PromptPlanStage';
import { CaptionStage } from './CaptionStage';
import { ThumbnailStage } from './ThumbnailStage';
import {
  WorkflowStage,
  AvailabilityStage,
  PreflightStage,
  ExecutionStage,
} from './ExecutionStages';
import { R2ManagerStage } from './R2ManagerStage';
import { CivitExplorerStage } from './CivitExplorerStage';
import { EnvironmentSettings } from './EnvironmentSettings';
import { ServiceIntegrationsStage } from './ServiceIntegrationsStage';
import { VastAiIntegrationPanel } from './integrations/VastAiIntegrationPanel';
import { HomeConnectedServices } from './HomeConnectedServices';
import { StageResetMenu, type ResetScope } from './StageResetMenu';
import './divider.css';

const blankBrief: ProjectBriefInput = {
  project: { id: '', title: '' },
  subject: { copyrightedCharacter: false, characterName: '', series: '' },
  audience: '',
  request: '',
  exclusions: '',
  assumptions: { adultCharacters: false, consensual: false },
  generation: { target_image_count: 500, modelFamily: 'illustrious' },
  references: [],
};
function hashId(value: string) {
  let h = 2166136261;
  for (const ch of value) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
function suggestProjectId(title: string) {
  const normalized = title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/[-_.]{2,}/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, 64);
  if (normalized) return normalized;
  return title.trim() ? `project-${hashId(title).slice(0, 8)}` : '';
}
type StandaloneTool = 'services' | 'r2' | 'civit' | 'vastai' | null;
function stageResetScope(stage: Stage): ResetScope | null {
  if (stage === 'ストーリー') return 'story';
  if (stage === 'プロンプト設計') return 'prompt-plan';
  if (stage === 'ワークフロー') return 'workflow';
  return null;
}

function App() {
  const [project, setProject] = useState<ProjectSummary | null>(null),
    [recent, setRecent] = useState<ProjectSummary[]>([]),
    [stage, setStage] = useState<Stage>('概要'),
    [error, setError] = useState(''),
    [grok, setGrok] = useState(false),
    [ratio, setRatio] = useState(0.45),
    [createOpen, setCreateOpen] = useState(false),
    [environmentOpen, setEnvironmentOpen] = useState(false),
    [restoring, setRestoring] = useState(true),
    [tool, setTool] = useState<StandaloneTool>(null),
    [resetRevision, setResetRevision] = useState(0);
  const refresh = async () =>
    project && setProject(await window.batchStudio.project.scan(project.rootPath));
  const run: Runner = async (fn) => {
    setError('');
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    }
  };
  const resetFrom = async (scope: ResetScope) => {
    if (!project) return;
    setError('');
    try {
      const next = await window.batchStudio.artifact.resetFrom(project.rootPath, scope);
      setProject(next);
      setResetRevision((x) => x + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  };
  const rememberRecent = (p: ProjectSummary) =>
    setRecent((prev) => [p, ...prev.filter((item) => item.rootPath !== p.rootPath)].slice(0, 8));
  const loadRecent = async () => setRecent(await window.batchStudio.project.recent());
  const openProject = () =>
    run(async () => {
      const p = await window.batchStudio.project.select();
      if (p) {
        setProject(p);
        rememberRecent(p);
        setTool(null);
      }
    });
  const openRecent = (root: string) =>
    run(async () => {
      const p = await window.batchStudio.project.open(root);
      if (!p) return;
      setProject(p);
      rememberRecent(p);
      setTool(null);
    });
  const removeRecent = (root: string) =>
    run(async () => {
      await window.batchStudio.project.removeRecent(root);
      setRecent((prev) => prev.filter((item) => item.rootPath !== root));
    });
  const closeProject = () =>
    run(async () => {
      await window.batchStudio.project.close();
      setProject(null);
      setTool(null);
      setStage('概要');
      setGrok(false);
      await loadRecent();
    });
  useEffect(() => {
    let cancelled = false;
    void window.batchStudio.project
      .recent()
      .then((items) => {
        if (!cancelled) setRecent(items);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(
    () =>
      window.batchStudio.project.onMenuCommand((command, openedProject) => {
        if (command === 'new') {
          setCreateOpen(true);
          return;
        }
        if (command === 'open' && openedProject) {
          setProject(openedProject);
          rememberRecent(openedProject);
          setTool(null);
          setStage('概要');
        }
      }),
    [],
  );
  useEffect(() => {
    let cancelled = false;
    void window.batchStudio.project
      .last()
      .then((p) => {
        if (!cancelled && p) setProject(p);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const visible = Boolean(project && !tool && shouldShowGrok(stage)),
        context = grokContextStage(stage);
      if (visible && context && project)
        await window.batchStudio.grok.setContext(project.rootPath, context);
      const s = await window.batchStudio.grok.setVisible(visible);
      if (!cancelled) {
        setGrok(s.visible);
        setRatio(s.ratio);
      }
    })().catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      cancelled = true;
    };
  }, [stage, project?.rootPath, tool]);
  const title =
      project?.title ??
      (tool === 'services'
        ? 'サービス連携'
        : tool === 'r2'
          ? 'R2 File Manager'
          : tool === 'civit'
            ? 'Civit Explorer'
            : tool === 'vastai'
              ? 'Vast.ai'
              : restoring
                ? '前回のプロジェクトを復元中…'
                : 'ホーム'),
    resetScope = stageResetScope(stage);
  const activeService =
    tool === 'r2' ? 'r2' : tool === 'civit' ? 'civitai' : tool === 'vastai' ? 'vastai' : null;
  return (
    <main className="shell">
      <header className="top">
        <div>
          <span className="eyebrow">ComfyUI Batch Studio</span>
          <h1>{title}</h1>
          <small>{project?.rootPath}</small>
        </div>
        <div className="actions">
          <button onClick={() => void openProject()}>開く</button>
          <button onClick={() => setCreateOpen(true)}>新規作成</button>
          <button onClick={() => setEnvironmentOpen(true)}>環境設定</button>
          {project && (
            <>
              <button onClick={() => window.batchStudio.project.openFolder(project.rootPath)}>
                フォルダー
              </button>
              <button onClick={() => void closeProject()}>プロジェクトを閉じる</button>
            </>
          )}
          {project && !tool && shouldShowGrok(stage) && (
            <button
              onClick={async () => {
                const s = await window.batchStudio.grok.setVisible(!grok);
                setGrok(s.visible);
                setRatio(s.ratio);
              }}
            >
              {grok ? 'Grokを隠す' : 'Grokを表示'}
            </button>
          )}
        </div>
      </header>
      {error && <div className="errorbar">{error}</div>}
      <div className="body">
        {project ? (
          <nav>
            {stages.map((s) => (
              <button
                key={s}
                className={!tool && stage === s ? 'active' : ''}
                onClick={() => {
                  setTool(null);
                  setStage(s);
                }}
              >
                {s}
                {statusDot(project, s)}
              </button>
            ))}
          </nav>
        ) : (
          <nav className="home-nav">
            <button className={tool === null ? 'active' : ''} onClick={() => setTool(null)}>
              ホーム
            </button>
            <button
              className={tool === 'services' ? 'active' : ''}
              onClick={() => setTool('services')}
            >
              サービス連携
            </button>
            <HomeConnectedServices
              activeService={activeService}
              onOpenR2={() => setTool('r2')}
              onOpenCivitai={() => setTool('civit')}
              onOpenVastAi={() => setTool('vastai')}
            />
          </nav>
        )}
        <section className="workspace">
          {project && !tool && (
            <>
              <div className="stagehead">
                <h2>{stage}</h2>
                {resetScope && <StageResetMenu scope={resetScope} onReset={resetFrom} />}
              </div>
              <StageView
                key={`${stage}:${resetRevision}`}
                project={project}
                stage={stage}
                refresh={refresh}
                setProject={setProject}
                run={run}
                resetFrom={resetFrom}
              />
            </>
          )}
          {!project && tool === 'services' && (
            <ServiceIntegrationsStage
              run={run}
              onOpenR2={() => setTool('r2')}
              onOpenCivit={() => setTool('civit')}
            />
          )}{' '}
          {!project && tool === 'r2' && <R2ManagerStage run={run} />}{' '}
          {!project && tool === 'civit' && <CivitExplorerStage run={run} />}{' '}
          {!project && tool === 'vastai' && (
            <VastAiIntegrationPanel
              run={run}
              onBack={() => setTool('services')}
              onStatus={() => {}}
            />
          )}{' '}
          {!project && !tool && (
            <Empty
              onCreate={() => setCreateOpen(true)}
              onOpen={openProject}
              onOpenRecent={openRecent}
              onRemoveRecent={removeRecent}
              recent={recent}
              restoring={restoring}
            />
          )}
        </section>
      </div>
      {grok && <PaneDivider ratio={ratio} onRatio={setRatio} />}{' '}
      {createOpen && (
        <CreateProject
          onClose={() => setCreateOpen(false)}
          onCreated={(p) => {
            setProject(p);
            rememberRecent(p);
            setTool(null);
            setCreateOpen(false);
          }}
          run={run}
        />
      )}{' '}
      {environmentOpen && (
        <EnvironmentSettings onClose={() => setEnvironmentOpen(false)} run={run} />
      )}
    </main>
  );
}
function PaneDivider({ ratio, onRatio }: { ratio: number; onRatio: (ratio: number) => void }) {
  const raf = useRef<number | null>(null),
    pending = useRef<number | null>(null);
  const flush = () => {
    raf.current = null;
    const x = pending.current;
    if (x == null) return;
    pending.current = null;
    void window.batchStudio.grok
      .setDividerScreenX(x)
      .then((s) => onRatio(s.ratio))
      .catch(() => {});
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!(e.buttons & 1)) return;
    pending.current = e.screenX;
    if (raf.current == null) raf.current = requestAnimationFrame(flush);
  };
  return (
    <div
      className="pane-divider"
      role="separator"
      aria-orientation="vertical"
      aria-label={`Local ${Math.round(ratio * 100)}% / Grok ${100 - Math.round(ratio * 100)}%`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        pending.current = e.screenX;
        flush();
      }}
      onPointerMove={move}
      onPointerUp={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
      }}
    />
  );
}
function Empty({
  onCreate,
  onOpen,
  onOpenRecent,
  onRemoveRecent,
  recent,
  restoring,
}: {
  onCreate: () => void;
  onOpen: () => void;
  onOpenRecent: (root: string) => void;
  onRemoveRecent: (root: string) => void;
  recent: ProjectSummary[];
  restoring: boolean;
}) {
  return (
    <div className="home">
      <div className="empty home-start">
        <div className="logo">BS</div>
        <h3>
          {restoring ? '前回のプロジェクトを確認しています' : '開始する操作を選択してください'}
        </h3>
        {!restoring && (
          <div className="actions home-actions">
            <button className="primary" onClick={onCreate}>
              プロジェクトを新規作成
            </button>
            <button onClick={onOpen}>プロジェクトを開く</button>
          </div>
        )}
      </div>
      {!restoring && recent.length > 0 && (
        <section className="recent-projects" aria-labelledby="recent-projects-title">
          <div className="panelhead">
            <div>
              <h3 id="recent-projects-title">最近使ったプロジェクト</h3>
              <p>
                クリックするとそのままプロジェクトを開きます。表示から削除しても実ファイルは削除されません。
              </p>
            </div>
          </div>
          <div className="recent-project-grid">
            {recent.map((p) => (
              <div key={p.rootPath} className="recent-project-card">
                <button className="recent-project-open" onClick={() => onOpenRecent(p.rootPath)}>
                  <strong>{p.title}</strong>
                  <small>{p.rootPath}</small>
                  <span>
                    {p.targetImageCount != null
                      ? `目標 ${p.targetImageCount} 枚`
                      : '目標枚数未設定'}
                  </span>
                </button>
                <button
                  className="recent-project-remove"
                  onClick={() => onRemoveRecent(p.rootPath)}
                  aria-label={`${p.title}を最近使ったプロジェクトの表示から削除`}
                >
                  表示から削除
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
function CreateProject({
  onClose,
  onCreated,
  run,
}: {
  onClose: () => void;
  onCreated: (p: ProjectSummary) => void;
  run: Runner;
}) {
  const [b, setB] = useState(blankBrief),
    [parent, setParent] = useState(''),
    [idTouched, setIdTouched] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void window.batchStudio.appSettings
      .get()
      .then((settings) => {
        const projectRoot =
          (settings as typeof settings & { projectRoot?: string }).projectRoot?.trim() ?? '';
        if (!cancelled && projectRoot) setParent(projectRoot);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const set = (key: string, v: unknown) =>
    setB((prev) => {
      const n = structuredClone(prev) as Record<string, any>;
      const [a, c] = key.split('.');
      if (c) n[a][c] = v;
      else n[a] = v;
      return n as unknown as ProjectBriefInput;
    });
  const setTitle = (title: string) =>
    setB((prev) => ({
      ...prev,
      project: {
        ...prev.project,
        title,
        id: idTouched ? prev.project.id : suggestProjectId(title),
      },
    }));
  const confirmed = b.assumptions.adultCharacters && b.assumptions.consensual;
  return (
    <div className="modal">
      <div className="modalcard">
        <h2>新規プロジェクト</h2>
        <div className="formgrid">
          <label>
            作成先
            <input value={parent} readOnly />
            <button
              onClick={async () => {
                const p = await window.batchStudio.project.selectParent(parent);
                if (p) setParent(p);
              }}
            >
              選択
            </button>
          </label>
          <label>
            プロジェクト名 *
            <input value={b.project.title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            プロジェクトID
            <input
              value={b.project.id}
              onChange={(e) => {
                setIdTouched(true);
                set('project.id', e.target.value);
              }}
            />
            <button
              onClick={() => {
                setIdTouched(false);
                set('project.id', suggestProjectId(b.project.title));
              }}
            >
              自動生成
            </button>
          </label>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input
              style={{ width: 'auto' }}
              type="checkbox"
              checked={b.subject.copyrightedCharacter}
              onChange={(e) => set('subject.copyrightedCharacter', e.target.checked)}
            />
            版権キャラクター
          </label>
          <label>
            キャラクター{b.subject.copyrightedCharacter ? ' *' : ''}
            <input
              value={b.subject.characterName}
              onChange={(e) => set('subject.characterName', e.target.value)}
            />
          </label>
          <label>
            作品
            <input
              value={b.subject.series}
              onChange={(e) => set('subject.series', e.target.value)}
            />
          </label>
          <label>
            目標画像枚数
            <input
              type="number"
              min={1}
              value={b.generation.target_image_count}
              onChange={(e) => set('generation.target_image_count', +e.target.value)}
            />
          </label>
          <label className="wide">
            ターゲット読者の特徴 *
            <textarea value={b.audience} onChange={(e) => set('audience', e.target.value)} />
          </label>
          <label className="wide">
            要望
            <textarea value={b.request} onChange={(e) => set('request', e.target.value)} />
          </label>
          <label className="wide">
            除外
            <textarea value={b.exclusions} onChange={(e) => set('exclusions', e.target.value)} />
          </label>
          <label className="wide" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input
              style={{ width: 'auto' }}
              type="checkbox"
              checked={confirmed}
              onChange={(e) =>
                setB((prev) => ({
                  ...prev,
                  assumptions: { adultCharacters: e.target.checked, consensual: e.target.checked },
                }))
              }
            />
            登場人物は成人で、成人向け内容は合意を前提とする *
          </label>
        </div>
        <div className="actions">
          <button onClick={onClose}>キャンセル</button>
          <button
            className="primary"
            disabled={!parent}
            onClick={() =>
              run(async () => onCreated(await window.batchStudio.project.create(parent, b)))
            }
          >
            作成
          </button>
        </div>
      </div>
    </div>
  );
}
function StageView(props: {
  project: ProjectSummary;
  stage: Stage;
  refresh: () => Promise<unknown>;
  setProject: (p: ProjectSummary) => void;
  run: Runner;
  resetFrom: (scope: ResetScope) => Promise<void>;
}) {
  switch (props.stage) {
    case '概要':
      return <Overview {...props} />;
    case '基本設定':
      return <Settings {...props} />;
    case 'ストーリー':
      return <StoryStage {...props} />;
    case 'モデル選定':
      return <ModelsStage {...props} />;
    case 'プロンプト設計':
      return <PromptPlanStage {...props} />;
    case 'ワークフロー':
      return <WorkflowStage {...props} />;
    case 'モデル配置':
      return <AvailabilityStage {...props} />;
    case '実行前チェック':
      return <PreflightStage {...props} />;
    case '実行':
      return <ExecutionStage {...props} />;
    case 'キャプション':
      return <CaptionStage {...props} />;
    case 'サムネイル':
      return <ThumbnailStage {...props} />;
  }
}

export default App;
