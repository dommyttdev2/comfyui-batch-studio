# Implementation Phases

Status: Draft roadmap

この文書は実装順序を管理する。要件の正本ではない。要件変更時は `requirements/requirements.md` を先に更新し、この文書は依存関係に合わせて調整する。

## Phase 0: Documentation / Contract Freeze

Goal: 実装前に境界と schema の未決事項を減らす。

- `models.json` final schema。
- `prompt_plan.json` formal JSON Schema。
- Workflow Template / Manifest schema。
- Branch naming / save path / image count policy。
- Artifact status state model。

`prompt_tree.md` の正本関係は解決済みであり、標準 Artifact から外す。人間向け Prompt 表示・編集は Prompt Plan Web UI が担当する。

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
- `project_brief.json`。
- `project_meta.json`。
- Draft / history。
- Story Grok Work Card。
- `story.md` import / editor / validation / confirm。
- Artifact status model。

Exit criteria:

- 新規 Project 作成から `story.md` 確定まで完結する。
- final overwrite 前に history が残る。

## Phase 3: Model Catalog / Grok Model Selection

Goal: `civit-model-viewer` catalog を使った Grok 選定と検証を実装する。

- catalog path configuration。
- `model_catalog.json` reader/index。
- generation / generatedAt display。
- Grok Model Selection prompt preparation。
- `models.json` import。
- Model / Version / File identity validation。
- `missingRequirements` handling。
- catalog generation mismatch 時の selected identity revalidation。

Exit criteria:

- Grok が catalog から選んだ file を Batch Studio が再照合できる。
- catalog generation が変化しても、それだけで `models.json` を invalid にしない。
- 架空 identity を確定できない。

## Phase 4: Prompt Plan

Goal: Grok の意味的 Prompt JSON を正規 Artifact として取り込み、同じデータを人間向け Web UI で確認・編集できるようにする。

- Prompt Plan Grok Work Card。
- `prompt_plan.json` parser / schema validation。
- common prompt display / editor。
- Root LoRA refs / applied strength editor。
- Branch / Branch LoRA / leaf tree view。
- Branch / leaf ordering editor。
- leaf prompt editor。
- model reference validation。
- validation result の該当箇所表示。
- Draft / confirm。
- `prompt_tree.md` を新規生成しない。

Exit criteria:

- 有効 Prompt Plan が Workflow Compiler へ入力できる。
- 人間向けの Prompt 構造確認・編集が `prompt_plan.json` を正本として Web UI 内で完結する。
- ComfyUI 内部 JSON を Grok output に要求しない。
- `prompt_tree.md` を Workflow Compiler の入力にしない。

Legacy `prompt_tree.md` から `prompt_plan.json` への migration は、既存プロジェクトで必要性が確認された場合に別要件として追加できる。Phase 4 の必須条件にはしない。

## Phase 5: Workflow Template / Manifest

Goal: 1本の Branch Prototype を正式な Compiler input にする。

- Common area の role 定義。
- Branch Prototype 1本。
- Manifest role / boundary / layout 定義。
- Template validation。
- Template versioning。

Exit criteria:

- Manifest だけで可変 node と prototype boundary を解決できる。
- Compiler code に project-specific Node ID を散在させない。

## Phase 6: Workflow Compiler

Goal: Prompt Plan branch 数と一致する最終 Workflow を決定論的に生成する。

- Common checkpoint patch。
- Root LoRA Stack patch。
- plan-owned common prompt patch。
- Prototype -> Branch 1 reuse。
- Branch 2..N clone。
- Node / Link / Group ID remap。
- layout offset。
- Branch LoRA Stack patch。
- leaf -> SceneMatrix conversion。
- title / save path policy。
- `last_node_id` / `last_link_id` update。
- compiled workflow validation。

Exit criteria:

```text
finalBranchCount == promptPlan.branches.length
unusedBranchCount == 0
nodeIdCollision == 0
linkIdCollision == 0
danglingLink == 0
```

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
