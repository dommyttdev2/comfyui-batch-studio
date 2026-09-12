import { useEffect, useMemo, useState } from 'react';
import type {
  LoraUsage,
  ModelsArtifact,
  ProjectSummary,
  PromptPlanArtifact,
  ValidationIssue,
} from '../shared/types';
import type { Runner } from './ui';
import { issuesView } from './ui';
import { GrokBridge } from './GrokStages';
import './prompt-plan-modal.css';

type PlanSelection =
  | { type: 'common' }
  | { type: 'root' }
  | { type: 'branch'; branch: number }
  | { type: 'matrix'; branch: number }
  | { type: 'leaf'; branch: number; leaf: number };
export function PromptPlanStage({
  project,
  setProject,
  run,
}: {
  project: ProjectSummary;
  setProject: (p: ProjectSummary) => void;
  run: Runner;
}) {
  const [plan, setPlan] = useState<PromptPlanArtifact | null>(null),
    [models, setModels] = useState<ModelsArtifact | null>(null),
    [validation, setValidation] = useState<ValidationIssue[]>([]),
    [selected, setSelected] = useState<PlanSelection | null>(null),
    [editing, setEditing] = useState(false);
  async function load() {
    const draft = await window.batchStudio.artifact.read(project.rootPath, 'promptPlan', 'draft');
    let source = draft;
    if (!draft.exists)
      source = await window.batchStudio.artifact.read(project.rootPath, 'promptPlan', 'confirmed');
    setEditing(draft.exists);
    if (source.content) {
      try {
        setPlan(JSON.parse(source.content));
        setValidation(source.validation.issues);
      } catch {
        setPlan(null);
      }
    } else setPlan(null);
    const m = await window.batchStudio.artifact.read(project.rootPath, 'models', 'confirmed');
    if (m.content) {
      try {
        setModels(JSON.parse(m.content));
      } catch {
        setModels(null);
      }
    }
  }
  useEffect(() => {
    void run(load);
  }, [project.rootPath]);
  const save = () =>
    plan &&
    run(async () => {
      const r = await window.batchStudio.artifact.savePromptPlan(project.rootPath, plan);
      setValidation(r.validation.issues);
      setEditing(true);
    });
  const importPlan = async (raw: string) => {
    const r = await window.batchStudio.artifact.importGrok(project.rootPath, 'promptPlan', raw);
    await load();
    setEditing(true);
    return r;
  };
  return (
    <>
      <GrokBridge
        project={project}
        stage="prompt-plan"
        title="GrokでPrompt Planを作成"
        run={run}
        onImport={importPlan}
      />
      {project.artifacts.find((a) => a.key === 'promptPlan')?.state !== 'missing' && (
        <GrokBridge
          project={project}
          stage="prompt-plan-fix"
          title="Prompt Planの修正依頼"
          run={run}
          onImport={importPlan}
        />
      )}
      <section className="panel treepanel">
        <div className="panelhead">
          <div>
            <h3>Prompt Plan</h3>
            {plan && (
              <small>
                {plan.branches.length}ブランチ /{' '}
                {plan.branches.reduce((n, b) => n + b.leaves.length, 0)}枚
              </small>
            )}
          </div>
          <div className="actions">
            {plan && !editing && (
              <button
                onClick={() =>
                  run(async () => {
                    const d = await window.batchStudio.artifact.beginEdit(
                      project.rootPath,
                      'promptPlan',
                    );
                    if (d.content) {
                      setPlan(JSON.parse(d.content));
                      setValidation(d.validation.issues);
                      setEditing(true);
                    }
                  })
                }
              >
                編集を開始
              </button>
            )}
            {editing && (
              <>
                <button onClick={save}>下書き保存</button>
                <button
                  className="primary"
                  onClick={() =>
                    run(async () => {
                      const saved = await window.batchStudio.artifact.savePromptPlan(
                        project.rootPath,
                        plan!,
                      );
                      setValidation(saved.validation.issues);
                      if (!saved.validation.valid)
                        throw new Error('検証エラーがあるため確定できません。');
                      setProject(
                        await window.batchStudio.artifact.confirm(project.rootPath, 'promptPlan'),
                      );
                      await load();
                    })
                  }
                >
                  確定
                </button>
              </>
            )}
          </div>
        </div>
        {issuesView(validation)}
        {!plan ? (
          <p>Prompt Planはまだありません。Grokの結果を取り込んでください。</p>
        ) : (
          <div className="flow">
            <button className="node common" onClick={() => setSelected({ type: 'common' })}>
              <b>共通プロンプト</b>
              <small>Positive / Negative</small>
            </button>
            <span className="arrow">→</span>
            <button className="node root" onClick={() => setSelected({ type: 'root' })}>
              <b>全体共通LoRA</b>
              <small>{plan.rootLoras.length}件</small>
            </button>
            <span className="arrow">→</span>
            <div className="branches">
              {plan.branches.map((b, bi) => (
                <div className="branchrow" key={b.id}>
                  <button
                    className="node branch"
                    onClick={() => setSelected({ type: 'branch', branch: bi })}
                  >
                    <b>{b.label}</b>
                    <small>LoRA {b.loras.length}件</small>
                  </button>
                  <span className="arrow">→</span>
                  <button
                    className="node matrix"
                    onClick={() => setSelected({ type: 'matrix', branch: bi })}
                  >
                    <b>Matrix</b>
                    <small>
                      {b.leaves.length}件 / {b.leaves.length}枚
                    </small>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
      {plan && selected && (
        <PlanModal
          plan={plan}
          models={models}
          editable={editing}
          setPlan={setPlan}
          selected={selected}
          setSelected={setSelected}
        />
      )}
    </>
  );
}

function PlanModal(props: {
  plan: PromptPlanArtifact;
  models: ModelsArtifact | null;
  editable: boolean;
  setPlan: (p: PromptPlanArtifact) => void;
  selected: PlanSelection;
  setSelected: (s: PlanSelection | null) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.setSelected]);
  return (
    <div
      className="modal prompt-plan-modal"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.setSelected(null);
      }}
    >
      <div className="modalcard prompt-plan-modalcard">
        <div className="prompt-modal-head">
          <div>
            <span className="eyebrow">PROMPT PLAN DETAIL</span>
            <h2>Prompt Plan 詳細</h2>
          </div>
          <button
            className="prompt-modal-close"
            aria-label="閉じる"
            onClick={() => props.setSelected(null)}
          >
            ×
          </button>
        </div>
        <PlanInspector {...props} />
      </div>
    </div>
  );
}

function PlanInspector({
  plan,
  models,
  editable,
  setPlan,
  selected,
  setSelected,
}: {
  plan: PromptPlanArtifact;
  models: ModelsArtifact | null;
  editable: boolean;
  setPlan: (p: PromptPlanArtifact) => void;
  selected: PlanSelection;
  setSelected: (s: PlanSelection | null) => void;
}) {
  const [query, setQuery] = useState('');
  const modelByRef = useMemo(() => new Map((models?.loras ?? []).map((l) => [l.ref, l])), [models]);
  function mutate(fn: (p: PromptPlanArtifact) => void) {
    if (!editable) return;
    const n = structuredClone(plan);
    fn(n);
    setPlan(n);
  }
  const loraEditor = (items: LoraUsage[], path: 'root' | number) => (
    <div className="lora-list">
      {items.length === 0 ? (
        <p>LoRAはありません。</p>
      ) : (
        items.map((l, i) => {
          const detail = modelByRef.get(l.modelRef),
            base = detail?.strengthBaseline;
          const update = (field: 'strengthModel' | 'strengthClip', value: number) =>
            mutate((p) => {
              const target = path === 'root' ? p.rootLoras : p.branches[path].loras;
              target[i][field] = value;
            });
          return (
            <div className="lora-card lora-detail-card" key={`${l.modelRef}:${i}`}>
              <div className="panelhead">
                <div>
                  <code>{l.modelRef}</code>
                  {detail && <strong className="lora-model-name">{detail.modelName}</strong>}
                </div>
                {base ? (
                  <span>
                    Civitai基準値 {base.value}{' '}
                    {base.provenance.sampleCount ? `/ ${base.provenance.sampleCount}投稿` : ''}
                  </span>
                ) : (
                  <span>基準値なし</span>
                )}
              </div>
              {detail ? (
                <div className="lora-detail-grid">
                  <div>
                    <span>MODEL</span>
                    <strong>{detail.modelName}</strong>
                  </div>
                  <div>
                    <span>VERSION</span>
                    <strong>{detail.versionName}</strong>
                  </div>
                  <div className="wide">
                    <span>FILE</span>
                    <code>{detail.fileName}</code>
                  </div>
                  <div className="wide">
                    <span>TRAINED WORDS</span>
                    {detail.trainedWords.length ? (
                      <div className="trained-words">
                        {detail.trainedWords.map((w) => (
                          <code key={w}>{w}</code>
                        ))}
                      </div>
                    ) : (
                      <small>なし</small>
                    )}
                  </div>
                </div>
              ) : (
                <div className="issue warning">
                  ⚠ models.json から <code>{l.modelRef}</code> の詳細を解決できません。
                </div>
              )}
              <div className="strength-grid">
                <label>
                  Model強度
                  <input
                    type="number"
                    step="0.05"
                    disabled={!editable}
                    value={l.strengthModel}
                    onChange={(e) => update('strengthModel', +e.target.value)}
                  />
                </label>
                <label>
                  CLIP強度
                  <input
                    type="number"
                    step="0.05"
                    disabled={!editable}
                    value={l.strengthClip}
                    onChange={(e) => update('strengthClip', +e.target.value)}
                  />
                </label>
              </div>
              <div className="actions">
                {base && editable && (
                  <button
                    onClick={() =>
                      mutate((p) => {
                        const target = path === 'root' ? p.rootLoras : p.branches[path].loras;
                        target[i].strengthModel = base.value;
                        target[i].strengthClip = base.value;
                      })
                    }
                  >
                    基準値に戻す
                  </button>
                )}
                {detail?.modelUrl && (
                  <button onClick={() => window.batchStudio.catalog.openModel(detail.modelUrl)}>
                    Civitaiで開く ↗
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
  if (selected.type === 'common')
    return (
      <div className="inspector modal-inspector">
        <h3>共通プロンプト</h3>
        <label>
          Positive
          <textarea
            readOnly={!editable}
            value={plan.common.positive}
            onChange={(e) => mutate((p) => (p.common.positive = e.target.value))}
          />
        </label>
        <label>
          Negative
          <textarea
            readOnly={!editable}
            value={plan.common.negative}
            onChange={(e) => mutate((p) => (p.common.negative = e.target.value))}
          />
        </label>
      </div>
    );
  if (selected.type === 'root')
    return (
      <div className="inspector modal-inspector">
        <h3>全体共通LoRA</h3>
        {loraEditor(plan.rootLoras, 'root')}
      </div>
    );
  const branch = plan.branches[selected.branch];
  if (selected.type === 'branch')
    return (
      <div className="inspector modal-inspector">
        <div className="panelhead">
          <div>
            <h3>ブランチ — {branch.label}</h3>
            <code>{branch.id}</code>
          </div>
          {editable && (
            <div className="actions">
              <button
                disabled={selected.branch === 0}
                onClick={() =>
                  mutate((p) => {
                    [p.branches[selected.branch - 1], p.branches[selected.branch]] = [
                      p.branches[selected.branch],
                      p.branches[selected.branch - 1],
                    ];
                    setSelected({ type: 'branch', branch: selected.branch - 1 });
                  })
                }
              >
                ↑
              </button>
              <button
                disabled={selected.branch === plan.branches.length - 1}
                onClick={() =>
                  mutate((p) => {
                    [p.branches[selected.branch + 1], p.branches[selected.branch]] = [
                      p.branches[selected.branch],
                      p.branches[selected.branch + 1],
                    ];
                    setSelected({ type: 'branch', branch: selected.branch + 1 });
                  })
                }
              >
                ↓
              </button>
            </div>
          )}
        </div>
        <label>
          表示名
          <input
            readOnly={!editable}
            value={branch.label}
            onChange={(e) => mutate((p) => (p.branches[selected.branch].label = e.target.value))}
          />
        </label>
        <h3>使用LoRA</h3>
        {loraEditor(branch.loras, selected.branch)}
      </div>
    );
  if (selected.type === 'leaf') {
    const leaf = branch.leaves[selected.leaf];
    return (
      <div className="inspector modal-inspector">
        <div className="panelhead">
          <div>
            <span className="eyebrow">GENERATED ITEM</span>
            <h3>{leaf.name}</h3>
          </div>
          <div className="actions">
            <button onClick={() => setSelected({ type: 'matrix', branch: selected.branch })}>
              ← Matrix
            </button>
            {editable && (
              <>
                <button
                  disabled={selected.leaf === 0}
                  onClick={() =>
                    mutate((p) => {
                      const a = p.branches[selected.branch].leaves;
                      [a[selected.leaf - 1], a[selected.leaf]] = [
                        a[selected.leaf],
                        a[selected.leaf - 1],
                      ];
                      setSelected({
                        type: 'leaf',
                        branch: selected.branch,
                        leaf: selected.leaf - 1,
                      });
                    })
                  }
                >
                  ↑
                </button>
                <button
                  disabled={selected.leaf === branch.leaves.length - 1}
                  onClick={() =>
                    mutate((p) => {
                      const a = p.branches[selected.branch].leaves;
                      [a[selected.leaf + 1], a[selected.leaf]] = [
                        a[selected.leaf],
                        a[selected.leaf + 1],
                      ];
                      setSelected({
                        type: 'leaf',
                        branch: selected.branch,
                        leaf: selected.leaf + 1,
                      });
                    })
                  }
                >
                  ↓
                </button>
              </>
            )}
          </div>
        </div>
        <label>
          ID
          <input value={leaf.id} readOnly />
        </label>
        <label>
          名前
          <input
            readOnly={!editable}
            value={leaf.name}
            onChange={(e) =>
              mutate(
                (p) => (p.branches[selected.branch].leaves[selected.leaf].name = e.target.value),
              )
            }
          />
        </label>
        <label>
          Positive
          <textarea
            readOnly={!editable}
            value={leaf.positive}
            onChange={(e) =>
              mutate(
                (p) =>
                  (p.branches[selected.branch].leaves[selected.leaf].positive = e.target.value),
              )
            }
          />
        </label>
        <label>
          Negative
          <textarea
            readOnly={!editable}
            value={leaf.negative}
            onChange={(e) =>
              mutate(
                (p) =>
                  (p.branches[selected.branch].leaves[selected.leaf].negative = e.target.value),
              )
            }
          />
        </label>
      </div>
    );
  }
  const visible = branch.leaves
    .map((l, i) => ({ l, i }))
    .filter(
      ({ l }) =>
        !query.trim() ||
        `${l.id} ${l.name} ${l.positive} ${l.negative}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    );
  return (
    <div className="inspector modal-inspector">
      <div className="panelhead">
        <div>
          <span className="eyebrow">MATRIX</span>
          <h3>{branch.label}</h3>
        </div>
        <span>
          {branch.leaves.length}件 / {branch.leaves.length}枚
        </span>
      </div>
      <input
        placeholder="ID・名前・プロンプトを検索"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="leaflist modal-leaflist">
        {visible.map(({ l, i }) => (
          <button
            key={l.id}
            onClick={() => setSelected({ type: 'leaf', branch: selected.branch, leaf: i })}
          >
            <code>{l.id}</code>
            <span>{l.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
