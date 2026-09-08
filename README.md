# ComfyUI Batch Studio

ComfyUI Batch Studio は、ComfyUI を使った大量画像生成プロジェクトについて、**企画入力から Story、モデル選定、Prompt Plan、ComfyUI Workflow 生成、モデル所在確認、Cloudflare R2 管理、実行前 Preflight まで**を一つの Electron デスクトップアプリで管理するためのツールです。

意味的・創作的な判断は Grok、状態管理・検証・機械変換・保存は Batch Studio、最終決定はユーザー、という責務分担を採用しています。

> [!IMPORTANT]
> v1 の責務終端は **Preflight が `READY` になるところまで**です。ComfyUI Queue への投入、生成進捗、キャンセル、生成画像の回収は現在の v1 scope には含まれません。

## 主な機能

- Project Brief からのプロジェクト作成
- Grok Web をアプリ内に表示した Story 作成支援
- Civitai Model Collection の同期と統合 `model_catalog.json` 管理
- Grok による Checkpoint / LoRA / Version / File 選定支援
- `models.json` / `prompt_plan.json` の検証・Draft・確定・履歴管理
- Prompt Plan のツリー形式レビュー・編集
- Template + Manifest からの決定論的 ComfyUI Workflow 生成
- Local / Cloudflare R2 のモデル所在確認
- Cloudflare R2 の bucket / object / upload / download / move / delete 管理
- 実行前 Preflight (`READY` / `BLOCKED`)

旧 `civit-model-viewer` と `r2-file-manager` の主要機能は Batch Studio に統合済みです。新規フローでは、それらを別サーバーとして起動する必要はありません。

## 必要環境

### 必須

- Node.js `^20.19.0` または `>=22.12.0`
- npm
- デスクトップ GUI を利用できる環境

### 利用する工程に応じて必要

- **Grok Web アカウント**: Story / モデル選定 / Prompt Plan の作成時
- **Civitai API Key**: 統合モデルカタログを新規同期するとき
- **Cloudflare R2 credentials**: R2 機能を利用するとき
- **Local ComfyUI models directory**: Model Availability / Preflight で実モデル配置を確認するとき

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

## 環境変数

環境変数は **Electron を起動する前**に設定してください。

現行実装は `.env` を自動読込しません。PowerShell の `$env:...`、bash の `export ...`、または OS / 起動環境側の環境変数として設定してください。

### Civitai

| 変数 | 必須 | 既定値 | 用途 |
| --- | --- | --- | --- |
| `CIVIT_API_KEY` | カタログ同期時は必須 | なし | Civitai API / Collection 同期 |
| `CIVITAI_BASE_URL` | 任意 | `https://civitai.com` | Civitai 通常 endpoint の上書き |
| `CIVITAI_MATURE_BASE_URL` | 任意 | `https://civitai.red` | Collection item 取得用 mature endpoint の上書き |
| `CIVITAI_TIMEOUT` | 任意 | `20` | Civitai request timeout。単位は秒 |

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

Civitai API Key は Electron Main Process 内でのみ利用され、Project artifact や Grok Web へ渡しません。

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

Batch Studio の標準フローは次の8工程です。

```text
1. Project Brief
   ↓
2. Story
   ↓
3. Model Catalog
   ↓
4. Model Selection
   ↓
5. Prompt Planning
   ↓
6. Workflow Compile
   ↓
7. Model Availability / R2
   ↓
8. Preflight
```

アプリ上の主なナビゲーションは次の構成です。

```text
概要
基本設定
ストーリー
モデルカタログ
モデル選定
プロンプト設計
ワークフロー
モデル配置
実行前チェック
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

### 2. Story を Grok と作成する

「ストーリー」工程では Grok pane を利用します。

Batch Studio は Grok を自動操作しません。基本操作は次の流れです。

1. Batch Studio で Grok 用の依頼文と添付候補を準備する
2. ユーザーが Grok Web へログインする
3. 依頼文をコピーし、必要なファイルを手動添付して送信する
4. Grok と会話しながら Story を調整する
5. 完成した `story.md` を Batch Studio へ貼り付ける
6. Draft を検証する
7. 内容を確認して明示的に確定する

Batch Studio は Grok のログイン、入力欄 DOM 操作、自動送信、回答 scraping を行いません。

### 3. Model Catalog を同期する

「モデルカタログ」工程で Civitai Model Collection を同期します。

事前に `CIVIT_API_KEY` を設定した状態でアプリを起動してください。

同期すると、Electron application data 配下に app-wide の `model_catalog.json` が作成・更新されます。

カタログでは次を確認できます。

- Public / Private Model Collection
- Model / Version / File
- thumbnail
- trained words
- LoRA の observed-use `strengthBaseline`
- Collection / Model / Version 選択テンプレート
- モデル名・ファイル名による Collection 横断検索

Grok が必要と判断したモデルがカタログに存在しない場合は、Civitai 側の Collection にモデルを追加してから再度 SYNC します。

### 4. 使用モデルを選定する

「モデル選定」工程では、確定済み `story.md` と現在の `model_catalog.json` を根拠として Grok に Checkpoint / LoRA を選定させます。

Grok から受け取った `models.json` を Batch Studio へ取り込み、以下を検証してから確定します。

- Model ID
- Version ID
- File ID / File name
- Catalog generation
- 不足モデル (`missingRequirements`) の有無

不足モデルがある場合は、Model Catalog に戻って Civitai Collection を更新し、再同期・再選定します。

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

| Local | R2 | 状態 |
| --- | --- | --- |
| あり | 任意 | `available` |
| なし | あり | `transfer-required` / `BLOCKED` |
| なし | なし | `missing` / `BLOCKED` |

**R2 に存在するだけでは `READY` になりません。** ComfyUI 実行前に Local models directory へ転送してください。

「モデル配置」工程には統合 R2 Manager があり、bucket / folder browse、検索、multipart upload、pause / resume / cancel、download URL、`curl` / `wget` / `aria2c`、move / delete、一括ダウンロード情報生成を利用できます。

### 8. Preflight を実行する

最後に「実行前チェック」で Preflight を実行します。

最低限、次が揃っている必要があります。

- `story.md` が Confirmed
- `models.json` が Confirmed かつ current catalog と整合
- `prompt_plan.json` が Confirmed
- Workflow が生成済みで provenance が stale でない
- Workflow 参照モデルと `models.json` が一致
- 必須 Checkpoint / LoRA が Local に存在
- Blocking error がない

すべて通過すると `READY` になります。

その後、生成された Workflow JSON を ComfyUI 側で読み込み、ComfyUI で生成を実行してください。v1 の Batch Studio 自体は Queue API へ送信しません。

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
└─ ._batch_studio/
   ├─ drafts/
   └─ history/
```

`model_catalog.json` は Project ごとにはコピーせず、app-wide のデータとして管理します。

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

仕様どおりです。R2 は保管場所として確認できますが、現在の v1 は ComfyUI 実行時に Local モデルが存在することを要求します。対象ファイルを `comfyModelsRoot` 以下へ配置して再チェックしてください。

## Security / Responsibility Boundary

- Grok は Story / モデル選定 / Prompt Plan の意味設計を担当します。
- Batch Studio は Project 状態、validation、Workflow compile、Civitai / R2 integration を担当します。
- Grok Web のログイン・送信・添付・会話継続はユーザーが操作します。
- Civitai API Key は Project artifact や Grok へ渡しません。
- R2 Secret / Cloudflare API Token は Electron Main Process でのみ利用します。
- 保存済み R2 Secret は `safeStorage` で暗号化します。
- 確定済み Artifact を暗黙上書きせず、編集は Draft から開始し履歴を残します。
- Grok に ComfyUI Workflow JSON を生成させません。
- v1 は Preflight までで、ComfyUI Queue / progress / cancel / output collection は行いません。

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
