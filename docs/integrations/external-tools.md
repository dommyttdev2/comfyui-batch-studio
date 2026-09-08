# External Tools Integration

Status: Active

## 1. 目的

Batch Studio と外部サービス/ツールの責務境界を定義する。

対象:

- Civitai
- Cloudflare R2
- ComfyUI
- Project filesystem

`civit-model-viewer` と `r2-file-manager` の主要機能は2026-09-08にBatch Studioへ機能統合された。Standalone repositoriesは移行元/旧単体版として参照可能だが、新規Batch Studioフローの外部依存にはしない。

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

429 rate limitは同期失敗として即終了せず、`Retry-After`を優先し、未指定時はbackoff+jitterで待機して同一requestから自動再開する。通常時もrequest開始間隔を平準化する。

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

## 3. Cloudflare R2 / Integrated R2 Manager

### 3.1 Ownership

Batch Studio Electron Main Process がCloudflare R2の実体操作を所有する。

- R2 credential / secret。
- bucket list / create / empty-bucket delete。
- folder-like object listing / paging / bucket-wide search。
- multipart upload / pause / resume / cancel / persisted upload state。
- object move / rename / delete。
- public URL / presigned URL。
- URL / `curl` / `wget` / `aria2c` command生成。
- 最大500件の一括download情報生成。
- batch-download selection template。
- optional Cloudflare account R2 metrics。
- Model Availability / Preflight用のR2 object lookup。

新規Batch Studioフローでは外部`r2-file-manager`のローカルHTTP serverを起動しない。Standalone repositoryは旧単体版としてのみ維持する。

### 3.2 Secret boundary

設定値はElectron `app.getPath('userData')/r2/` 配下に保持する。Secret Access KeyとCloudflare API TokenはElectron `safeStorage` で暗号化し、暗号化不能時に平文へfallback保存しない。

Rendererへ返すconnection statusにはSecret本体を含めず、`secretConfigured` / `metricsTokenConfigured` のboolだけを返す。Grok Web、Project artifact、Grok attachment候補へSecretを渡さない。

環境変数も利用可能:

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY
R2_SECRET_ACCESS_KEY
R2_PUBLIC_URL          optional
CLOUDFLARE_API_TOKEN   optional
```

保存済みAccount ID / Access Key IDと同一identityの場合、Secret欄を空のまま接続テストや非Secret設定変更を許可する。identity変更時はSecret再入力を要求する。

### 3.3 Object browser UX

「モデル配置」工程内のR2 File Manager領域で最低限次を提供する。

- Bucket選択。
- breadcrumb付きfolder navigation。
- filename / full object keyによるbucket-wide検索。
- paging / 「さらに読み込む」。
- file size / modified time表示。
- upload file picker。
- upload progress / pause / resume / cancel。
- app再起動後のunfinished upload表示・再開。
- move / rename。
- main list checkboxによるdelete selection。
- single object download info。
- optional storage metrics。

数GB fileをRendererへ全読込しない。Main ProcessがローカルfileをpartごとにstreamしR2へmultipart uploadする。

### 3.4 Batch download UX

一括download selectionはmain listのdelete checkbox stateと分離する。

- 「一括DLのURL生成」は選択数に依存せず利用可能。
- button押下後、専用popup内で対象objectを選ぶ。
- 初期folderは現在のmain browser prefix。
- folder移動を跨いでselectionを保持。
- bucket-wide searchを利用可能。
- search解除後もselectionを保持。
- popup下部に「選択済みファイル」を表示し、個別解除 / 全解除可能。
- 最大500 objects。501件目は追加しない。
- final generate押下時だけpublic/presigned URLを生成する。
- URL / curl / wget / aria2cをtab表示し、各tabで「すべてコピー」を提供する。
- duplicate local filenamesは`name (2).ext`等で衝突回避する。
- 名前付きbatch selection templateを保存・適用・削除できる。
- cancel / popup close / generate完了後はsession selectionを残さない。

### 3.5 Model Availability integration

Projectごとに次を指定できる。

```text
project_meta.json.settings.r2Bucket
project_meta.json.settings.r2ModelPrefix
```

`models.json`のcheckpoint / LoRA filenameをLocal ComfyUI models rootと統合R2の双方で照会する。

```text
Localあり              -> available
Localなし / R2あり     -> transfer-required / BLOCKED
Localなし / R2なし     -> missing / BLOCKED
```

R2に存在するだけでPreflightをREADYにしない。ComfyUI実行時点ではLocal配置が必要である。

既存Projectの`r2IndexPath`は互換用fallbackとして読み取りを維持できるが、標準経路では統合R2を直接照会する。

## 4. ComfyUI

v1のBatch Studio責務:

```text
Prompt Plan
  -> deterministic Workflow Compiler
  -> LoRA_{project-destination-folder}.json
  -> model availability
  -> Preflight READY / BLOCKED
```

Workflow file名はProject実folderの親、すなわちユーザーが指定したProject作成先folder名を用いる。内部Save pathは`BatchStudio/{project.id}/{branch.id}`を維持する。

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
LoRA_{project-destination-folder}.json
._batch_studio/
```

`model_catalog.json`はapp-wide sourceであり、各Projectへコピーすることを標準にはしない。

R2 credential / upload state / batch download templateはProject artifactではなくapp-wide `userData/r2/` で管理する。

## 6. Secret boundary

| Secret / Data | Owner | Batch Studio | Grok |
| --- | --- | --- | --- |
| Civitai API key | Batch Studio Main Process / environment | Civitai通信だけに使用・Projectへ保存しない | 渡さない |
| R2 credential | Batch Studio Main Process / `safeStorage` | R2通信だけに使用・Projectへ保存しない | 渡さない |
| Cloudflare API Token | Batch Studio Main Process / `safeStorage` | optional metrics取得だけに使用 | 渡さない |
| Grok Cookie | Grok Web persistent session | Projectへ保存しない | Web session自身のみ |
| model binary | Local/R2 | 所在確認 / R2管理 | 添付しない |
| model_catalog.json | Batch Studio app data | 生成・読む | Model選定時に添付可 |
| project artifacts | Project filesystem | 読書き | 必要分だけ手動添付 |

## 7. Integration failure policy

fallbackで偽装成功させない。

- Civitai API key未設定 -> SYNC不可。保存済みCatalogがあれば閲覧は可能。
- tRPC/API failure -> 同期ERROR。保存済みCatalogを消さない。
- Civitai 429 -> wait/retryして同一同期を継続。待機中をUI表示。
- strength evidence不足 -> `strengthBaseline` absent。経験則で補完しない。
- catalog未生成 -> Model Selection/validationを進行不能として明示。
- R2未設定 / credential failure -> R2操作を利用不可として明示。Local availability判定を偽装しない。
- R2 object lookup failure -> R2不存在とはみなさず、接続/設定errorとして扱う。
- incomplete multipart upload -> persisted jobとして保持し、ユーザーが再開/キャンセル可能。
- Grok未ログイン -> Grok工程不可。ただし既存Artifact/Catalog/R2閲覧は可能。
