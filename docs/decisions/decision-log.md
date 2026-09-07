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
- catalog generation 差分時の再検証。
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

標準ファイル名は `prompt_plan.json` とする。確定版の lifecycle は `DEC-015` で定義する。意味構造は本 Decision の Accepted 内容として維持する。

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

## DEC-013: LoRA strength has model baseline and plan application layers

Date: 2026-09-07
Status: Accepted

### Decision

LoRA strength は用途の異なる2層で保持する。

```text
models.json
  = Civitai を source とする model/version 側の推奨・基準強度

prompt_plan.json
  = 当該 Project の Root / Branch で実際に Workflow へ適用する強度
```

`models.json` の基準強度は Civitai 由来の根拠を取得できる場合のみ保存し、根拠がない場合は値を捏造しない。

`prompt_plan.json` の実適用強度は Batch Studio の Web UI から調整可能とする。実適用強度を変更しても `models.json` の Civitai 由来基準値は変更しない。

### Rationale

- `models.json` の source of truth は Civitai であり、モデルに紐づく基準情報を保持する場所として自然である。
- 同じ LoRA でも Scene / Branch によって実際の適用強度を変える必要がある。
- Web UI から調整する値と、外部ソース由来の基準値を混同すると provenance が失われる。

### Civitai API finding

2026-09-07 時点では Model / Model Version API に汎用的な「推奨 LoRA 強度」フィールドは確認できない。

Images API の `withMeta=true` では、投稿画像で使用された `meta.civitaiResources[].weight` を取得できる場合がある。これは observed usage であり、作者の明示的推奨値とは限らない。

### Consequence

投稿画像 weight から基準値を導出する場合は、source / basis / aggregation method 等の provenance を保持する。

Batch Studio 自身は Civitai API を直接呼ばず、必要な Civitai 情報は `civit-model-viewer` -> `model_catalog.json` の境界を維持する。

---

## DEC-014: Catalog generation mismatch triggers revalidation, not invalidation

Date: 2026-09-07
Status: Accepted

### Decision

`models.json` はモデル選定時に使用した `model_catalog.json` の provenance として、v1 では少なくとも次を保持する。

```text
catalog.schemaVersion
catalog.generation
catalog.generatedAt
```

現在の `model_catalog.json` の `generation` が `models.json` に記録された値と異なる場合、Batch Studio は選定済み Model / Version / File identity を現在の catalog に対して再検証する。

generation の不一致だけでは `models.json` を invalid / stale と判定しない。

### Rationale

`generation` は catalog 全体の更新世代であり、プロジェクトと無関係なモデル追加・更新でも変化し得る。そのため世代番号の違い自体をプロジェクトの異常とみなすと不要な警告や再選定を発生させる。

意味は次の通りとする。

```text
generation mismatch
  != project stale

generation mismatch
  = catalog changed since selection
  = selected identities must be revalidated
```

### Revalidation result

- 選定済み Model / Version / File がすべて存在する: `VALID`。
- identity は存在するが後続処理に関係する metadata が変化した: `VALID` を維持し必要に応じて warning。
- 選定済み Model / Version / File が消失した: blocking error。再選定またはユーザー対応が必要。

### Hash policy

v1 では catalog 全体の content hash を必須としない。完全な内容同一性や監査用 snapshot が必要になった場合に schema version 更新で追加する。

### Resolves

`REQ-MODEL-005` を Decided とする。

`OPEN-002` のうち catalog provenance の最低保持範囲を解決する。

---

## DEC-015: prompt_plan.json is the single confirmed Prompt Plan artifact

Date: 2026-09-07
Status: Accepted

### Decision

構造化 Prompt Plan の標準ファイル名を `prompt_plan.json` とする。

プロジェクト直下には現在の確定版を1ファイルだけ置く。Workflow Compiler はこの確定済み `prompt_plan.json` を Prompt Plan の機械可読入力として使用する。

確定までの lifecycle は次とする。

```text
Grok response
   -> Draft
   -> Batch Studio validation
   -> User approval
   -> prompt_plan.json
   -> Workflow Compiler
```

### Draft / History policy

- Grok の貼り戻し直後の内容は Draft であり、検証・承認前に `prompt_plan.json` を上書きしない。
- 確定前の候補は `._batch_studio/drafts/` で管理する。
- 確定版を更新する場合、更新前の版は `._batch_studio/history/` へ退避する。
- `prompt_plan_v2.json`、`prompt_plan_final.json` 等のように version/status をファイル名へ埋め込んで正規運用しない。

### Rationale

- Compiler が読む正規入力の場所と名前を一意にできる。
- `final` / `final2` のようなファイル増殖を避けられる。
- Draft と確定版を分離し、ユーザー承認前の内容で Workflow を生成する事故を防げる。
- schema version は JSON 本体、履歴は History 領域が担当し、ファイル名に責務を持たせすぎない。

### Scope boundary

本 Decision の時点では `prompt_tree.md` の位置づけを決めなかった。その後 `DEC-016` で解決した。

### Resolves

`REQ-PLAN-003` を Decided とする。

---

## DEC-016: Prompt Plan Web UI replaces prompt_tree.md as the human-readable view

Date: 2026-09-07
Status: Accepted

### Decision

`prompt_plan.json` を Prompt 設計の機械可読な正本とし、人間向けの確認・編集は Batch Studio の Prompt Plan Web UI で提供する。

新規プロジェクトでは `prompt_tree.md` を標準 Artifact として生成・維持しない。

```text
Grok
  -> prompt_plan.json
       |-> Prompt Plan Web UI
       `-> Workflow Compiler
```

Prompt Plan Web UI は `prompt_plan.json` の common、Root LoRA、Branch、Branch LoRA、leaf prompt、実適用強度、validation state 等を人間が追跡できる形で表示・編集する。

UI 上の編集は Prompt Plan の Draft / Confirm lifecycle に従い、別の Markdown 正本を作成しない。

### Workflow boundary

- Workflow Compiler の Prompt 入力は確定済み `prompt_plan.json`。
- `prompt_tree.md` を Workflow Compiler の入力にしない。
- `prompt_tree.md` を Grok に添付して Workflow JSON を作らせる方式にも戻さない。

### Legacy policy

既存プロジェクトに存在する `prompt_tree.md` は Legacy Artifact としてのみ扱う。

必要な場合は Import / conversion candidate として解析できるが、その内容を自動的に正本へ昇格させない。

```text
Legacy prompt_tree.md
  -> Import / conversion candidate
  -> Batch Studio validation / review
  -> User approval
  -> prompt_plan.json
```

Legacy conversion の実装は v1 の必須条件ではなく、必要性が確認された場合に別要件として追加する。

### Rationale

- 人間向け表示のためだけに JSON と Markdown の二重正本を維持する必要がない。
- Web UI なら Branch / Leaf の折りたたみ、強度編集、validation 表示、並べ替え等を直接提供できる。
- Prompt 設計の source of truth を `prompt_plan.json` に一本化できる。
- Markdown と JSON の drift を構造的に防げる。

### Resolves

- `REQ-PLAN-004` を Decided とする。
- `OPEN-001` を Superseded とする。

---

## DEC-017: Prompt Plan Schema v1 is fixed and machine-readable

Date: 2026-09-07
Status: Accepted

### Decision

`prompt_plan.json` Schema v1 の正式 field name と構造を固定する。

機械可読 schema の正本:

```text
schemas/prompt-plan.schema.json
```

正式 root fields:

```text
schemaVersion
common
rootLoras
branches
```

正式 LoRA usage fields:

```text
modelRef
strengthModel
strengthClip
```

正式 Branch fields:

```text
id
label
loras
leaves
```

正式 Leaf fields:

```text
id
name
positive
negative
```

### Stable ID policy

Branch / Leaf の stable ID は次の形式とする。

```regex
^[a-z][a-z0-9._-]{0,63}$
```

- Branch ID は Project 内の全 Branch で一意。
- Leaf ID は全 Branch を横断して Project 内で一意。
- JSON Schema 単体では property-based uniqueness を十分に表現できないため、Batch Studio semantic validator が一意性を保証する。

### LoRA usage policy

- `modelRef` / `strengthModel` / `strengthClip` はすべて必須。
- `strengthModel` / `strengthClip` に暗黙 default を設けない。
- strength の固定範囲を Schema v1 では設けない。
- `modelRef` field name は Prompt Plan が所有するが、参照値の命名規則と target identity は `models.json` contract が所有する。

### Ordering policy

- `branches` 配列順を Workflow branch 順とする。
- `leaves` 配列順を SceneMatrix row 順とする。
- 別途 `order` field を持たない。

### Extension policy

Schema v1 は object の未知 field を許可しない。

```text
additionalProperties: false
```

汎用 `metadata` / `extensions` / `extra` 領域も v1 には設けない。

意味的な新要件が発生した場合のみ正式 schema 変更として追加し、必要に応じて `schemaVersion` と migration policy を更新する。

### Validation boundary

```text
JSON Schema validation
  +
Batch Studio semantic validation
```

JSON Schema は shape / required / type / ID pattern / array minimum / unknown fields 等を検証する。

Semantic validator は Project-wide ID uniqueness、`models.json` に対する `modelRef` 解決、cross-artifact constraints 等を検証する。

### Rationale

- Grok / Web UI / Compiler が同じ field contract を共有できる。
- Schema drift と未知 field の混入を早期検出できる。
- UI の並べ替えと Workflow 順序を単一の配列順で表現できる。
- 人間向け自由 metadata を無制限に持ち込まず、意味要件を明示的に schema evolution へ反映できる。

### Resolves

- `REQ-PLAN-006` を Decided とする。
- `OPEN-003` を Superseded とする。

---

## OPEN-001: prompt_tree.md source-of-truth relationship

Date: 2026-09-07
Status: Superseded

`DEC-016` により解決済み。

`prompt_tree.md` は新規プロジェクトの正本・派生標準Artifactのどちらにもせず、Legacy Artifact としてのみ扱う。人間向け表示・編集は Prompt Plan Web UI が担当する。

---

## OPEN-002: models.json dedicated schema details

Date: 2026-09-07
Status: Open

### Decided

- `models.json` は Batch Studio 専用 schema とする。
- 既存形式との互換性は要件としない。
- catalog provenance は v1 で少なくとも `schemaVersion` / `generation` / `generatedAt` を保持する。
- catalog generation の不一致は再検証トリガーであり、それ自体では invalid にしない。
- Civitai 由来の LoRA 推奨・基準強度は `models.json` が所有する。
- Project で実際に適用する LoRA 強度は `prompt_plan.json` が所有する。

### Remaining Questions

- stable model reference の正式 field name と命名規則。
- `missingRequirements` を同一ファイルに持つか selection draft と分離するか。
- strength recommendation / provenance の正式 field names。
- role、trained words、reason を正式 schema でどう表現するか。

---

## OPEN-003: prompt_plan.json formal JSON Schema

Date: 2026-09-07
Status: Superseded

`DEC-017` により解決済み。

Prompt Plan Schema v1 の正式 field name、Project-wide ID uniqueness、ordering、unknown field policy、schema evolution policy を固定し、機械可読 schema を `schemas/prompt-plan.schema.json` とした。

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

---

## OPEN-006: Civitai strength derivation and model/clip mapping

Date: 2026-09-07
Status: Open

### Questions

Civitai が model-level の明示推奨値を返さず、投稿画像 metadata の LoRA weight から基準値を導出する場合の正式ルールを決める。

- 対象画像の選び方。
- 最低 sample 数。
- median / mode / trimmed mean 等の aggregation method。
- 外れ値処理。
- Civitai metadata の freshness。
- observed usage と creator-declared recommendation の区別。

また、Civitai の LoRA weight が単一値である一方、現在の AnimaLoraStack / Prompt Plan は `strengthModel` と `strengthClip` の2値を持つため、初期値への展開規則を決める。

例:

```text
weight = 0.7
  -> strengthModel = 0.7
  -> strengthClip  = 0.7
```

と単純に同値へする案はあるが、未合意のため確定しない。
