import { useEffect, useMemo, useState } from 'react';
import type {
  LoraUsage,
  ModelsArtifact,
  NegativePromptGroups,
  PositivePromptGroups,
  ProjectSummary,
  PromptPlanArtifact,
  StructuredPrompt,
  ValidationIssue,
} from '../shared/types';
import { compilePromptPlanPrompts } from '../shared/prompt-policy';
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

const positiveGroupKeys: Array<Exclude<keyof PositivePromptGroups, 'camera'>> = [
  'subject',
  'identity',
  'appearance',
  'style',
  'outfit',
  'expression',
  'action',
  'pose',
  'environment',
  'lighting',
  'effects',
];
const cameraGroupKeys: Array<keyof NonNullable<PositivePromptGroups['camera']>> = [
  'pov',
  'angle',
  'framing',
  'gaze',
  'focus',
];
const negativeGroupKeys: Array<keyof NegativePromptGroups> = [
  'anatomy',
  'identity',
  'appearance',
  'subject',
  'outfit',
  'action',
  'camera',
  'environment',
  'artifacts',
  'content',
];

function TagArrayEditor({
  label,
  value,
  editable,
  onChange,
}: {
  label: string;
  value: string[] | undefined;
  editable: boolean;
  onChange: (value: string[]) => void;
}) {
  return (
    <label>
      {label}
      <textarea
        className="prompt-tag-list"
        readOnly={!editable}
        placeholder="1行につき1タグ"
        value={(value ?? []).join('\n')}
        onChange={(e) =>
          onChange(
            e.target.value
              .split(/\r?\n/)
              .map((tag) => tag.trim())
              .filter(Boolean),
          )
        }
      />
    </label>
  );
}

function StructuredPromptEditor({
  value,
  editable,
  onChange,
  triggerCandidates,
}: {
  value: StructuredPrompt;
  editable: boolean;
  onChange: (value: StructuredPrompt) => void;
  triggerCandidates?: Array<{ ref: string; label: string; words: string[] }>;
}) {
  const toggleTrigger = (modelRef: string, word: string, checked: boolean) => {
    const next = structuredClone(value);
    const selections = next.triggerWords ?? [];
    const existing = selections.find((selection) => selection.modelRef === modelRef);
    const words = existing?.words ?? [];
    const updated = checked
      ? [...new Set([...words, word])]
      : words.filter((item) => item !== word);
    next.triggerWords = [
      ...selections.filter((selection) => selection.modelRef !== modelRef),
      ...(updated.length ? [{ modelRef, words: updated }] : []),
    ];
    onChange(next);
  };
  const updatePositive = (key: Exclude<keyof PositivePromptGroups, 'camera'>, tags: string[]) => {
    const next = structuredClone(value);
    if (tags.length) next.positive[key] = tags;
    else delete next.positive[key];
    onChange(next);
  };
  const updateCamera = (key: keyof NonNullable<PositivePromptGroups['camera']>, tags: string[]) => {
    const next = structuredClone(value);
    const camera = { ...(next.positive.camera ?? {}) };
    if (tags.length) camera[key] = tags;
    else delete camera[key];
    if (Object.keys(camera).length) next.positive.camera = camera;
    else delete next.positive.camera;
    onChange(next);
  };
  const updateNegative = (key: keyof NegativePromptGroups, tags: string[]) => {
    const next = structuredClone(value);
    if (tags.length) next.negative[key] = tags;
    else delete next.negative[key];
    onChange(next);
  };
  return (
    <div className="structured-prompt-editor">
      {triggerCandidates && (
        <>
          <h4>トリガーワード（このscopeでのみ選択）</h4>
          {triggerCandidates.map((candidate) => (
            <fieldset key={candidate.ref} className="lora-detail-card">
              <legend>
                {candidate.label} — {candidate.ref}
              </legend>
              {candidate.words.length ? (
                candidate.words.map((word) => (
                  <label key={word} style={{ display: 'block' }}>
                    <input
                      type="checkbox"
                      disabled={!editable}
                      checked={Boolean(
                        value.triggerWords
                          ?.find((selection) => selection.modelRef === candidate.ref)
                          ?.words.includes(word),
                      )}
                      onChange={(event) => toggleTrigger(candidate.ref, word, event.target.checked)}
                    />{' '}
                    {word}
                  </label>
                ))
              ) : (
                <small>登録済みトリガーワードなし</small>
              )}
            </fieldset>
          ))}
          {!triggerCandidates.length && <p>適用可能なトリガーワード候補はありません。</p>}
        </>
      )}
      <h4>Positive</h4>
      <div className="prompt-group-grid">
        {positiveGroupKeys.map((key) => (
          <TagArrayEditor
            key={key}
            label={key}
            value={value.positive[key]}
            editable={editable}
            onChange={(tags) => updatePositive(key, tags)}
          />
        ))}
      </div>
      <h4>Camera</h4>
      <div className="prompt-group-grid">
        {cameraGroupKeys.map((key) => (
          <TagArrayEditor
            key={key}
            label={`camera.${key}`}
            value={value.positive.camera?.[key]}
            editable={editable}
            onChange={(tags) => updateCamera(key, tags)}
          />
        ))}
      </div>
      <h4>Negative</h4>
      <div className="prompt-group-grid">
        {negativeGroupKeys.map((key) => (
          <TagArrayEditor
            key={key}
            label={key}
            value={value.negative[key]}
            editable={editable}
            onChange={(tags) => updateNegative(key, tags)}
          />
        ))}
      </div>
    </div>
  );
}

function CompiledPreview({ positive, negative }: { positive: string; negative: string }) {
  return (
    <div className="compiled-prompt-preview">
      <h4>Compiled Prompt Preview</h4>
      <label>
        Positive
        <textarea readOnly value={positive} />
      </label>
      <label>
        Negative
        <textarea readOnly value={negative} />
      </label>
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
  const compiled = useMemo(
    () => (models ? compilePromptPlanPrompts(plan, models) : null),
    [models, plan],
  );
  const triggerCandidates = (branchIndex?: number) => {
    if (!models || plan.schemaVersion !== 2 || plan.triggerWordsMode !== 'selected')
      return undefined;
    const base = models.modelFamily === 'anima' ? models.diffusionModel : models.checkpoint;
    const refs = new Set([
      ...(base?.ref ? [base.ref] : []),
      ...plan.rootLoras.map((usage) => usage.modelRef),
      ...(branchIndex === undefined
        ? []
        : plan.branches[branchIndex].loras.map((usage) => usage.modelRef)),
    ]);
    return [...(base ? [base] : []), ...models.loras.filter((model) => refs.has(model.ref))]
      .filter((model) => refs.has(model.ref))
      .map((model) => ({
        ref: model.ref,
        label: model.modelName,
        words: [...new Set(model.trainedWords ?? [])],
      }));
  };
  function mutate(fn: (p: any) => void) {
    if (!editable) return;
    const n = structuredClone(plan);
    fn(n);
    setPlan(n as PromptPlanArtifact);
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
  if (selected.type === 'common') {
    if (plan.schemaVersion === 1)
      return (
        <div className="inspector modal-inspector">
          <h3>共通プロンプト</h3>
          <label>
            Positive
            <textarea
              readOnly={!editable}
              value={plan.common.positive}
              onChange={(e) =>
                mutate((p) => {
                  if (p.schemaVersion === 1) p.common.positive = e.target.value;
                })
              }
            />
          </label>
          <label>
            Negative
            <textarea
              readOnly={!editable}
              value={plan.common.negative}
              onChange={(e) =>
                mutate((p) => {
                  if (p.schemaVersion === 1) p.common.negative = e.target.value;
                })
              }
            />
          </label>
        </div>
      );
    return (
      <div className="inspector modal-inspector">
        <div className="panelhead">
          <div>
            <span className="eyebrow">SCHEMA V2</span>
            <h3>共通プロンプト</h3>
          </div>
        </div>
        {plan.triggerWordsMode !== 'selected' && (
          <div className="issue warning">
            この旧Prompt
            Planでは登録済みトリガーワードを自動付与します。選択方式へ切り替えると自動付与を停止します。
            {editable && (
              <button
                onClick={() =>
                  mutate((p) => {
                    if (p.schemaVersion === 2) p.triggerWordsMode = 'selected';
                  })
                }
              >
                トリガーワードを個別選択する
              </button>
            )}
          </div>
        )}
        <StructuredPromptEditor
          value={plan.common}
          triggerCandidates={triggerCandidates()}
          editable={editable}
          onChange={(value) =>
            mutate((p) => {
              if (p.schemaVersion === 2) p.common = value;
            })
          }
        />
        {compiled && (
          <CompiledPreview
            positive={compiled.common.positive}
            negative={compiled.common.negative}
          />
        )}
      </div>
    );
  }
  if (selected.type === 'root')
    return (
      <div className="inspector modal-inspector">
        <h3>全体共通LoRA</h3>
        {loraEditor(plan.rootLoras, 'root')}
      </div>
    );
  const branch: any = plan.branches[selected.branch];
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
        {plan.schemaVersion === 2 && (
          <>
            <h3>Branch共通Prompt</h3>
            <StructuredPromptEditor
              triggerCandidates={triggerCandidates(selected.branch)}
              value={
                branch.prompt ?? {
                  positive: {},
                  negative: {},
                }
              }
              editable={editable}
              onChange={(value) =>
                mutate((p) => {
                  if (p.schemaVersion === 2) p.branches[selected.branch].prompt = value;
                })
              }
            />
          </>
        )}
      </div>
    );
  if (selected.type === 'leaf') {
    const leaf: any = branch.leaves[selected.leaf];
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
        {plan.schemaVersion === 1 ? (
          <>
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
          </>
        ) : (
          <>
            <StructuredPromptEditor
              triggerCandidates={triggerCandidates(selected.branch)}
              value={leaf.prompt}
              editable={editable}
              onChange={(value) =>
                mutate((p) => (p.branches[selected.branch].leaves[selected.leaf].prompt = value))
              }
            />
            {compiled &&
              (() => {
                const compiledLeaf = compiled.branches
                  .find((item) => item.id === branch.id)
                  ?.leaves.find((item) => item.id === leaf.id);
                return compiledLeaf ? (
                  <CompiledPreview
                    positive={compiledLeaf.positive}
                    negative={compiledLeaf.negative}
                  />
                ) : null;
              })()}
          </>
        )}
      </div>
    );
  }
  const visible = branch.leaves
    .map((l: any, i: number) => ({ l, i }))
    .filter(
      ({ l }: { l: any }) =>
        !query.trim() ||
        `${l.id} ${l.name} ${plan.schemaVersion === 1 ? `${l.positive} ${l.negative}` : JSON.stringify(l.prompt)}`
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
        {visible.map(({ l, i }: { l: any; i: number }) => (
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
