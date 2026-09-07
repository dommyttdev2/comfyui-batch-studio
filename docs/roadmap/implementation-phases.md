# Implementation Phases

Status: Draft roadmap

この文書は実装順序を管理する。要件の正本ではない。要件変更時は `requirements/requirements.md` を先に更新し、この文書は依存関係に合わせて調整する。

## Phase 0: Documentation / Contract Freeze

Goal: 実装前に境界と schema の未決事項を減らす。

- Artifact status state model。

`models.json` Schema v1 は解決済みであり、機械可読正本は `schemas/models.schema.json` とする。

`prompt_plan.json` Schema v1 も解決済みであり、機械可読正本は `schemas/prompt-plan.schema.json` とする。

Workflow Template Manifest Schema v1 も解決済みであり、機械可読正本は `schemas/workflow-template-manifest.schema.json` とする。

Workflow naming / save path / image count policy v1 も解決済みであり、`architecture/workflow-compiler.md` を正本とする。

`prompt_tree.md` の正本関係も解決済みであり、標準 Artifact から外す。人間向け Prompt 表示・編集は Prompt Plan Web UI が担当する。

Exit criteria:

- Open decision のうち実装を block する項目が Accepted。
- Template prototype の実ファイルが確定。

## Phase 1: Electron Read-only Shell

Goal: 既存 Project を壊さずに閲覧し、Grok Web と並べて利用できる。

- Electron main / renderer / preload。
- Local UI + Grok `WebContentsView`。
- Grok persistent session isolation。
- Project root scan。
- 既存 Artifact status 表示。
- Legacy `prompt_tree.md` が存在する場合は Legacy として識別。
- `Open Folder` / `Copy Prompt`。
- Grok DOM 自動操作なし。

Exit criteria:

- 既存 Project を変更せず一覧化できる。
- Grok に手動ログインし、Local UI と同時利用できる。

## Phase 2: Project / Story Lifecycle

Goal: 新規 Project と Story の Draft -> Confirm lifecycle を実装する。

- Project initialization UI。
- `project.id` stable ID generation / validation。
- `generation.target_image_count` target semantics。
- `project_brief.json`。
- `project_meta.json`。
- Draft / history。
- Story Grok Work Card。
- `story.md` import / editor / validation / confirm。
- Artifact status model。

Exit criteria:

- 新規 Project 作成から `story.md` 確定まで完結する。
- `project.id` が filesystem-safe stable ID rule を満たす。
- display name変更だけで既存 `project.id` を自動変更しない。
- final overwrite 前に history が残る。

## Phase 3: Model Catalog / Grok Model Selection

Goal: `civit-model-viewer` catalog を使った Grok 選定と検証を実装する。

- catalog path configuration。
- `model_catalog.json` reader/index。
- generation / generatedAt display。
- Grok Model Selection prompt preparation。
- Models Draft / import。
- `schemas/models.schema.json` を使った Schema v1 validation。
- Checkpoint `checkpoint.main` / LoRA `lora.*` ref validation。
- Project-wide model `ref` uniqueness の semantic validation。
- Model / Version / File identity validation。
- Civitai 由来 `strengthBaseline` / provenance 表示。
- `missingRequirements` を Draft / UI state として表示。
- unresolved `missingRequirements` がある場合の Confirm blocking。
- catalog generation mismatch 時の selected identity revalidation。
- Confirm 後に確定版 `models.json` 保存。

Exit criteria:

- Grok が catalog から選んだ file を Batch Studio が再照合できる。
- Schema v1 に準拠し semantic validation を通過した `models.json` だけを確定できる。
- `ref` 重複や架空 Model / Version / File identity を確定できない。
- 未解決 `missingRequirements` がある状態で `models.json` を Confirm できない。
- catalog generation が変化しても、それだけで `models.json` を invalid にしない。

## Phase 4: Prompt Plan

Goal: Grok の意味的 Prompt JSON を正規 Artifact として取り込み、同じデータを人間向け Web UI で確認・編集できるようにする。

- Prompt Plan Grok Work Card。
- `schemas/prompt-plan.schema.json` を使った Schema v1 validation。
- Project-wide Branch ID / Leaf ID uniqueness の semantic validation。
- `models.json` に対する `modelRef` semantic validation。
- common prompt display / editor。
- Root LoRA refs / applied strength editor。
- Branch / Branch LoRA / leaf tree view。
- Branch / leaf ordering editor。
- leaf prompt editor。
- target image count とactual leaf総数の差分表示。
- validation result の該当箇所表示。
- Draft / confirm。
- `prompt_tree.md` を新規生成しない。

Exit criteria:

- Schema v1 に準拠し semantic validation を通過した Prompt Plan が Workflow Compiler へ入力できる。
- 未知 field、必須 field 欠落、不正 stable ID を確定できない。
- Branch ID / Leaf ID の Project-wide 重複を確定できない。
- 解決不能 `modelRef` を持つ Prompt Plan を確定 Workflow 入力にできない。
- target image countとの差分だけでは確定をBlockしない。
- 人間向けの Prompt 構造確認・編集が `prompt_plan.json` を正本として Web UI 内で完結する。
- ComfyUI 内部 JSON を Grok output に要求しない。
- `prompt_tree.md` を Workflow Compiler の入力にしない。

Legacy `prompt_tree.md` から `prompt_plan.json` への migration は、既存プロジェクトで必要性が確認された場合に別要件として追加できる。Phase 4 の必須条件にはしない。

## Phase 5: Workflow Template / Manifest

Goal: 1本の Branch Prototype を正式な Compiler input にする。

- Common Area + Branch Prototype 1本の Template 実体を確定。
- Template stable ID / release version を決定。
- Template UTF-8 file bytes の SHA-256 を計算。
- `schemas/workflow-template-manifest.schema.json` に準拠する Manifest を作成。
- Common roles `checkpoint` / `rootLoraStack` / `planCommonPrompt` / `promptOutput` を割当。
- Branch roles と `nodeIds` / `groupIds` ownership を割当。
- Common -> Branch boundaries を role + slot で宣言。
- Branch layout offset を設定。
- Template SHA-256 binding validation。
- Manifest role / ownership / boundary semantic validation。
- Prototype内部LinkをNode ownershipから自動導出するvalidation。
- 未宣言cross-boundary Linkのblocking validation。
- Template-owned prompt transformが `1 leaf = 1 generation` cardinalityを維持することを確認。

Exit criteria:

- Manifestだけで可変NodeとPrototype ownership/boundaryを解決できる。
- Compiler code に project-specific Node ID / slot magic number を散在させない。
- ManifestにPrototype内部Link ID一覧を重複保持しない。
- Template hash不一致をCompile前に検出できる。
- Branch専用Reroute等がGroup外でも `nodeIds` で明示所有できる。
- Template-owned nodeがleaf数を暗黙増幅しない。

## Phase 6: Workflow Compiler

Goal: Prompt Plan branch 数と一致し、leaf総数と一致する予定画像数を持つ最終 Workflow を決定論的に生成する。

- Common checkpoint patch。
- Root LoRA Stack patch。
- plan-owned common prompt patch。
- Prototype -> Branch 1 reuse。
- Branch 2..N clone。
- Prototype内部Link derivation / clone。
- Common -> cloned Branch boundary link生成。
- Node / Link / Group ID remap。
- Manifest layout offset適用。
- Branch LoRA Stack patch。
- leaf -> SceneMatrix conversion。
- `leaf.id -> row_id / path_label`、`leaf.name -> name` mapping。
- 全Branch `ScenePromptCounter.count = 1` patch。
- Branch / Project image count derivation。
- Branch human-readable title derivation from `branch.id` / `branch.label`。
- Workflow filename `LoRA_{project.id}.json`。
- Save path `BatchStudio/{project.id}/{branch.id}`。
- SceneSaveImageのphysical filename suffix/indexはcustom nodeへ委譲。
- `last_node_id` / `last_link_id` update。
- compiled workflow validation。
- Compiler version / Manifest hash / Template identity+hash を Workflow build provenance として `project_meta.json` に記録。

Exit criteria:

```text
finalBranchCount == promptPlan.branches.length
unusedBranchCount == 0
nodeIdCollision == 0
linkIdCollision == 0
danglingLink == 0
undeclaredBoundaryLink == 0
templateHashMismatch == 0
allBranchCounterCount == 1
actualImageCount == totalPromptPlanLeafCount
savePathMismatch == 0
leafPathLabelMismatch == 0
```

`generation.target_image_count` とactualImageCountの差分はinformational / warningであり、それだけではCompile failureにしない。

## Phase 7: Model Availability / R2 Handoff

Goal: 必要モデルの実体配置を確認する。

- `models.json` file list。
- Local ComfyUI models lookup。
- R2 existence view。
- difference status。
- R2 File Manager launch / handoff。

初期実装では destructive R2 operation を Batch Studio へ複製しない。

## Phase 8: Preflight

Goal: Project を `READY` / `BLOCKED` に判定する。

- Artifact confirmed state。
- catalog refs。
- Prompt Plan refs。
- Workflow refs / structure。
- planned image count / target delta。
- model availability。
- external tool availability。
- Blocking / Warning summary。

Exit criteria:

- READY の理由と BLOCKED の理由をユーザーが追跡できる。

## Future: ComfyUI Runtime Integration

Phase 8 までとは別 scope とする。

候補:

- Queue API。
- progress tracking。
- cancel。
- output collection。
- generation history。

追加前に別 Requirement / Decision を作成する。

## Future: Direct R2 API Integration

R2 File Manager の認証境界を壊さない方式が決まった場合だけ追加する。

必要な事前設計:

- authentication ownership。
- token lifetime。
- concurrent processes。
- destructive confirmation。
- retry / resume。