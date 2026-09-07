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
├─ prompt_tree.md          # 位置づけは Open
├─ LoRA_{project_name}.json
└─ ._batch_studio/
   ├─ drafts/
   └─ history/
```

既存プロジェクトでは全ファイルが存在することを要求しない。

## 3. Artifact 一覧

| Artifact | Owner | Source | Role |
| --- | --- | --- | --- |
| `project_brief.json` | Batch Studio / User | 初期画面 | Story作成前の最小入力 |
| `story.md` | Grok + User | Brief / reference | 作品・場面設計の人間可読正本 |
| `models.json` | Grok selection + Batch Studio validation + User | `story.md`, `model_catalog.json` | 使用モデルの固定結果 |
| `prompt_plan.json` | Grok + User | `story.md`, `models.json` | Workflow生成用の意味的Prompt正本候補 |
| `prompt_tree.md` | Open | 既存プロジェクト / 将来派生 | 人間可読Prompt Tree。正本関係は未決 |
| `LoRA_{project_name}.json` | Workflow Compiler | Template, Manifest, models, plan | 最終ComfyUI Workflow |
| `project_meta.json` | Batch Studio | System | Artifact status、version、将来hash等 |

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

### 6.2 必要な識別情報

最低限、選定項目をカタログへ一意に照合できる情報を保存する。

Draft concept:

```json
{
  "schemaVersion": 1,
  "catalog": {
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
      "reason": "..."
    }
  ],
  "missingRequirements": []
}
```

このフィールド名と既存 `models.json` 互換性は実装前に確定するため Draft とする。

### 6.3 catalog generation

`model_catalog.json` が更新されても、generation が変わっただけで `models.json` を無効にしない。

- generation 変更: stale warning。
- 選定した Model / Version / File が現在の catalog から消えた: blocking または強い警告。

### 6.4 Stable reference

`prompt_plan.json` は `.safetensors` ファイル名を重複記載するのではなく、`models.json` の選定項目を一意に参照できる stable reference を使う方針を推奨する。

例 `checkpoint.main`, `lora.character`, `lora.pose.cowgirl`。

`ref` という正式フィールド名は Draft。

## 7. prompt_plan.json

意味的な Grok -> Batch Studio 契約。

正本定義は `prompt-plan.md` が所有する。

Workflow 内部形式を含まず、主に次を持つ。

- project common prompt
- root LoRA references
- branches
- branch LoRA references
- branch leaves / matrix prompts

## 8. prompt_tree.md

Status: Open

既存プロジェクトでは重要な人間可読成果物として存在する一方、今回決定した `prompt_plan.json` と内容が重複する。

次のどちらにするかはまだ固定しない。

### Option A: 独立正本

```text
Grok -> prompt_tree.md
Grok -> prompt_plan.json
```

欠点: 同じ Prompt 設計を二重管理し、食い違いが起こり得る。

### Option B: 派生成果物

```text
Grok -> prompt_plan.json (machine-readable source)
Batch Studio -> prompt_tree.md (human-readable projection)
```

利点: Workflow と人間向け表示の情報源を一本化できる。

この判断は実装前に Decision Log へ追加する。

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

`prompt_tree.md` は Open decision のため依存グラフから一旦分離している。
