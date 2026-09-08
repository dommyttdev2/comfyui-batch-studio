# External Tools Integration

Status: Active

## 1. 目的

Batch Studio と外部サービス/ツールの責務境界を定義する。

対象:

- Civitai
- R2 File Manager
- ComfyUI
- Project filesystem

`civit-model-viewer` は2026-09-08にBatch Studioへ機能統合された。Standalone repositoryは移行元/旧単体版として参照可能だが、新規Batch Studioフローの外部依存にはしない。

## 2. Civitai / Integrated Model Catalog

### 2.1 Batch Studio responsibility

Batch Studio Electron Main Process が次を担当する。

- Civitai API / internal tRPC APIとの通信。
- Civitai API keyのMain Process内保持。
- Public / Private Model Collection同期。
- collection paging。
- model / version / file / thumbnail / trained words取得。
- Civitai observed-use LoRA strength evidence取得・集計。
- app-wide `model_catalog.json` の保存・更新。
- catalog `generation` / `generatedAt` / added・updated・removed件数管理。
- Collection / Model / Version選択テンプレートのapp-wide保存。

RendererへAPI keyを永続化しない。Grok WebへAPI keyを渡さない。

標準保存先はElectron `app.getPath('userData')` 配下の `civitai/model_catalog.json` とする。Projectは `project_meta.json.settings.catalogPath` を介してこのCatalogを参照する。

新規Project、およびcatalogPath未設定の既存Projectは統合Catalogへ自動関連付けする。既存の明示的な外部`catalogPath`は互換用として維持し、「モデルカタログ」工程から統合Catalogへ切り替え可能とする。

### 2.2 UI / UX responsibility

「モデルカタログ」工程はGrokを必要とせず、Local UIを全幅で使用する。

最低限提供するUX:

- SYNC状態 / phase / progress / error。
- 保存済みCatalogがある場合、同期失敗後も閲覧可能。
- Collection選択 / 全選択 / 解除。
- モデル名・ファイル名による全Collection横断検索。
- Model選択状態を検索やCollection切替をまたいで保持。
- Version切替。
- File / trained words / thumbnail / `strengthBaseline`確認。
- Civitai model pageを外部ブラウザで開く。
- 選択結果JSONコピー。
- Collection / Model / Version選択状態の名前付きテンプレート保存・適用・削除。
- 大量モデルを一度にDOM展開せず段階表示できること。

標準工程:

```text
ストーリー          Grokあり
  -> モデルカタログ  Grokなし
  -> モデル選定      Grokあり
```

### 2.3 Catalog structure

```text
schemaVersion
generation
generatedAt
collections[]
  id
  name
  description
  read
  thumbnailUrl
  items[]
    modelId
    modelName
    versionId
    versionName
    modelUrl
    thumbnailUrl
    trainedWords[]
    files[]
      id
      name
      primary
      sizeKB
      format
      precision
    versions[]
      versionId
      versionName
      modelUrl
      thumbnailUrl
      trainedWords[]
      files[]
      strengthBaseline?
    strengthBaseline?
```

Batch StudioのProject artifactへCatalog全体をコピーしない。Grok Model Selectionとidentity再検証に必要なCatalogはapp-wide sourceとして維持し、選定結果だけを`models.json`へ固定する。

### 2.4 Civitai observed LoRA strength

exact model versionについて次を取得する。

```text
GET /api/v1/images
  ?modelVersionId={versionId}
  &withMeta=true
  &sort=Newest
  &limit=200
```

有効resource条件:

```text
resource.type == "lora"
resource.modelVersionId == exact versionId
resource.weight is a JSON number
image.postId is available
```

同一postの複数画像を複数票として扱わない。

```text
perPost = median(weights in each postId)
strengthBaseline.value = median(perPost values)
```

最低条件:

```text
valid distinct post count >= 5
```

5 posts未満、metadata欠落、API失敗等では`strengthBaseline`を省略する。1.0/0.7等のfallbackを捏造しない。

provenance:

```json
{
  "value": 0.7,
  "provenance": {
    "source": "civitai",
    "basis": "observed-usage-derived",
    "method": "median-of-post-medians:newest-200",
    "sampleCount": 17
  }
}
```

`sampleCount`は画像枚数ではなくdistinct post数。

### 2.5 API boundary

環境変数:

```text
CIVIT_API_KEY
CIVITAI_BASE_URL        optional
CIVITAI_MATURE_BASE_URL optional
CIVITAI_TIMEOUT         optional
```

Collection一覧・item取得にはCivitai内部tRPC APIを利用する。非公開APIであるためCivitai側の変更で壊れる可能性をUI上の同期エラーとして明示する。

成熟コンテンツを含むCollection item取得では設定されたmature endpointを使用する。Blocked contentを無条件に取得する設計にはしない。

### 2.6 Missing model flow

```text
Grok
  -> 必要モデルがcatalogにない
  -> missingRequirements
  -> UserがCivitai Collectionへ追加
  -> Batch Studio モデルカタログ SYNC
  -> model_catalog.json generation更新
  -> Grok再選定
```

## 3. R2 File Manager

R2 File Managerは次を所有する。

- R2 credential / secret。
- object listing。
- upload / download。
- delete / move等のobject operation。
- signed/public URL。

Batch Studioは`models.json`とLocal/R2所在差分を扱い、必要操作をR2 File Managerへ引き渡す。v1ではR2 credentialを共有して直接破壊操作を行わない。

## 4. ComfyUI

v1のBatch Studio責務:

```text
Prompt Plan
  -> deterministic Workflow Compiler
  -> LoRA_{project.id}.json
  -> model availability
  -> Preflight READY / BLOCKED
```

現行必須scope外:

- Queue API。
- progress tracking。
- generation cancellation。
- output image collection。
- ComfyUI process lifecycle management。

## 5. Local Project Filesystem

Project filesystemは作品Artifactの正本保管場所。

```text
project_brief.json
project_meta.json
story.md
models.json
prompt_plan.json
LoRA_{project.id}.json
._batch_studio/
```

`model_catalog.json`はapp-wide sourceであり、各Projectへコピーすることを標準にはしない。

## 6. Secret boundary

| Secret / Data | Owner | Batch Studio | Grok |
| --- | --- | --- | --- |
| Civitai API key | Batch Studio Main Process / environment | Civitai通信だけに使用・Projectへ保存しない | 渡さない |
| R2 credential | R2 File Manager | 読まない | 渡さない |
| Grok Cookie | Grok Web persistent session | Projectへ保存しない | Web session自身のみ |
| model binary | Local/R2 | 所在確認 | 添付しない |
| model_catalog.json | Batch Studio app data | 生成・読む | Model選定時に添付可 |
| project artifacts | Project filesystem | 読書き | 必要分だけ手動添付 |

## 7. Integration failure policy

fallbackで偽装成功させない。

- Civitai API key未設定 -> SYNC不可。保存済みCatalogがあれば閲覧は可能。
- tRPC/API failure -> 同期ERROR。保存済みCatalogを消さない。
- strength evidence不足 -> `strengthBaseline` absent。経験則で補完しない。
- catalog未生成 -> Model Selection/validationを進行不能として明示。
- R2 File Manager unavailable -> R2 transfer unavailable。
- Grok未ログイン -> Grok工程不可。ただし既存Artifact/Catalog閲覧は可能。
