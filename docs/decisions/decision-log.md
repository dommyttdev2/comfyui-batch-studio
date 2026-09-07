# Decision Log

Status: Active

この文書は、会話や実装で合意した設計判断を後から追跡できるように残す。単なる現行仕様の再掲ではなく「なぜその方式なのか」「何を置き換えたか」を記録する。

Status:

- `Accepted`: 合意済み。
- `Open`: 未決。
- `Superseded`: 後の判断に置き換え済み。

---

## DEC-001: Electron + user-operated Grok Web

Date: 2026-09-07
Status: Accepted

### Decision

Batch Studio は Electron desktop application とし、Local UI と Grok Web を同一 window 内の別 view として表示する。

Grok はユーザーが直接操作する。Batch Studio は DOM 操作、ログイン自動化、自動送信、自動添付、回答 scraping を行わない。

### Rationale

- Grok Web を通常 iframe として扱う設計を避ける。
- 認証情報と Local app capability の境界を分ける。
- xAI API を必須依存にしない。
- Grok の会話を人間の review loop に残す。

---

## DEC-002: User decides, Grok reasons, Batch Studio executes deterministic work

Date: 2026-09-07
Status: Accepted

### Decision

最上位の責務分担を次とする。

```text
Grok         = semantic/creative decision
Batch Studio = state, validation, deterministic transformation, persistence
User         = review and final approval
```

### Consequence

同じ入力から機械的に決められる処理を Grok へ依頼しない。

---

## DEC-003: Grok owns model selection

Date: 2026-09-07
Status: Accepted

### Decision

使用する Checkpoint / LoRA / Version / File の選定主体を Grok とする。

Batch Studio のモデル画面は主に選定結果の検証・確認画面とし、ユーザーが catalog を一件ずつ手動選択することを正本のフローにしない。

### Source of truth

Grok の選定根拠は `civit-model-viewer` が出力する `model_catalog.json`。

### Batch Studio responsibility

- catalog identity validation。
- stale catalog warning。
- missing requirements の表示。
- user confirmation / save。

### Replaces

旧方針「Batch Studio でモデルを選び、Grok はレビュアーだけを担当」を置き換える。

---

## DEC-004: Grok does not generate ComfyUI Workflow JSON

Date: 2026-09-07
Status: Accepted

### Decision

ComfyUI Workflow JSON の生成・編集を Grok に担当させない。

### Rationale

既存 Workflow の構造は一定しており、Node / Link / Widget の編集は意味的推論ではなく機械処理にできる。

AI に巨大 JSON を再生成させるより、Template と Compiler で構造を保証する方が検証性・再現性・保守性が高い。

### Replaces

旧方針「Grok に Workflow template を添付し、最終 Workflow JSON を返させる」を置き換える。

---

## DEC-005: Grok outputs semantic Prompt Plan JSON

Date: 2026-09-07
Status: Accepted

### Decision

Workflow 工程で Grok から受け取るのは次の意味情報とする。

- 共通 prompt。
- 全枝共通 LoRA。
- Branch 一覧。
- Branch ごとの LoRA。
- Branch ごとの SceneMatrix leaf prompts。

ComfyUI 内部情報は返させない。

### Artifact

標準名 `prompt_plan.json` は現時点では Draft naming。意味構造は Accepted。

---

## DEC-006: Root LoRA and Branch LoRA are separate concepts

Date: 2026-09-07
Status: Accepted

### Decision

- Root LoRA = 全 Branch 共通。
- Branch LoRA = 当該 Branch のみ。

Character LoRA がある場合は Root に置ける。Character LoRA がない場合は Root Stack を空にし、共通 Prompt で identity を定義できる。

Branch LoRA が0件でも leaf を持つ有効 Branch は許可する。

---

## DEC-007: Workflow template contains one Branch Prototype

Date: 2026-09-07
Status: Accepted

### Decision

基本 Workflow Template は Common Area + Branch Prototype 1本だけを持つ。

`prompt_plan.branches` の件数に応じて Compiler が Prototype を複製する。

### Rationale

- Template の修正箇所を1本に限定できる。
- 予約枝数に依存しない。
- 最終 Workflow を必要な構造だけにできる。

### Replaces

旧方針「複数の固定枝を Template に持ち、未使用枝を empty/bypass のまま残す」を置き換える。

---

## DEC-008: No unused branches in final Workflow

Date: 2026-09-07
Status: Accepted

### Decision

最終 Workflow の branch 数は Prompt Plan の branch 数と一致させる。

```text
finalBranchCount == promptPlan.branches.length
```

UNUSED branch、空 Matrix の予約 branch、余剰 bypass branch を残さない。

---

## DEC-009: Workflow clone uses Manifest, not hard-coded Node IDs

Date: 2026-09-07
Status: Accepted in principle / schema Draft

### Decision

Compiler code へ特定 Node ID を散在させず、Template Manifest に Common role、Branch Prototype、boundary、layout 等を宣言する。

Manifest の正式 JSON Schema は実装前に確定する。

---

## DEC-010: R2 physical operations remain owned by R2 File Manager initially

Date: 2026-09-07
Status: Accepted

### Decision

Batch Studio はモデル所在を照合するが、初期段階の upload/download/delete/move は既存 R2 File Manager へ委譲する。

直接 API 統合は authentication / token ownership / concurrency を別途設計してから追加する。

---

## DEC-011: Current required scope ends at Preflight

Date: 2026-09-07
Status: Accepted

### Decision

v1 の必須範囲は READY FOR COMFYUI まで。

ComfyUI queue submission / progress / result retrieval は将来拡張とする。

---

## DEC-012: models.json uses a Batch Studio-specific schema

Date: 2026-09-07
Status: Accepted

### Decision

プロジェクト正本の `models.json` は、既存の Civitai Selection API 等の既存 `models.json` 形式との互換性を要件としない。

ComfyUI Batch Studio の後続処理に必要な情報を自然に表現できる専用 schema を新規定義する。

### Rationale

- Grok のモデル選定結果を stable reference で後続 `prompt_plan.json` から参照したい。
- catalog provenance、Model / Version / File identity、trained words、選定理由、不足要件等を正本として扱いたい。
- 既存形式に合わせるための冗長な変換や制約を新しい内部契約へ持ち込まない。

### Consequence

既存プロジェクトや外部形式からの互換が必要になった場合は、専用 schema 自体を崩さず Importer / Migration として別途扱う。

### Resolves

`OPEN-002` のうち「既存形式との互換範囲」を解決する。

---

## OPEN-001: prompt_tree.md source-of-truth relationship

Date: 2026-09-07
Status: Open

### Question

`prompt_plan.json` と情報が重なる `prompt_tree.md` をどう扱うか。

Options:

1. Grok が両方を作り、両方正本。
2. `prompt_plan.json` を機械可読正本とし、Batch Studio が `prompt_tree.md` を派生生成。
3. 別の関係を定義。

二重管理による drift を避ける観点では Option 2 が有力だが、未合意のため確定しない。

---

## OPEN-002: models.json dedicated schema details

Date: 2026-09-07
Status: Open

### Decided

- `models.json` は Batch Studio 専用 schema とする。
- 既存形式との互換性は要件としない。

### Remaining Questions

- stable model reference の正式 field name と命名規則。
- catalog metadata をどこまで snapshot するか。
- `missingRequirements` を同一ファイルに持つか selection draft と分離するか。
- role、trained words、reason、LoRA strength 等をどこまで `models.json` が所有するか。

---

## OPEN-003: prompt_plan.json formal JSON Schema

Date: 2026-09-07
Status: Open

意味構造は Accepted だが、正式 field name、ID uniqueness scope、将来 metadata の扱いを実装前に固定する。

---

## OPEN-004: Workflow Template Manifest schema

Date: 2026-09-07
Status: Open

確定対象:

- role naming。
- prototype node/link/group ownership。
- common/branch boundary ports。
- layout policy。
- template version/hash。

---

## OPEN-005: Generated naming and count policy

Date: 2026-09-07
Status: Open

Compiler が派生する以下の正式ルールを決める。

- Branch / Node title。
- Save path。
- per-leaf image count。
- branch total image count。
- output filename metadata。

Grok の自由文へ依存させない方針自体は維持する。
