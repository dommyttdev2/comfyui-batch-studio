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
- Civitai 由来の LoRA strength evidence 取得・集計。
- `data/model_catalog.json` の保存・更新。

Batch Studio はこの同期・Civitai API通信を複製しない。

### 2.2 Batch Studio responsibility

Batch Studio は保存済み `model_catalog.json` を read-only source として扱う。

主用途:

- Grok へ Model Selection の根拠ファイルとして提示。
- Grok が返した選定結果の Model / Version / File 実在確認。
- catalog 更新世代の検出。
- catalog に Civitai 由来の LoRA `strengthBaseline` が含まれる場合、その値と provenance を `models.json` へ固定する。

Batch Studio 自身は strength evidence を再集計せず、Civitai APIを直接呼ばない。

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

Batch Studio 側は catalog の全フィールドを Project schema へコピーする必要はない。選定と再照合に必要な identity と、利用可能な Civitai provenance だけを保存する。

2026-09-07 時点の `civit-model-viewer` 実装では、Model / Version / File、trained words、thumbnail 等を収集しているが、投稿画像の LoRA weight を `model_catalog.json` へ出力する処理はまだ持っていない。この strength evidence export は本契約に従う追加実装対象とする。

### 2.4 Civitai LoRA strength source

2026-09-07 時点の Civitai Site API では、Model / Model Version の公開レスポンスに汎用的な「推奨 LoRA 強度」field は確認できない。

一方、Images API は specific model version と generation metadata を指定できる。

```text
GET /api/v1/images
  ?modelVersionId={versionId}
  &withMeta=true
  &sort=Newest
  &limit=200
```

metadata が存在する画像では、次のような情報を得られる場合がある。

```json
{
  "postId": 123,
  "meta": {
    "civitaiResources": [
      {
        "type": "lora",
        "modelVersionId": 12345,
        "weight": 0.7
      }
    ]
  }
}
```

この `weight` は「その投稿画像で実際に使用された値」であり、Civitai / 作者が明示した汎用推奨値とは扱わない。

地域・browsing level・metadata非公開等により取得できる画像集合が限定される可能性があるため、導出値の意味は **Civitai observed usage baseline** とする。普遍的推奨値と表示しない。

### 2.5 observed-usage-derived algorithm

`civit-model-viewer` が exact selected LoRA version の observed baseline を作る場合、v1では次を固定する。

#### Sampling

```text
modelVersionId = exact selected version
sort           = Newest
limit          = 200
withMeta       = true
```

対象resourceは次をすべて満たすものだけとする。

```text
resource.type == "lora"
resource.modelVersionId == exact selected versionId
resource.weight is a JSON number
image.postId is available
```

モデル名・ファイル名・prompt文字列の類似検索で別versionのweightを混ぜない。

#### Post normalization

同じ投稿に複数画像が存在しても投稿枚数を票数として扱わない。

各 `postId` 内の有効weight群について median を求め、1 post = 1 observation とする。

```text
Post A weights [0.7, 0.7, 0.8] -> 0.7
Post B weights [0.6]           -> 0.6
Post C weights [0.75, 0.8]     -> 0.775
```

#### Aggregation

post median 群の median を最終 `strengthBaseline.value` とする。

```text
strengthBaseline.value
  = median(per-post medians)
```

最低条件:

```text
valid distinct post count >= 5
```

5 posts未満の場合は observed baseline を生成しない。

v1では追加のweight範囲filter、clamp、IQR除去、trimmed mean等の外れ値処理を行わない。weightの固定範囲を仮定せず、median自体のrobustnessを利用する。

### 2.6 Strength provenance / catalog extension

導出値は version に属する optional `strengthBaseline` として `model_catalog.json` へ出力する。

正式 field name:

```text
strengthBaseline
```

概念shape:

```json
{
  "strengthBaseline": {
    "value": 0.7,
    "provenance": {
      "source": "civitai",
      "basis": "observed-usage-derived",
      "method": "median-of-post-medians:newest-200",
      "sampleCount": 17
    }
  }
}
```

意味:

- `value`: median of per-post medians。
- `source`: `civitai`。
- `basis`: v1実装では `observed-usage-derived`。
- `method`: `median-of-post-medians:newest-200`。
- `sampleCount`: 有効画像枚数ではなく distinct `postId` 数。

`versions[].strengthBaseline` をversion-specific sourceとし、現在選択versionをitem rootへ展開する既存export構造では selected version の `strengthBaseline` を item rootにもmirrorできる。

`model_catalog.json` 自体の schemaVersion 更新要否・migrationは `civit-model-viewer` 側のcatalog schema ownershipに従う。Batch Studio側の `models.json` Schema v1 は既存の optional `strengthBaseline` shapeでこの値を保持できるため、今回の決定だけを理由とした `models.json.schemaVersion` bumpは不要。

### 2.7 creator-declared boundary

`models.json` Schema v1 は provenance `basis = creator-declared` を表現可能だが、v1の observed aggregationで説明文を解析して creator-declared 値を捏造しない。

```text
Model description / version description
  -> regex / LLM extraction
  -> creator-declared
```

のような経路は禁止する。

将来 Civitai が creator の明示strengthを structured field / structured API data として提供し、そのidentityと意味を機械的に検証できる場合のみ `creator-declared` を利用できる。

### 2.8 Freshness

strength evidence専用の独立timestampを `models.json` Schema v1へ追加しない。

viewerがSYNC時に再集計し、`model_catalog.json` の既存provenanceを更新する。

```text
SYNC
 -> strength evidence refresh
 -> model_catalog.generation increment
 -> model_catalog.generatedAt update
```

Batch Studio は既存の catalog generation mismatch revalidation rule に従う。

### 2.9 Sync flow

```text
Civitai Collection / Civitai Images metadata
       |
       v
civit-model-viewer SYNC
  - Model / Version / File identity
  - exact-version LoRA weight evidence
  - per-post median
  - median of post medians
       |
       v
model_catalog.json
       |
       +--> Grok Model Selection
       |
       `--> Batch Studio Validation
               |
               v
            models.json
```

strength evidence が不足している場合は `strengthBaseline` absent のまま同期を成功させる。値がないことを同期失敗として扱わない。

### 2.10 Missing model flow

```text
Grok
  -> 必要モデルがcatalogにない
  -> missingRequirements
  -> UserがCivitai collectionへ追加
  -> civit-model-viewer SYNC
  -> model_catalog.json更新
  -> Grok再選定
```

### 2.11 Catalog path

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
   -> LoRA_{project.id}.json
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
LoRA_{project.id}.json
._batch_studio/
```

既存プロジェクトで `prompt_tree.md` が存在する場合は Legacy Artifact として認識できるが、新規プロジェクトの標準 Artifact、Workflow Compiler の入力、Grok への標準添付候補には含めない。

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
- strength evidence が catalog にない、または valid distinct posts が5未満 -> `models.json` の Civitai 由来基準強度を absent とし、経験則で偽装補完しない。
- R2 File Manager がない -> R2 transfer は unavailable。Local file だけで READY にできるかは別 availability rule で判定。
- Grok Web が未ログイン -> Grok工程は開始不可。Artifact の既存閲覧は可能。

各 subsystem の失敗を明示し、別の情報源を暗黙に正本へ昇格させない。
