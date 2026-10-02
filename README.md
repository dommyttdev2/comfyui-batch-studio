# ComfyUI Batch Studio

ComfyUI Batch Studio は、ComfyUI を使った大量画像生成プロジェクトについて、**企画・モデル選定・Workflow 生成から Local / Remote 実行、成果物回収、最終成果物の指定、キャプション・サムネイル・販売サイト用画像の作成まで**を一つの Electron デスクトップアプリで管理するためのツールです。

意味的・創作的な判断は選択中の AI agent（Grok CLI / Codex CLI）、状態管理・検証・機械変換・保存は Batch Studio、最終決定はユーザー、という責務分担を採用しています。

> [!IMPORTANT]
> Local / Remote Execution、進捗監視・停止・再開、Remote Worker、R2 経由の成果物回収、後工程はコード上実装されています。`実行前チェック` の `READY` は入力・配置など開始前条件の判定で、ComfyUI / SSH / Vast.ai / R2 の稼働状況や全工程の成功を保証しません。公開環境での一連の実機 E2E 成功を、この README は保証しません。実行と復旧の既知の課題は [Open Issues](https://github.com/dommyttdev2/comfyui-batch-studio/issues) を確認してください。

## 主な機能

バージョン付番は[プロジェクトの付番ルール](docs/operations/versioning.md)で定義します。開発版 `0.x.y` の x は機能追加・機能拡張、y はバグ修正・互換性を保つ改善を表します。互換性のない変更も x を増やし、影響と移行方法をリリースノートに記載します。

- Project Brief からのプロジェクト作成
- 共通 AssistantPane から Grok CLI / Codex CLI を利用する Story 作成支援
- Civitai Model Collection の同期と統合 `model_catalog.json` 管理
- ユーザーによる Model Family / 基盤モデル選択と、選択中の AI agent による LoRA / Version / File 選定支援
- `models.json` / `prompt_plan.json` の検証・Draft・確定・履歴管理
- Prompt Plan のツリー形式レビュー・編集
- Template + Manifest からの決定論的 ComfyUI Workflow 生成
- Local / Cloudflare R2 のモデル所在確認
- Cloudflare R2 の bucket / object / multipart upload / download / move / delete / batch DL / 一時PUT URL管理
- 実行前 Preflight (`READY` / `BLOCKED`) と Local / Vast.ai Remote Execution（Run履歴、生成進捗、停止・再開）
- Remote環境準備、R2からのモデル配置、生成成果物ZIPのR2経由Local回収・SHA-256検証
- 最終成果物の指定、caption.txt生成、サムネイル編集、販売サイト用画像とZIPの生成
- `Window` メニューから R2 File Manager / Civit Explorer / vast.ai を別ウィンドウ表示

旧 `civit-model-viewer` と `r2-file-manager` の主要機能は Batch Studio に統合済みです。新規フローでは、それらを別サーバーとして起動する必要はありません。

## 必要環境

### 必須

- Node.js `^20.19.0` または `>=22.12.0`
- npm
- デスクトップ GUI を利用できる環境

### 利用する工程に応じて必要

- **Grok CLI または Codex CLI**: Story / モデル選定 / Prompt Plan / Caption で AI agent を利用するとき。利用する provider の CLI をインストールし、CLI 側で認証を完了してください
- **Civitai API Key**: 統合モデルカタログを新規同期するとき
- **Cloudflare R2 credentials**: R2 機能を利用するとき
- **Local ComfyUI installation（標準ノードのみ）**: Localモデル配置・Local生成を利用するとき。Local実行には起動中のComfyUI APIが必要です。追加custom_nodesは不要です
- **Vast.ai API Key + SSH private key path + Remote ComfyUIインストール先 + R2**: Vast.ai Remote実行を利用するとき。選択InstanceへのSSH接続とRemote環境準備・R2転送が必要です

## セットアップ

```bash
git clone https://github.com/dommyttdev2/comfyui-batch-studio.git
cd comfyui-batch-studio
npm install
```

開発モードで起動します。

```bash
npm run dev
```

`npm run dev` は Renderer の Vite dev server、Electron Main Process の TypeScript watch、Electron 本体をまとめて起動します。

### Windows で最新リリースへ更新

アプリを終了して `update.bat` を実行してください。Git と Windows PowerShell を使用し、GitHub の最新正式リリース（Draft / Pre-release を除外）のタグを公式リポジトリから取得して、そのコミットへ切り替えます。更新後は `run.bat` を実行して依存関係の更新・ビルド・起動を行ってください。

更新後はタグのコミットを直接参照する detached HEAD になります。以降も `update.bat` で最新リリースへ更新できます。未コミットの追跡ファイルの変更がある場合や、未追跡ファイルが切り替え先と衝突する場合は停止します。変更は事前に commit または stash してください。リリース情報・タグの取得に失敗した場合は更新せず、エラーを表示します。

## 環境変数

環境変数は **Electron を起動する前**に設定してください。

現行実装は `.env` を自動読込しません。PowerShell の `$env:...`、bash の `export ...`、または OS / 起動環境側の環境変数として設定してください。

### Batch Studio app-wide settings

環境設定から保存した値はapp dataへ永続化され、対応するruntime環境変数へ反映されます。

| 変数 | 用途 |
| --- | --- |
| `BATCH_STUDIO_PROJECT_ROOT` | 新規Project作成先の既定root |
| `BATCH_STUDIO_ARTIFACT_ROOT` | 生成成果物の親root。Project作成時に `<root>/<project.id>` を作成 |
| `BATCH_STUDIO_CATALOG_PATH` | 外部 `model_catalog.json` 互換用 |
| `BATCH_STUDIO_R2_BUCKET` | 既定モデルbucket |
| `BATCH_STUDIO_R2_MODEL_PREFIX` | R2上のmodel prefix |
| `BATCH_STUDIO_R2_INDEX_PATH` | Legacy R2 index互換用 |
| `BATCH_STUDIO_TEMPLATE_PATH` | Workflow Template上書き |
| `BATCH_STUDIO_MANIFEST_PATH` | Workflow Manifest上書き |

`Project root` / `成果物配置 root` は絶対pathかつ既存directoryのみ保存できます。

### Civitai

| 変数 | 必須 | 既定値 | 用途 |
| --- | --- | --- | --- |
| `CIVIT_API_KEY` | カタログ同期時は必須 | なし | Civitai API / Collection 同期 |
| `CIVITAI_BASE_URL` | 任意 | `https://civitai.com` | Civitai 通常 endpoint の上書き |
| `CIVITAI_MATURE_BASE_URL` | 任意 | `https://civitai.red` | Collection item 取得用 mature endpoint の上書き |
| `CIVITAI_TIMEOUT` | 任意 | `20` | Civitai request timeout。単位は秒 |
| `CIVITAI_PROMPT_EXAMPLES_CACHE_TTL_SECONDS` | 任意 | `604800` | LoRA作例のPositive / Negativeプロンプトキャッシュ有効期限（秒） |

通常利用では `CIVIT_API_KEY` のみ設定すれば十分です。

PowerShell:

```powershell
$env:CIVIT_API_KEY = "your-civitai-api-key"
npm run dev
```

bash:

```bash
export CIVIT_API_KEY="your-civitai-api-key"
npm run dev
```

Civitai API Key は Electron Main Process 内でのみ利用され、Project artifact や AI agent workspace へ渡しません。

保存済み `model_catalog.json` が存在する場合、API Key が未設定でも既存カタログの閲覧は可能ですが、新規 SYNC はできません。

### Cloudflare R2

R2 はアプリ内の接続設定画面から入力することも、以下の環境変数から初期値を渡すこともできます。

| 変数 | 必須 | 用途 |
| --- | --- | --- |
| `R2_ACCOUNT_ID` | R2 利用時 | Cloudflare Account ID。32文字の16進数 |
| `R2_ACCESS_KEY` | R2 利用時 | R2 Access Key ID |
| `R2_SECRET_ACCESS_KEY` | R2 利用時 | R2 Secret Access Key |
| `R2_PUBLIC_URL` | 任意 | Public bucket / custom domain のベース URL |
| `CLOUDFLARE_API_TOKEN` | 任意 | R2 storage metrics 取得 |

PowerShell:

```powershell
$env:R2_ACCOUNT_ID = "0123456789abcdef0123456789abcdef"
$env:R2_ACCESS_KEY = "your-access-key-id"
$env:R2_SECRET_ACCESS_KEY = "your-secret-access-key"

# Optional
$env:R2_PUBLIC_URL = "https://files.example.com"
$env:CLOUDFLARE_API_TOKEN = "your-cloudflare-api-token"

npm run dev
```

bash:

```bash
export R2_ACCOUNT_ID="0123456789abcdef0123456789abcdef"
export R2_ACCESS_KEY="your-access-key-id"
export R2_SECRET_ACCESS_KEY="your-secret-access-key"

# Optional
export R2_PUBLIC_URL="https://files.example.com"
export CLOUDFLARE_API_TOKEN="your-cloudflare-api-token"

npm run dev
```

アプリ内で R2 接続情報を保存した場合、Secret Access Key と Cloudflare API Token は Electron `safeStorage` で暗号化されます。安全な暗号化ストレージが利用できない環境では、平文へ fallback 保存しません。

> [!NOTE]
> `VITE_DEV_SERVER_URL` は `npm run dev` が内部的に設定する開発用変数です。通常は手動設定不要です。

## 基本的な使い方

現在のProject UIは次の工程で構成されています。Civit Explorer、R2 File Manager、vast.ai はapp-wide toolで、独立したProject工程ではありません。

```text
1. Project Brief / 基本設定
   ↓
2. Story / ストーリー
   ↓
3. Model Selection / モデル選定
   ↓
4. Prompt Planning / プロンプト設計
   ↓
5. Workflow Compile / ワークフロー
   ↓
6. Model Availability / モデル配置
   ↓
7. Preflight / 実行前チェック
   ↓
8. Execution / 実行
   ↓
9. Final Artifacts / 最終成果物
   ↓
10. Caption / キャプション
   ↓
11. Thumbnail / サムネイル
   ↓
12. Marketplace Images / 販売サイト用画像

Civit Explorer / R2 File Manager / Vast.ai は app-wide service tool
```

アプリ上の主なナビゲーションは次の構成です。

```text
概要
基本設定
ストーリー
モデル選定
プロンプト設計
ワークフロー
モデル配置
実行前チェック
実行
最終成果物
キャプション
サムネイル
販売サイト用画像
```

### 1. Project Brief を作成する

アプリ起動後、新規プロジェクトを作成します。

主な入力項目:

- プロジェクト名
- Project ID
- 対象キャラクター / 作品
- 作品に求める体験・方向性
- 大まかな要望
- 除外したい方向性
- 目標画像枚数
- 想定モデル系

Project ID は filesystem 上の安定した識別子として利用されます。

プロジェクト作成時は、選択した作成先フォルダーの下に Project ID のフォルダーが作成されます。

```text
<project-destination-folder>/
└─ <project.id>/
   ├─ project_brief.json
   ├─ project_meta.json
   └─ ._batch_studio/
```

### 2. Story を AI agent と作成する

「ストーリー」工程では、右側の共通 AssistantPane で Grok CLI / Codex CLI のどちらかを選んで会話します。工程成果物の生成・修正・再実行は右Paneではなく左側の工程UIから開始します。

基本操作は次の流れです。

1. 工程上部で使用する AI provider（Grok / Codex）を選択する
2. 必要に応じて AssistantPane で model / reasoning strength を選択する
3. 左側の「ストーリー」工程から初回検討taskを開始する
4. AssistantPane で会話しながら Story 方針を調整する
5. 左側の工程から `story.md` 生成taskを開始する
6. CLIの隔離workspaceへ生成された `story.md` を Batch Studio が Draft として取り込む
7. validation結果と内容を確認し、ユーザーが明示的に確定する

Batch Studio は外部AIのWebページを埋め込まず、Clipboard経由の手動prompt transportや回答scrapingも使用しません。CLI session / streaming / stop / history は共通Agent Runtimeで管理します。

### 3. Civitai Catalog を同期・確認する

Civit Explorer はProject工程ではなくapp-wide toolです。Homeのサービス連携/連携済みサービス、`Window > Civit Explorer`、またはモデル選定画面のSYNC導線から同じCatalogを利用します。

事前に `CIVIT_API_KEY` を設定した状態でアプリを起動してください。

同期すると、Electron application data 配下に app-wide の `model_catalog.json` が作成・更新されます。

カタログでは次を確認できます。

- Public / Private Model Collection
- Model / Version / File / Base Model
- thumbnail
- trained words
- LoRA の observed-use `strengthBaseline`
- LoRA各バージョンの作例画像に公開されたPositive / Negativeプロンプトと画像ID・投稿ID・LoRA強度・使用CheckpointバージョンID（`versions[].generationExamples[]`）
- Collection / Model / Version 選択テンプレート
- Model / Base Model / File / trigger wordによる Collection 横断検索
- API request / cache hit-miss / retry / 429 / 5xx / membership等のSYNC metrics

LoRA / LoCon / DoRA の各バージョンに対し、同期時に取得する最新最大200件の画像メタデータから公開済みプロンプトを収集します。追加の画像バイナリダウンロードや、プロンプト収集専用のAPI呼び出しは行いません。元画像を辿れる画像IDを保持し、Positive / Negativeのいずれかが欠けている場合はその値を `null` にします。両方欠落した作例は保存しません。テキストを勝手に補完・タグ化せず、元の書式を保持します。Civitaiに公開されていないプロンプトやComfyUIのグラフのみを含むメタデータからの復元は行いません。

データはapp-wideの `model_catalog.json` にある各 `versions[].generationExamples[]` と同期キャッシュに保存されます。従来の同期キャッシュからアップグレードした場合は、既存の強度キャッシュが有効でも初回SYNCで作例メタデータを取り直します。以降は7日間のキャッシュを利用します。将来的にAIへ渡す際は作例プロンプトを**外部提供された参照データ**として扱い、内部指示として実行せず、送信対象をユーザーが確認できる設計にしてください。

Grokが必要なLoRAをCatalog内で見つけられない場合は、外部Civitai候補、複数LoRA組合せ、Prompt代替を順に検討します。Catalog外候補が必要な場合だけCollectionへ追加して再SYNCします。

### 4. 使用モデルを選定する

「モデル選定」工程では、まずユーザーがModel Familyと基盤モデルを選択します。IllustriousはCheckpoint、AnimaはDiffusion Model / Text Encoder / VAEが必須です。その後Grokは選択済み基盤モデルを変更せずLoRAだけを選定します。

Grokからは `model_loras.json` を受け取り、Batch Studioが基盤モデルへ `loras[]` をmergeして `models.json` Draftを構築します。以下を検証してから確定します。

- Model ID
- Version ID
- File ID / File name
- Catalog generation
- 不足モデル (`missingRequirements`) の有無
- Grokが基盤モデルfieldを上書きしていないこと
- Prompt代替 (`promptFallbacks`) の形式

未解決 `missingRequirements` がある場合は確定できません。`promptFallbacks` で解決した要件は確定 `models.json` ではなく内部補助Artifactへ分離保存されます。

### 5. Prompt Plan を作成する

「プロンプト設計」工程では、確定済み `story.md` と `models.json` を Grok に渡し、意味構造としての Prompt Plan を作成します。

Prompt Plan は主に次を持ちます。

```text
common prompt
root LoRAs
branches[]
  branch LoRAs
  leaves[]
    positive
    negative
```

Grok に ComfyUI Workflow JSON 自体は生成させません。

受け取った `prompt_plan.json` は Batch Studio で schema / model refs / branch-leaf 整合性を検証し、ツリー形式で確認・編集してから確定します。

v1 では **1 leaf = 1 image** です。実際の生成予定枚数は、確定済み `prompt_plan.json` の leaf 総数になります。

### 6. ComfyUI Workflow を生成する

「ワークフロー」工程で Workflow Compiler を実行します。

既定では以下を利用します。

```text
templates/default-scene-batch/template.json
templates/default-scene-batch/manifest.json
```

必要な場合のみ Project Settings の `templatePath` / `manifestPath` で上書きできます。

Compiler は次を入力に、Workflow を決定論的に生成します。

```text
Workflow Template
+ Template Manifest
+ models.json
+ prompt_plan.json
```

生成ファイル名は Project 実フォルダーの親、つまり **ユーザーが指定した Project 作成先フォルダー名**を使用します。

例:

```text
Project 作成先:
D:\Tools\ComfyUI\Project\15_example

Project 実フォルダー:
D:\Tools\ComfyUI\Project\15_example\project-abc123

生成 Workflow:
D:\Tools\ComfyUI\Project\15_example\project-abc123\LoRA_15_example.json
```

### 7. Local / R2 のモデル配置を確認する

「基本設定」で `comfyModelsRoot` に Local ComfyUI の models root を指定します。

例:

```text
D:\Tools\ComfyUI\models
```

Model Availability は、このディレクトリ以下を再帰的に検索して `models.json` に記録された Checkpoint / LoRA のファイル名を確認します。

R2 を利用する場合は Project Settings に以下も指定します。

```text
r2Bucket
r2ModelPrefix
```

判定は次のとおりです。

| executionTarget | Local | R2 | 判定 |
| --- | --- | --- | --- |
| local | あり | 任意 | `available` |
| local | なし | 任意 | `BLOCKED` |
| remote | 任意 | あり | `available` |
| remote | 任意 | なし | `BLOCKED` |

Projectの「モデル配置」工程ではR2をread-onlyで参照します。upload / move / delete / multipart transfer / batch DL / 一時PUT URL等の管理操作はStandalone R2 File Managerから行います。

### 8. Preflight を実行する

最後に「実行前チェック」で Preflight を実行します。

最低限、次が揃っている必要があります。

- `story.md` が Confirmed
- `models.json` が Confirmed かつ current catalog と整合
- `prompt_plan.json` が Confirmed
- Workflow が生成済みで provenance が stale でない
- Workflow 参照モデルと `models.json` が一致
- `executionTarget` に応じた必須モデル配置条件を満たす
- Remote時はVast.ai provider / instance、API Key、SSH private key path等の現在実装済みGateを満たす
- Blocking error がない

すべてのPreflight Gateを通過すると `READY` になります。これは開始条件の判定であり、実行先への実接続、モデルの転送、生成成功や回収の完了を保証しません。実行時の失敗は「実行」工程のRun状態・エラーを確認してください。

### 9. Local / Remote で生成する

「実行」工程で実行先を確認してRunを開始します。Localは起動中のComfyUI APIにWorkflowを投入し、Run単位の画像と生成進捗を監視します。RemoteはVast.aiの選択Instanceを利用し、SSH接続・ComfyUI環境準備・R2から必要モデルの配置を行った後、Remote Workerで連続生成します。生成結果はZIPにまとめ、R2を経由してLocalへダウンロードし、サイズとSHA-256を確認します。

停止・再開・Run破棄と新規実行の操作は「実行」工程で行います。再開はRun状態と残存成果物の条件に依存し、失敗済みRunの再開を無条件には保証しません。**Remote Runが正常完了した場合は、開始前から稼働していたものを含めVast.ai Instanceを停止**します。Instance停止確認に失敗した場合はRunのエラーを確認し、停止のみの再試行を行ってください。Vast.ai側でも停止状態を確認してください。

Remote回収済みファイルは、成果物配置root（未設定の場合はProject root）を基点に以下のように配置します。ZIP内にはmanifestを含めません。

```text
<artifact-output-root>/remote_output/<runId>/
├─ <yyyymmdd_hhmmss>.zip  # JSTの日時
└─ manifest.json
```

詳細な実行・復旧仕様は [Local / Remote Execution Architecture](docs/architecture/remote-execution.md) を参照してください。

### 10. 最終成果物を指定する

生成画像を選定・必要に応じて編集した後、「最終成果物」工程で実際に配布する画像のディレクトリを指定します。後工程は原則この指定ディレクトリを参照します。ここでの画像枚数は指定先に存在する対象画像から数えます。

### 11. キャプションを作成する

「キャプション」工程で最終成果物に基づくタイトル・説明文のJSONを作成・確定し、Batch Studioが画像枚数や定型の注意書きを合成してProject直下に `caption.txt` を生成します。生成後に入力・二次創作フラグ・実ファイルが変わった場合は再生成が必要です。

### 12. サムネイルと販売サイト用画像を作成する

「サムネイル」工程でプレビューを見ながら画像・テキスト等を編集します。続く「販売サイト用画像」工程では、サムネイル用画像とは別に元画像とクロップ位置を選び、FANZA / DLsite向けの画像を個別に生成してZIPへまとめます。元画像・設定を変更したら販売サイト用画像を再生成してからZIPを作成してください。

## Project Settings

主要な Project Settings は次のとおりです。

| 設定 | 用途 |
| --- | --- |
| `catalogPath` | 使用する `model_catalog.json`。新規 Project は統合 Catalog へ自動関連付け |
| `comfyModelsRoot` | Local ComfyUI models root |
| `templatePath` | Workflow Template の任意上書き |
| `manifestPath` | Workflow Manifest の任意上書き |
| `r2Bucket` | Model Availability で参照する R2 bucket |
| `r2ModelPrefix` | R2 bucket 内のモデル prefix |
| `r2IndexPath` | Legacy compatibility 用の R2 index |
| `r2FileManagerUrl` | Legacy compatibility 用 |

通常の新規フローでは `r2IndexPath` / `r2FileManagerUrl` は使用しません。

## Project artifact

標準的な Project filesystem は次のようになります。

```text
<project.id>/
├─ project_brief.json
├─ project_meta.json
├─ story.md
├─ models.json
├─ prompt_plan.json
├─ LoRA_<project-destination-folder>.json
├─ LoRA_<project-destination-folder>.api.json
├─ execution_runs/
├─ caption.txt                 # キャプション生成後
├─ marketplace/                # 販売サイト用画像の生成後
└─ ._batch_studio/
   ├─ drafts/
   └─ history/
```

`model_catalog.json` は Project ごとにはコピーせず、app-wide のデータとして管理します。実行先と成果物配置rootによって、生成画像・回収ZIPはProject root以外に保存されることがあります。「最終成果物」工程で指定したディレクトリは、生成元やRemote回収先と同一である必要はありません。

## Build / Test

TypeScript type check:

```bash
npm run typecheck
```

Regression tests:

```bash
npm test
```

Production build:

```bash
npm run build
```

Build 済みアプリを起動:

```bash
npm start
```

`npm start` は build を実行しないため、初回または source 更新後は先に `npm run build` を実行してください。

## Troubleshooting

### Civitai SYNC で `CIVIT_API_KEY` 未設定と表示される

環境変数は Electron 起動時に読み込まれます。一度アプリを終了し、同じ shell で `CIVIT_API_KEY` を設定してから `npm run dev` または `npm start` を実行してください。

### Civitai が 401 / 403 を返す

API Key が無効、または必要な Collection 読み取り権限がない可能性があります。

### Civitai が 429 を返す

Batch Studio は rate limit を検知し、`Retry-After` を考慮して待機・再試行します。同期中の phase / message を確認してください。

### R2 の Account ID が拒否される

`R2_ACCOUNT_ID` / 接続設定の Account ID は 32 文字の16進数である必要があります。

### Workflow Compile で Template / Manifest が見つからない

既定の `templates/default-scene-batch/` が存在することを確認してください。Project Settings で `templatePath` / `manifestPath` を上書きしている場合は、そのパスも確認してください。

### `Template SHA-256 mismatch` が出る

Template と Manifest が対応していません。Manifest が参照する Template SHA-256 と実ファイルが一致する組み合わせを利用してください。

### Preflight が R2 上のモデルを `BLOCKED` にする

`executionTarget=local` ではLocal配置が必須です。`executionTarget=remote` ではR2配置が必須で、Local配置は任意です。Projectの「モデル配置」で現在のtargetと不足先を確認してください。

## Security / Responsibility Boundary

- 選択中の AI agent（Grok CLI / Codex CLI）は Story / LoRA選定 / Prompt Plan / Caption の意味設計を担当します。Model Familyと基盤モデルはユーザーが選択します。
- Batch Studio は Project 状態、CLI session、validation、Workflow compile、Local / Remote Execution、Civitai / R2 integrationと後工程を担当します。
- Grok / Codex の認証は各CLI側で行い、Batch StudioはproviderのWeb login sessionやCookieを所有しません。
- Civitai API Key は Project artifact や AI agent workspaceへ渡しません。
- R2 Secret / Cloudflare API Token は Electron Main Process でのみ利用します。
- 保存済み R2 Secret は `safeStorage` で暗号化します。
- 確定済み Artifact を暗黙上書きせず、編集は Draft から開始し履歴を残します。
- AI agent に ComfyUI Workflow JSON を生成させません。
- ComfyUI Queue投入、生成進捗・停止・再開、R2経由のRemote成果物回収は実装されています。成功を保証するものではなく、実行時のエラーとRun履歴を確認してください。

## Documentation

詳細仕様は `docs/README.md` を起点に参照してください。

特に以下が主要な正本です。

- `docs/product/scope-and-flow.md` — 製品 scope と end-to-end flow
- `docs/ui/project-initialization.md` — Project Brief / 初期作成
- `docs/contracts/grok-contract.md` — Grok 連携契約
- `docs/contracts/prompt-plan.md` — Prompt Plan 構造
- `docs/architecture/workflow-compiler.md` — Workflow Compiler
- `docs/integrations/external-tools.md` — Civitai / R2 / ComfyUI integration
- `docs/quality/validation-and-security.md` — Validation / Security / Preflight
- `docs/architecture/remote-execution.md` — Local / Remote Execution、Remote Worker、R2成果物回収とRun復旧
- `docs/integrations/service-integrations.md` — Vast.ai・接続設定・Instance管理
- `docs/contracts/project-artifacts.md` — 最終成果物を含むProjectファイルと正本関係
