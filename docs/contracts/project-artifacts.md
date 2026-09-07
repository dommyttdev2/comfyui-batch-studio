# Project Artifacts Contract

Status: Active / some schemas Draft

## 1. 目的

プロジェクト内で何を正本として保存し、どの成果物がどの入力から作られるかを定義する。

Grok の会話そのものは正本ではない。ファイルシステム上に保存され、検証とユーザー確定を経た Artifact を正本とする。

## 2. 推奨プロジェクト構成

```text
{project_root}/
├─ project_brief.json
├─ project_meta.json
├─ story.md
├─ models.json
├─ prompt_plan.json
├─ LoRA_{project_name}.json
└─ ._batch_studio/
   ├─ drafts/
   └─ history/
```

新規プロジェクトでは `prompt_tree.md` を標準 Artifact として生成・維持しない。

既存プロジェクトでは全ファイルが存在することを要求しない。既存の `prompt_tree.md` は Legacy Artifact として認識できるが、新規の正本関係には参加させない。

## 3. Artifact 一覧

| Artifact | Owner | Source | Role |
| --- | --- | --- | --- |
| `project_brief.json` | Batch Studio / User | 初期画面 | Story作成前の最小入力 |
| `story.md` | Grok + User | Brief / reference | 作品・場面設計の人間可読正本 |
| `models.json` | Grok selection + Batch Studio validation + User | `story.md`, `model_catalog.json` | 使用モデルの固定結果と Civitai 由来のモデル基準情報 |
| `prompt_plan.json` | Grok + Batch Studio validation + User approval | `story.md`, `models.json` | Workflow Compiler が読む確定済みの機械可読 Prompt Plan。実際の LoRA 適用強度も保持する |
| `LoRA_{project_name}.json` | Workflow Compiler | Template, Manifest, models, plan | 最終ComfyUI Workflow |
| `project_meta.json` | Batch Studio | System | Artifact status、version、将来hash等 |

Legacy:

| Artifact | Status | Role |
| --- | --- | --- |
| `prompt_tree.md` | Legacy only | 既存プロジェクトの過去形式。新規生成・正本運用・Workflow Compiler の直接入力には使用しない |

## 4. project_brief.json

詳細は `../ui/project-initialization.md` を正本とする。

Brief は Story 全体の詳細 schema ではなく、Grok に最初の提案を依頼するための最小入力である。

## 5. story.md

`story.md` は Grok とユーザーの会話で作成し、Batch Studio へ貼り戻して確定する。

少なくとも以下を表現できることを期待する。

- タイトル / 読者対象
- 対象キャラクターと設定
- 人物関係
- 舞台 / 時間 / 開始・終了状態
- 外見 / 衣装 / 性格 / 視覚上の不変特徴
- 章 / 場面構成
- 画像化ポイント
- 禁止・除外方向
- 目標画像枚数へ展開できる粒度

厳密な Markdown schema は現時点で固定しない。

## 6. models.json

### 6.1 意味

Grok が `model_catalog.json` から選定した「このプロジェクトで実際に使うモデル・バージョン・ファイル」を固定する。

Batch Studio は選定主体ではなく、実在性の検証と確定保存を担当する。

`models.json` は同時に、選定したモデルについて **Civitai をソースとする基準情報** を保持する。LoRA の推奨・基準強度を Civitai 由来で取得できる場合、その値は `models.json` が所有する。

ここで保持する強度は「モデル側の基準情報」であり、最終 Workflow へ必ずそのまま適用される値ではない。実際に各 Root / Branch で使用する強度は `prompt_plan.json` が所有する。

### 6.2 Schema 方針

`models.json` は既存の Civitai Selection API 等の既存形式との互換性を要件としない。

ComfyUI Batch Studio の責務に合わせた専用 schema を新規定義し、その schema をプロジェクト内の正本とする。

専用 schema は少なくとも次を直接表現できる必要がある。

- 選定元 catalog の provenance。
- Project 内で安定して参照できる model reference。
- Civitai Model / Version / File identity。
- 実ファイル名。
- model role。
- trained words / trigger words。
- Grok の選定理由など、後続工程で必要な意味情報。
- LoRA について Civitai 由来で取得できる推奨・基準強度と、その provenance。
- catalog 内に必要モデルがなかった場合の不足要件。

既存形式からの移行・読込互換が必要になった場合は、正本 schema 自体を既存形式へ寄せず、Importer / Migration の別責務として扱う。

### 6.3 Draft shape

最低限、選定項目をカタログへ一意に照合できる情報を保存する。

Draft concept:

```json
{
  "schemaVersion": 1,
  "catalog": {
    "schemaVersion": 1,
    "generation": 42,
    "generatedAt": "..."
  },
  "selections": [
    {
      "ref": "checkpoint.main",
      "role": "checkpoint",
      "modelId": 10001,
      "versionId": 20001,
      "fileId": 30001,
      "fileName": "model.safetensors",
      "modelUrl": "...",
      "trainedWords": [],
      "reason": "..."
    },
    {
      "ref": "lora.character",
      "role": "lora",
      "modelId": 10002,
      "versionId": 20002,
      "fileId": 30002,
      "fileName": "character.safetensors",
      "trainedWords": ["character trigger"],
      "strengthRecommendation": {
        "value": 0.7,
        "source": "civitai",
        "basis": "image-metadata"
      },
      "reason": "..."
    }
  ],
  "missingRequirements": []
}
```

これは専用 schema の方向を示す Draft であり、`strengthRecommendation` を含む正式フィールド名は未確定。

上記の `value: 0.7` は schema 例であり、Civitai からその値を直接取得できることを意味しない。

### 6.4 Catalog provenance and revalidation

`models.json` は、モデル選定時に使用した `model_catalog.json` の provenance として v1 では少なくとも次を保持する。

```text
catalog.schemaVersion
catalog.generation
catalog.generatedAt
```

`generation` は「その選定後に catalog が変更されたか」を検出するための世代番号として扱う。

原則:

- 現在の catalog と `models.json` の `catalog.generation` が同じであれば、generation 差分を理由とする再検証は不要。
- `catalog.generation` が異なる場合は、`models.json` に固定された全 Model / Version / File identity を現在の catalog に対して再検証する。
- generation が異なるだけでは `models.json` を invalid / stale と判定しない。
- 選定済み Model / Version / File がすべて現在の catalog に存在する場合は `models.json` を valid と扱う。必要に応じて「catalog更新後に再検証済み」という情報表示は可能。
- identity は維持されているが後続処理に関係する metadata が変化した場合は valid を維持しつつ warning を表示できる。
- 選定済み Model / Version / File が現在の catalog から消失した場合は、その selection を blocking error として扱い、再選定またはユーザー対応を要求する。

したがって意味は次の通り。

```text
generation mismatch
  != project stale

generation mismatch
  = catalog changed since selection
  = selected identities must be revalidated
```

v1 では catalog 内容全体の hash を必須 provenance としない。完全な内容同一性や監査用 snapshot が将来必要になった場合は `contentHash` 等を schema version 更新で追加する。

### 6.5 Stable reference

`prompt_plan.json` は `.safetensors` ファイル名を重複記載するのではなく、`models.json` の選定項目を一意に参照できる stable reference を使う方針を推奨する。

例 `checkpoint.main`, `lora.character`, `lora.pose.cowgirl`。

`ref` という正式フィールド名、命名規則、一意性制約は Draft。

### 6.6 LoRA strength recommendation

`models.json` に保存する LoRA 強度は、Civitai を source of truth とする **推奨・基準情報** である。

原則:

- Civitai から明示的または追跡可能な根拠を得られる場合だけ保存する。
- 根拠がない場合は null / absent とし、経験則だけで `models.json` を補完しない。
- 値だけではなく、その値をどの Civitai 情報から得たかを追跡可能にする。
- Civitai 上の「実際に投稿画像で使われた weight」から基準値を導出する場合、それを作者の明示的推奨値と同一視しない。
- 導出値を採用する場合は、導出方法と evidence を provenance に含める。

2026-09-07 時点の Civitai Site API 調査では、Model / Model Version の公開レスポンスに汎用的な「推奨 LoRA 強度」フィールドは確認できない。一方、Images API の `withMeta=true` では投稿画像の `meta.civitaiResources[].weight` として、その画像で使われた LoRA weight を取得できる場合がある。

したがって、投稿画像群から基準値を算出する場合の集計アルゴリズムは別途確定する。

## 7. prompt_plan.json

`prompt_plan.json` は Grok から返された意味的な生成計画を、Batch Studio の検証とユーザー承認を経て確定した機械可読 Artifact である。

標準ファイル名:

```text
prompt_plan.json
```

プロジェクト直下には現在の確定版を1ファイルだけ置き、Workflow Compiler はこの確定版を Prompt Plan の入力として使用する。

```text
Grok response
   -> Draft
   -> Batch Studio validation
   -> User approval
   -> prompt_plan.json
   -> Workflow Compiler
```

確定前の候補や旧版は標準ファイル名へ直接保存しない。

```text
._batch_studio/drafts/prompt_plan/{timestamp}
._batch_studio/history/prompt_plan/{timestamp}
```

版番号や `final` などの状態をファイル名へ埋め込まず、`prompt_plan_v2.json`、`prompt_plan_final.json` 等を正規運用として作らない。

正本定義の詳細は `prompt-plan.md` が所有する。

Workflow 内部形式を含まず、主に次を持つ。

- project common prompt
- root LoRA references
- root LoRA の実適用強度
- branches
- branch LoRA references
- branch LoRA の実適用強度
- branch leaves / matrix prompts

`models.json` の強度はモデル基準情報、`prompt_plan.json` の強度は当該プロジェクトで実際に Workflow へ適用する可変値であり、役割が異なる。

人間向けの確認・編集は `prompt_plan.json` から構築した Batch Studio の Prompt Plan Web UI で行う。Markdown など別の人間可読 Artifact を正本として並行管理しない。

## 8. Legacy prompt_tree.md

Status: Legacy only

`prompt_tree.md` は新規プロジェクトの標準 Artifact ではない。

原則:

- Batch Studio は新規プロジェクトで `prompt_tree.md` を生成・維持しない。
- Workflow Compiler は `prompt_tree.md` を直接入力として使用しない。
- 人間向け Prompt Tree はファイルではなく Prompt Plan Web UI で表示する。
- UI 上の編集結果は `prompt_plan.json` に反映し、別の Markdown 正本を作らない。
- `prompt_tree.md` が欠損・削除されていても、新規方式の Workflow 生成には影響しない。

既存プロジェクトに `prompt_tree.md` が存在する場合は Legacy Artifact として認識できる。

Legacy から新方式へ移行する必要がある場合は、`prompt_tree.md` を自動的に正本へ昇格させず、Import / conversion candidate として解析し、ユーザー確認を経て `prompt_plan.json` として確定する。

```text
Legacy prompt_tree.md
      -> Import / conversion candidate
      -> Batch Studio validation / review
      -> User approval
      -> prompt_plan.json
```

Legacy conversion の詳細 schema / parser は必要になった時点で別要件として定義する。

## 9. Workflow Artifact

新規確定時の標準名:

```text
LoRA_{project_name}.json
```

既存プロジェクトには次のような旧形式があるため読込互換を持つ。

```text
LoRA Character Batch - ...json
LoRA_Character_Batch_...json
```

最終 Workflow は Grok の成果物ではなく Compiler output である。

## 10. project_meta.json

新規プロジェクトで利用する Batch Studio metadata。

Draft example:

```json
{
  "schemaVersion": 1,
  "projectId": "15_example",
  "displayName": "Example",
  "createdAt": "...",
  "artifacts": {
    "story": {"path": "story.md", "status": "confirmed"},
    "models": {"path": "models.json", "status": "confirmed"},
    "promptPlan": {"path": "prompt_plan.json", "status": "confirmed"},
    "workflow": {"path": "LoRA_15_example.json", "status": "generated"}
  }
}
```

将来追加候補:

- artifact hashes
- template version / hash
- compiler version
- manifest version
- source catalog generation

既存プロジェクトでは metadata を必須にしない。

## 11. Draft / History

確定前入力:

```text
._batch_studio/drafts/{artifact}/{timestamp}
```

確定ファイル更新直前の履歴:

```text
._batch_studio/history/{artifact}/{timestamp}
```

原則:

- ユーザー確認前に final artifact を上書きしない。
- Grok の貼り戻し直後は Draft。
- 確定済み `prompt_plan.json` の更新時は、更新前の版を history へ退避してから新しい確定版へ置き換える。
- Compiler output も最初は generated candidate とし、検証後に確定可能とする。

## 12. Artifact Dependency

```text
project_brief.json
      |
      v
   story.md
      |
      +------------------+
      |                  |
      v                  v
model_catalog.json    models.json
      ^                  |
      |                  v
civit-model-viewer   prompt_plan.json
                         |
              Template + Manifest
                         |
                         v
                  Workflow Compiler
                         |
                         v
              LoRA_{project}.json
```

`prompt_tree.md` は Legacy Artifact であり、この新規 Artifact dependency graph には含めない。
