# External Tools Integration

Status: Active

## 1. 目的

Batch Studio と外部サービス/ツールの責務境界を定義する。

対象:

- Civitai
- Cloudflare R2
- ComfyUI
- SSH / Remote host
- Project filesystem

`civit-model-viewer` と `r2-file-manager` の主要機能は2026-09-08にBatch Studioへ機能統合された。Standalone repositoriesは移行元/旧単体版として参照可能だが、新規Batch Studioフローの外部依存にはしない。

Execution / Remote Execution の詳細は `../architecture/remote-execution.md` を正本とする。

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
- Collection membershipのauthoritative refreshとadded / updated / removed差分計算。
- Model / Version / strength baseline / collection thumbnailのTTL付きmetadata cache。
- API request / retry / 429 / 5xx / network / cache hit-miss / page / membership / elapsed metrics。

RendererへAPI keyを永続化しない。AI agent workspaceへAPI keyを渡さない。

標準保存先はElectron `app.getPath('userData')` 配下の `civitai/model_catalog.json` とする。Projectは `project_meta.json.settings.catalogPath` を介してこのCatalogを参照する。

標準フローはapp-wide統合Catalogを直接利用する。既存Projectの明示的な外部`catalogPath`は互換用として維持する。

### 2.2 UI / UX responsibility

Civit ExplorerはProject工程ではなくapp-wide toolとしてLocal UI全幅で使用する。Projectのモデル選定画面からも同じCatalogのSYNCを実行できる。

最低限提供するUX:

- SYNC状態 / phase / progress / error。
- 保存済みCatalogがある場合、同期失敗後も閲覧可能。
- Collection選択 / 全選択 / 解除。
- モデル名・Base Model・ファイル名・trigger wordによる全Collection横断検索。
- Model選択状態を検索やCollection切替をまたいで保持。
- Version切替。
- File / Base Model / trained words / thumbnail / `strengthBaseline`確認。
- SYNC中/完了後のrequest数、cache hit/miss、retry、HTTP 429/5xx、collection page数、membership件数、経過時間等のmetrics表示。
- Civitai model pageを外部ブラウザで開く。
- 選択結果JSONコピー。
- Collection / Model / Version選択状態の名前付きテンプレート保存・適用・削除。
- 大量モデルを一度にDOM展開せず段階表示できること。

標準工程:

```text
ストーリー      Grokあり
  -> モデル選定  基盤モデルはUser、LoRAはGrok

Civit Explorerはapp-wide toolとして必要時に開く
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

429 rate limitは同期失敗として即終了せず、`Retry-After`を優先し、未指定時はbackoff+jitterで待機して同一requestから自動再開する。5xxとnetwork errorもGET/HEADに限ってbounded retryする。通常request intervalは設定値で固定し、429後に恒久的な遅延へ変化させない。既定cache TTLはModel/Version 30分、Baseline 7日、Thumbnail 24時間で、環境変数で上書き可能。

### 2.6 Missing model flow

```text
Grok
  -> 必要LoRAがcatalogにない
  -> civitai.com / civitai.redで代替候補を調査
  -> 複数LoRAの組合せで解決可能か確認
  -> Prompt代替可能ならpromptFallbacksとして解決済みにする
  -> カタログ外候補または代替不能だけmissingRequirements
  -> Userが必要候補をCivitai Collectionへ追加
  -> Batch Studio Catalog SYNC
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
- public URL / presigned GET URL。
- Standalone R2 File Managerの一時presigned PUT URL。
- Execution用presigned PUT URL。
- caller-specified expiryでのGET signing。
- URL / `curl` / `wget` / `aria2c` command生成。
- 最大500件の一括download情報生成。
- Main Process streaming download-to-local-file。
- batch-download selection template。
- optional Cloudflare account R2 metrics。
- Model Availability / Preflight用のR2 object lookup。
- Remote model staging用GET URL発行。
- Remote artifact upload用PUT URL発行。
- Remote artifactのLocal回収。

新規Batch Studioフローでは外部`r2-file-manager`のローカルHTTP serverを起動しない。Standalone repositoryは旧単体版としてのみ維持する。

### 3.2 Secret boundary

設定値はElectron `app.getPath('userData')/r2/` 配下に保持する。Secret Access KeyとCloudflare API TokenはElectron `safeStorage` で暗号化し、暗号化不能時に平文へfallback保存しない。

Rendererへ返すconnection statusにはSecret本体を含めず、`secretConfigured` / `metricsTokenConfigured` のboolだけを返す。AssistantPane、Project artifact、AI agent workspace、Remote hostへSecretを渡さない。

環境変数も利用可能:

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY
R2_SECRET_ACCESS_KEY
R2_PUBLIC_URL          optional
CLOUDFLARE_API_TOKEN   optional
```

保存済みAccount ID / Access Key IDと同一identityの場合、Secret欄を空のまま接続テストや非Secret設定変更を許可する。identity変更時はSecret再入力を要求する。

Remote executionではRemoteへ渡すのは1 object / 1 operation / limited lifetimeのsigned URLだけとする。signed URLのfull query stringを通常logへ保存しない。

### 3.3 Object browser UX

Projectの「モデル配置」工程内ではR2をmodel availability確認用の **read-only browser** として提供する。管理操作はStandalone R2 File Managerへ集約する。

- Bucket選択。
- breadcrumb付きfolder navigation。
- filename / full object keyによるbucket-wide検索。
- paging / 「さらに読み込む」。
- file size / modified time表示。
- single object direct download / download info。
- 一括DL URL生成（read-only参照画面からも利用可能）。

Standalone R2 File Managerでは上記に加えて次を提供する。

- upload file picker。
- multipart upload progress / pause / resume / cancel。
- app再起動後のunfinished upload表示・再開。
- move / rename。
- main list checkboxによるdelete selection。
- bucket create / empty-bucket delete。
- optional storage metrics。
- 一時presigned PUT URL生成。

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

### 3.5 Temporary PUT URL UX

Standalone R2 File Managerでは、現在選択中bucketと入力したObject Keyに対して短命presigned PUT URLを生成できる。

- Object Keyは空文字、末尾`/`、1024 bytes超過を拒否する。
- expiryは1秒〜604800秒（7日）に制限する。UIは5分 / 15分 / 1時間 / 6時間 / 24時間 / 7日を提供する。
- `Content-Type` は任意。指定時は署名条件へ含め、PUT側でも同じheaderを要求する。
- URLと`curl`を表示・copyできる。
- 同名Objectが存在する場合は上書きされ得ること、期限内はURLを再利用できることをUIで警告する。

### 3.6 Model Availability integration

Projectごとに次を指定できる。

```text
project_meta.json.settings.r2Bucket
project_meta.json.settings.r2ModelPrefix
project_meta.json.settings.executionTarget
```

`models.json`のrequired model filenameをLocal ComfyUI models rootと統合R2の双方で照会する。

Local target:

```text
Localあり              -> available
Localなし / R2あり     -> local-transfer-required / BLOCKED
Localなし / R2なし     -> missing / BLOCKED
```

Remote target:

```text
R2あり                 -> remote-stage-ready
R2なし / Localあり     -> r2-transfer-required / BLOCKED
R2なし / Localなし     -> missing / BLOCKED
```

Local targetではR2に存在するだけでREADYにしない。Remote targetではLocalに存在するだけでREADYにしない。

Remote execution開始後、R2 objectはpublic/presigned GET URLでRemote hostが直接downloadする。model binaryをSSH/SCPでRemoteへ転送しない。

既存Projectの`r2IndexPath`は互換用fallbackとして読み取りを維持できるが、標準経路では統合R2を直接照会する。

## 4. ComfyUI / Remote SSH

### 4.1 Local execution

```text
Prompt Plan
  -> deterministic Workflow Compiler
  -> UI Workflow + API-format execution graph
  -> model availability
  -> Preflight READY / BLOCKED
  -> Local ComfyUI API
  -> Scene Prompt continuous execution
  -> Local output confirmation
```

Local ComfyUI install pathはfilesystem pathであり、API endpointとは分離する。

### 4.2 Remote execution

Remote hostはSSH endpointが外部公開され、private-key authenticationを利用できることを前提とする。

```text
Batch Studio
  -> SSH / private key
  -> Remote Worker
  -> Remote localhost ComfyUI API
```

- SSH Tunnelは使用しない。
- ComfyUI port 8188を外部公開する必要はない。
- password authenticationを標準経路にしない。
- Host Key verificationを無効化しない。
- Remote Workerのみ小さいcontrol artifactとしてSSH転送可能。
- multi-GB model / generated artifacts / ZIPをSSH/SCPで転送しない。

Scene Prompt Tools `ScenePrompterExpand` の「連続生成」はfrontend buttonをremote controlするのではなく、標準ComfyUI APIとScene Prompt Tools custom run-context APIをRemote Workerがlocalhostから呼んで再現する。

詳細は `../architecture/remote-execution.md` を正本とする。

### 4.3 Workflow file name

Workflow file名はProject実folderの親、すなわちユーザーが指定したProject作成先folder名を用いる。内部Save pathは`BatchStudio/{project.id}/{branch.id}`を維持する。

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

Execution Runの永続化先とLocal artifact rootの正確なcontractはProject Artifact文書で固定する。Remote Execution設計上はRun ID、phase、workflow/hash、prompt IDs、artifact manifest、R2 object key、Remote package SHA-256、Local verification結果等を復元可能にする。

`model_catalog.json`はapp-wide sourceであり、各Projectへコピーすることを標準にはしない。

R2 credential / upload state / batch download templateはProject artifactではなくapp-wide `userData/r2/` で管理する。

## 6. Secret boundary

| Secret / Data | Owner | Batch Studio | Remote / AI agent |
| --- | --- | --- | --- |
| Civitai API key | Batch Studio Main Process / environment | Civitai通信だけに使用・Projectへ保存しない | 渡さない |
| R2 credential | Batch Studio Main Process / `safeStorage` | R2通信・signed URL生成だけに使用 | Remote/AI agentへcredential本体を渡さない |
| Cloudflare API Token | Batch Studio Main Process / `safeStorage` | optional metrics取得だけに使用 | 渡さない |
| SSH private key contents | Local filesystem | SSH認証時だけ読む・Projectへコピーしない | AI agentへ渡さない |
| SSH private key path | app-wide settings | Remote接続設定として参照 | AI agentへ渡さない |
| R2 signed URL | Main Process | 必要直前に発行 | Remoteには対象operation用のみ渡す。AI agentへ渡さない |
| Grok / Codex CLI auth data | 各provider CLI | Batch StudioはCLIを起動するがcredentialをProject/workspaceへ複製しない | provider CLI自身が所有 |
| model binary | Local/R2/Remote | 所在確認 / R2管理 / execution staging | AI agent workspaceへ渡さない |
| model_catalog.json | Batch Studio app data | 生成・読む | Model選定taskで必要な参照入力として隔離workspaceへコピー可 |
| project artifacts | Project filesystem | 読書き | taskに必要なファイルだけ隔離workspaceへコピー |


## 7. Integration failure policy

fallbackで偽装成功させない。

- Civitai API key未設定 -> SYNC不可。保存済みCatalogがあれば閲覧は可能。
- tRPC/API failure -> 同期ERROR。保存済みCatalogを消さない。
- Civitai 429 -> wait/retryして同一同期を継続。待機中をUI表示。
- strength evidence不足 -> `strengthBaseline` absent。経験則で補完しない。
- catalog未生成 -> Model Selection/validationを進行不能として明示。
- R2未設定 / credential failure -> R2操作を利用不可として明示。availability判定を偽装しない。
- R2 object lookup failure -> R2不存在とはみなさず、接続/設定errorとして扱う。
- incomplete multipart upload -> persisted jobとして保持し、ユーザーが再開/キャンセル可能。
- SSH auth failure -> public ComfyUI accessへfallbackしない。
- Remote model GET failure -> SCP model transferへfallbackしない。
- signed URL expiry -> Execution Serviceが新URLを発行してretryし、credentialをRemoteへ渡さない。
- hash mismatch -> Run成功にしない。
- prompt submit failure -> idempotency evidenceなしで自動重複submitしない。
- Grok未ログイン -> Grok工程不可。ただし既存Artifact/Catalog/R2閲覧は可能。
