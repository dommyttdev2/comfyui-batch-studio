# External Tools Integration

Status: Active

## 1. 目的

Batch Studio が既存ツールの責務を奪わず、ファイル・プロセス境界を明確にして連携するための方針を定義する。

対象:

- `civit-model-viewer`
- R2 File Manager
- ComfyUI
- Project filesystem

## 2. civit-model-viewer

Repository:

```text
https://github.com/dommyttdev2/civit-model-viewer.git
```

### 2.1 Owner responsibility

`civit-model-viewer` が担当する。

- Civitai API / internal API との通信。
- Civitai API key 管理。
- collection 同期。
- model / version / file 情報取得。
- thumbnail 情報取得。
- `data/model_catalog.json` の保存・更新。

Batch Studio はこの同期処理を複製しない。

### 2.2 Batch Studio responsibility

Batch Studio は保存済み `model_catalog.json` を read-only source として扱う。

主用途:

- Grok へ Model Selection の根拠ファイルとして提示。
- Grok が返した選定結果の Model / Version / File 実在確認。
- catalog 更新世代の検出。

### 2.3 Catalog structure currently relied on

現行 catalog では少なくとも次の概念を利用できる。

```text
schemaVersion
generation
generatedAt
collections[]
  id
  name
  items[]
    modelId
    modelName
    versionId
    versionName
    modelUrl
    trainedWords[]
    files[]
      id
      name
      primary
      sizeKB
      format
      precision
    versions[]
```

Batch Studio 側は catalog の全フィールドを Project schema へコピーする必要はない。選定と再照合に必要な identity を保存する。

### 2.4 Sync flow

```text
User / civit-model-viewer
       |
       v
Civitai Collection
       |
       v
SYNC
       |
       v
model_catalog.json
       |
       +--> Grok Model Selection
       |
       `--> Batch Studio Validation
```

### 2.5 Missing model flow

```text
Grok
  -> 必要モデルがcatalogにない
  -> missingRequirements
  -> UserがCivitai collectionへ追加
  -> civit-model-viewer SYNC
  -> model_catalog.json更新
  -> Grok再選定
```

### 2.6 Catalog path

ローカル配置場所を旧 `scripts/civitai` に固定しない。

Batch Studio 設定で `civit-model-viewer` の `data/model_catalog.json` を参照可能にする方向とする。正式な設定キーは実装前に決める。

## 3. R2 File Manager

### 3.1 Owner responsibility

既存 R2 File Manager が担当する。

- R2 credential / secret 管理。
- object listing。
- upload / download。
- delete / move 等の object operation。
- signed/public URL 等、既存の R2 操作機能。

### 3.2 Batch Studio responsibility

Batch Studio は「プロジェクトで必要なモデルがどこに存在するか」を扱う。

```text
models.json
   vs
Local ComfyUI models
   vs
R2 objects
```

初期段階での連携:

- R2 File Manager を開く。
- 対象 model file / object key を Clipboard 等で引き渡す。
- 所在差分をユーザーへ表示する。

### 3.3 Direct API integration

初期リリースでは R2 File Manager の process-local protection token や secret を共有して直接操作する設計にしない。

将来 API 統合する場合は別 Decision として以下を設計する。

- authentication boundary
- process ownership
- concurrent operation
- error recovery
- destructive action confirmation

## 4. ComfyUI

### 4.1 v1 boundary

Batch Studio は ComfyUI で実行可能な Workflow を生成し、Preflight するところまでを必須責務とする。

```text
Batch Studio
   -> LoRA_{project}.json
   -> models available
   -> READY
```

### 4.2 Out of current required scope

- Queue API 呼び出し。
- 実行 progress tracking。
- generation cancellation。
- output image collection。
- ComfyUI process lifecycle management。

将来追加する場合も Workflow Compiler と Prompt Plan 契約から切り離した integration とする。

## 5. Local Project Filesystem

Project filesystem は作品 Artifact の正本保管場所。

R2 はモデル実体保管であり、Project Artifact の正本にはしない。

Batch Studio が扱う代表的な file:

```text
project_brief.json
project_meta.json
story.md
models.json
prompt_plan.json
prompt_tree.md (status Open)
LoRA_{project}.json
._batch_studio/
```

## 6. Secret boundary

| Secret / Data | Owner | Batch Studio | Grok |
| --- | --- | --- | --- |
| Civitai API key | civit-model-viewer | 読まない | 渡さない |
| R2 credential | R2 File Manager | 読まない | 渡さない |
| Grok Cookie | Grok Web session | projectへ保存しない | Web session自身のみ |
| model binary | Local/R2 | 所在確認 | 添付しない |
| model_catalog.json | civit-model-viewer | 読む | Model選定時に添付可 |
| project artifacts | Project filesystem | 読書き | 必要分だけ手動添付 |

## 7. Integration failure policy

外部ツールが利用できない場合、関係ない工程まで fallback で偽装成功させない。

例:

- catalog が読めない -> Model Selection/validation を unavailable と表示。
- R2 File Manager がない -> R2 transfer は unavailable。Local file だけで READY にできるかは別 availability rule で判定。
- Grok Web が未ログイン -> Grok工程は開始不可。Artifact の既存閲覧は可能。

各 subsystem の失敗を明示し、別の情報源を暗黙に正本へ昇格させない。
