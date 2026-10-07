import { type ReactNode, type SyntheticEvent, useEffect, useRef, useState } from 'react';
import { blocksProjectEdit, executionState } from '../domain/execution-policy.js';
import type {
  AssistantPaneProvider,
  ExecutionRun,
  ProjectBriefInput,
  ProjectSummary,
} from '../shared/types';
import {
  type ImportNotice,
  ImportNoticeContext,
  type ImportNoticeInput,
  ImportToastStack,
} from './ArtifactImportToast';
import { CaptionStage } from './CaptionStage';
import { CivitExplorerStage } from './CivitExplorerStage';
import { EnvironmentSettings } from './EnvironmentSettings';
import {
  AvailabilityStage,
  ExecutionStage,
  PreflightStage,
  WorkflowStage,
} from './ExecutionStages';
import { FinalArtifactStage } from './FinalArtifactStage';
import { ModelsStage, StoryStage } from './GrokStages';
import { HomeConnectedServices } from './HomeConnectedServices';
import { VastAiIntegrationPanel } from './integrations/VastAiIntegrationPanel';
import { MarketplaceImageStage } from './MarketplaceImageStage';
import { Overview, Settings } from './ProjectStages';
import { PromptPlanStage } from './PromptPlanStage';
import { R2ManagerStage } from './R2ManagerStage';
import { ServiceIntegrationsStage } from './ServiceIntegrationsStage';
import { StageErrorBoundary } from './StageErrorBoundary';
import { type ResetScope, StageResetMenu } from './StageResetMenu';
import { ThumbnailStage } from './ThumbnailStage';
import { grokContextStage, type Runner, type Stage, shouldShowGrok, stages, statusDot } from './ui';
import './divider.css';
import { flushEditorSaves } from './editor-save-registry';

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

async function getAssistantProvider(stage: NonNullable<ReturnType<typeof grokContextStage>>) {
  return window.batchStudio.assistant.getProvider(stage);
}

async function setAssistantProvider(
  provider: AssistantPaneProvider,
  stage: NonNullable<ReturnType<typeof grokContextStage>>,
) {
  return window.batchStudio.assistant.setProvider(provider, stage);
}
function protectsProjectInputs(run: ExecutionRun | null): boolean {
  return !!run && blocksProjectEdit(executionState(run));
}

// Prevent edits without disabling scrolling or text selection. The main process
// independently rejects writes, including those from stale windows.
function ReadOnlyStage({ readOnly, children }: { readOnly: boolean; children: ReactNode }) {
  const block = (event: SyntheticEvent) => {
    if (!readOnly) return;
    event.preventDefault();
    event.stopPropagation();
  };
  return (
    <div
      className={readOnly ? 'stage-readonly-content' : undefined}
      onClickCapture={block}
      onDoubleClickCapture={block}
      onChangeCapture={block}
      onInputCapture={block}
      onSubmitCapture={block}
      onDragStartCapture={block}
      onDropCapture={block}
      onPointerDownCapture={(event) => {
        const target = event.target;
        if (
          target instanceof Element &&
          target.closest('canvas, [draggable="true"], [contenteditable="true"]')
        )
          block(event);
      }}
      onKeyDownCapture={(event) => {
        const target = event.target;
        if (
          target instanceof Element &&
          target.closest('input, textarea, select, button, [contenteditable], [role="button"]')
        )
          block(event);
      }}
    >
      {children}
    </div>
  );
}

function App() {
  const [project, setProject] = useState<ProjectSummary | null>(null),
    [recent, setRecent] = useState<ProjectSummary[]>([]),
    [stage, setStage] = useState<Stage>('概要'),
    [error, setError] = useState(''),
    [assistantPaneVisible, setAssistantPaneVisible] = useState(false),
    [paneProvider, setPaneProvider] = useState<AssistantPaneProvider>('grok'),
    [paneProviderRoot, setPaneProviderRoot] = useState<string | null>(null),
    [providerRestoreFailure, setProviderRestoreFailure] = useState<{
      key: string;
      message: string;
    } | null>(null),
    [providerRestoreRevision, setProviderRestoreRevision] = useState(0),
    [switchingProvider, setSwitchingProvider] = useState(false),
    [ratio, setRatio] = useState(0.45),
    [createOpen, setCreateOpen] = useState(false),
    [environmentOpen, setEnvironmentOpen] = useState(false),
    [restoring, setRestoring] = useState(true),
    [tool, setTool] = useState<StandaloneTool>(null),
    [resetRevision, setResetRevision] = useState(0),
    [stageReloadRevision, setStageReloadRevision] = useState(0),
    [importNotices, setImportNotices] = useState<ImportNotice[]>([]),
    [executionViewState, setExecutionViewState] = useState<{
      root: string;
      protected: boolean;
    } | null>(null);
  const importSequence = useRef(0);
  const seenAutoImports = useRef(new Set<string>());
  const currentProjectRoot = useRef(project?.rootPath);
  currentProjectRoot.current = project?.rootPath;
  const navigationPending = useRef(false);
  const viewOnly = Boolean(
    project &&
      stage !== '実行' &&
      (executionViewState?.root !== project.rootPath || executionViewState.protected),
  );
  useEffect(
    () =>
      window.batchStudio.editorSaves.onFlushRequest((id, root) => {
        void flushEditorSaves(root).then(
          () => window.batchStudio.editorSaves.flushResult(id, true),
          (error) =>
            window.batchStudio.editorSaves.flushResult(
              id,
              false,
              error instanceof Error ? error.message : String(error),
            ),
        );
      }),
    [],
  );
  const navigateStage = async (next: Stage) => {
    if (!project || next === stage || navigationPending.current) return;
    navigationPending.current = true;
    setError('');
    try {
      await flushEditorSaves(project.rootPath);
      // Moving between stages must not stop the worker; closing or switching
      // the project still uses the existing main-process exit confirmation.
      if (next !== '実行') {
        if (!(await window.batchStudio.execution.leave(project.rootPath))) return;
        const current = await window.batchStudio.execution.status(project.rootPath);
        setExecutionViewState({
          root: project.rootPath,
          protected: protectsProjectInputs(current),
        });
      }
      setTool(null);
      setStage(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      navigationPending.current = false;
    }
  };
  useEffect(() => {
    if (!project) return;
    const root = project.rootPath;
    let cancelled = false;
    let inFlight = false;
    const inspect = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const current = await window.batchStudio.execution.status(root);
        if (!cancelled) setExecutionViewState({ root, protected: protectsProjectInputs(current) });
      } catch {
        // A failed status query must not briefly enable editing.
        if (!cancelled) setExecutionViewState({ root, protected: true });
      } finally {
        inFlight = false;
      }
    };
    void inspect();
    const timer = window.setInterval(() => void inspect(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [project?.rootPath]);
  const refresh = async () =>
    project && setProject(await window.batchStudio.project.scan(project.rootPath));
  const notifyImported = async (notice: ImportNoticeInput) => {
    const next = await window.batchStudio.project.scan(notice.root);
    if (currentProjectRoot.current !== notice.root) return;
    setProject((previous) => (previous?.rootPath === notice.root ? next : previous));
    setImportNotices((previous) => [
      ...previous.slice(-2),
      { ...notice, id: ++importSequence.current },
    ]);
  };
  useEffect(() => {
    setImportNotices([]);
    seenAutoImports.current.clear();
  }, [project?.rootPath]);
  useEffect(() => {
    if (!project) return;
    const root = project.rootPath;
    return window.batchStudio.autoArtifact.onEvent((event) => {
      if (event.root !== root || event.phase !== 'imported') return;
      const key = [event.provider, event.stage, event.sourceId, event.filePath].join(':');
      if (seenAutoImports.current.has(key)) return;
      seenAutoImports.current.add(key);
      void notifyImported({
        root,
        stage: event.stage,
        provider: event.provider,
        fileName: event.fileName,
        summary: event.summary,
      }).catch((cause) => {
        seenAutoImports.current.delete(key);
        setError(cause instanceof Error ? cause.message : String(cause));
      });
    });
  }, [project?.rootPath]);
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
      setAssistantPaneVisible(false);
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
          return;
        }
        if (command === 'settings') {
          setEnvironmentOpen(true);
          return;
        }
        if (command === 'close') void closeProject();
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
  const contextStage = grokContextStage(stage);
  const providerKey = project && contextStage ? project.rootPath + '\0' + contextStage : null;
  const activeProviderKey = useRef(providerKey);
  activeProviderKey.current = providerKey;
  useEffect(() => {
    let cancelled = false;
    const root = project?.rootPath ?? null;
    const context = grokContextStage(stage);
    const key = root && context ? root + '\0' + context : null;
    setPaneProviderRoot(null);
    setProviderRestoreFailure(null);
    if (root && context && key) {
      void getAssistantProvider(context)
        .then((provider) => {
          if (cancelled) return;
          setPaneProvider(provider);
          setPaneProviderRoot(key);
        })
        .catch((cause) => {
          if (cancelled) return;
          setProviderRestoreFailure({
            key,
            message: cause instanceof Error ? cause.message : String(cause),
          });
        });
    }
    return () => {
      cancelled = true;
    };
  }, [project?.rootPath, stage, providerRestoreRevision]);
  const retryProviderRestore = () => {
    if (!providerKey || providerRestoreFailure?.key !== providerKey) return;
    setProviderRestoreRevision((revision) => revision + 1);
  };
  const changeProvider = async (provider: AssistantPaneProvider) => {
    if (!project || !contextStage || paneProviderRoot !== providerKey || switchingProvider) return;
    const selectedKey = providerKey;
    setSwitchingProvider(true);
    setError('');
    try {
      await setAssistantProvider(provider, contextStage);
      if (activeProviderKey.current === selectedKey) setPaneProvider(provider);
    } catch (e) {
      if (activeProviderKey.current === selectedKey)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSwitchingProvider(false);
    }
  };
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (viewOnly || (project && contextStage && paneProviderRoot !== providerKey)) {
        const state = await window.batchStudio.assistant.setVisible(false);
        if (!cancelled) {
          setAssistantPaneVisible(state.visible);
          setRatio(state.ratio);
        }
        return;
      }
      const visible = Boolean(project && !tool && !viewOnly && shouldShowGrok(stage));
      const context = grokContextStage(stage);
      if (visible && context && project) {
        setAssistantPaneVisible(true);
        const [state] = await Promise.all([
          window.batchStudio.assistant.setVisible(true),
          window.batchStudio.assistant.setContext(project.rootPath, context),
        ]);
        if (!cancelled) {
          setAssistantPaneVisible(state.visible);
          setRatio(state.ratio);
        }
        return;
      }
      const state = await window.batchStudio.assistant.setVisible(false);
      if (!cancelled) {
        setAssistantPaneVisible(state.visible);
        setRatio(state.ratio);
      }
    })().catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      cancelled = true;
    };
  }, [stage, project?.rootPath, tool, paneProvider, paneProviderRoot, providerKey, viewOnly]);
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
          {project && !tool && !viewOnly && shouldShowGrok(stage) && (
            <select
              aria-label="AIアシスタント"
              value={paneProvider}
              disabled={paneProviderRoot !== providerKey || switchingProvider}
              onChange={(event) => void changeProvider(event.target.value as AssistantPaneProvider)}
            >
              <option value="grok">Grok</option>
              <option value="codex">Codex</option>
            </select>
          )}
          {project && !tool && !viewOnly && shouldShowGrok(stage) && (
            <button
              onClick={async () => {
                const state = await window.batchStudio.assistant.setVisible(!assistantPaneVisible);
                setAssistantPaneVisible(state.visible);
                setRatio(state.ratio);
              }}
            >
              {assistantPaneVisible ? 'AI Paneを隠す' : 'AI Paneを表示'}
            </button>
          )}
        </div>
      </header>
      {error && <div className="errorbar">{error}</div>}
      <ImportToastStack
        notices={importNotices}
        onDismiss={(id) =>
          setImportNotices((previous) => previous.filter((item) => item.id !== id))
        }
      />
      <div className="body">
        {project ? (
          <nav>
            {stages.map((s) => (
              <button
                key={s}
                className={!tool && stage === s ? 'active' : ''}
                onClick={() => void navigateStage(s)}
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
                {resetScope && !viewOnly && (
                  <StageResetMenu scope={resetScope} onReset={resetFrom} />
                )}
              </div>
              {viewOnly && (
                <div className="stage-readonly-notice" role="status">
                  実行中のRunを保護するため、この工程は閲覧専用です。編集はRunの停止後に行ってください。
                </div>
              )}
              {contextStage && !viewOnly && paneProviderRoot !== providerKey ? (
                providerRestoreFailure?.key === providerKey ? (
                  <section className="panel" role="alert">
                    <h3>AIエージェントの復元に失敗しました</h3>
                    <p>工程のAIエージェントを取得できませんでした。再試行してください。</p>
                    <div className="issue error">{providerRestoreFailure.message}</div>
                    <button type="button" onClick={retryProviderRestore}>
                      復元を再試行
                    </button>
                  </section>
                ) : (
                  <div className="panel" role="status">
                    この工程のAIエージェントを復元中…
                  </div>
                )
              ) : (
                <>
                  <StageErrorBoundary
                    key={`${project.rootPath}:${stage}:${resetRevision}:${stageReloadRevision}`}
                    stage={stage}
                    onRetry={() => {
                      setError('');
                      setStageReloadRevision((revision) => revision + 1);
                    }}
                  >
                    <ImportNoticeContext.Provider value={notifyImported}>
                      <ReadOnlyStage readOnly={viewOnly}>
                        <StageView
                          project={project}
                          stage={stage}
                          provider={paneProvider}
                          refresh={refresh}
                          setProject={setProject}
                          run={run}
                          resetFrom={resetFrom}
                        />
                      </ReadOnlyStage>
                    </ImportNoticeContext.Provider>
                  </StageErrorBoundary>
                </>
              )}
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
      {assistantPaneVisible && (
        <PaneDivider ratio={ratio} onRatio={setRatio} provider={paneProvider} />
      )}{' '}
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
function PaneDivider({
  ratio,
  onRatio,
  provider,
}: {
  ratio: number;
  onRatio: (ratio: number) => void;
  provider: AssistantPaneProvider;
}) {
  const raf = useRef<number | null>(null),
    pending = useRef<number | null>(null);
  const flush = () => {
    raf.current = null;
    const x = pending.current;
    if (x == null) return;
    pending.current = null;
    void window.batchStudio.assistant
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
      aria-label={`Local ${Math.round(ratio * 100)}% / ${provider} ${100 - Math.round(ratio * 100)}%`}
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
            Project root
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
            プロジェクトID (フォルダ名)
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
  provider: AssistantPaneProvider;
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
    case '最終成果物':
      return <FinalArtifactStage {...props} />;
    case 'キャプション':
      return <CaptionStage {...props} />;
    case 'サムネイル':
      return <ThumbnailStage {...props} />;
    case '販売サイト用画像':
      return <MarketplaceImageStage {...props} />;
  }
}

export default App;
