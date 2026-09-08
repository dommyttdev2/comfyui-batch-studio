# System Architecture

Status: Active

## 1. 実行形態

ComfyUI Batch Studio は Electron デスクトップアプリとする。

Grok Web は通常の iframe としてローカル UI に埋め込まず、Electron の外部 Web 用 `WebContentsView` として表示する。

```text
┌──────────────────────── ComfyUI Batch Studio ────────────────────────┐
│ Electron Main                                                        │
│                                                                      │
│  ┌──────────────────── Local Renderer ─────────────────────┐          │
│  │ Project / Story / Catalog / Models / Prompt Plan /      │          │
│  │ Workflow / Model Availability + R2 / Preflight          │          │
│  └──────────────────────────────────────────────────────────┘          │
│                                                                      │
│  ┌──────────────────── Grok WebContentsView ────────────────┐          │
│  │ https://grok.com/                                        │          │
│  │ User-operated login / paste / attach / send / chat       │          │
│  └──────────────────────────────────────────────────────────┘          │
└──────────────────────────────────────────────────────────────────────┘
```

Grokが必要な工程では左右分割を基本とし、境界dividerをマウスでresize可能とする。Grok不要工程ではLocal UIを全幅で使用する。

## 2. Main Process Services

実装時のサービス境界は次を基準とする。

### 2.1 Project Service

- Project root の走査。
- 新規プロジェクト作成。
- `project_meta.json` / `project_brief.json` の読み書き。
- 既存プロジェクトとの互換読込。
- 下書き・履歴・確定保存。
- 最後に開いたProject pathのapp-wide UI state保存・起動時復元。

### 2.2 Artifact Service

- `story.md`、`models.json`、`prompt_plan.json`、Workflow の読み書き。
- Artifact status 管理。
- 差分表示用データ生成。
- Artifact hash / dependency stale detection。

### 2.3 Grok Context Builder / Grok Session State

- 工程別プロンプトの組み立て。
- 添付候補ファイルの列挙。
- 秘密情報の除外。
- Clipboard 用文字列生成。
- Project × Grok工程ごとの最後のconversation URL保存・復元。

Grok DOM への書込や回答取得は行わない。

### 2.4 Integrated Civitai Catalog Service

- Civitai Public / Private Model Collection同期。
- Civitai API / internal tRPC通信。
- API keyのMain Process内利用。
- Model / Version / File / thumbnail / trained words取得。
- observed LoRA strength evidence集計。
- app-wide `model_catalog.json` のgeneration管理・永続化。
- Collection / Model / Version selection template保存。
- `models.json` のModel / Version / File identity検証。
- 429 rate limitのwait / retry / resume。

Civitai API keyをRenderer/Grok/Project fileへ渡さない。

### 2.5 Workflow Compiler

- Workflow Template / Manifest 読込。
- Prompt Plan と models の解決。
- Branch Prototype の必要数複製。
- Node / Link / Group の再構成。
- 可変ノードの設定。
- 最終 Workflow の構造検証。

詳細は `workflow-compiler.md` を正本とする。

### 2.6 Integrated R2 Manager

- Cloudflare R2 S3-compatible API通信。
- R2 credential / Cloudflare API TokenのMain Process内利用。
- `safeStorage`によるSecret暗号化保存。暗号化不能時の平文fallback禁止。
- Bucket list / create / empty-bucket delete。
- Object list / folder navigation / paging / search。
- Public / presigned URL生成。
- URL / curl / wget / aria2c command生成。
- Object move / rename / delete。
- Main Process streaming multipart upload。
- Upload pause / resume / cancel / persisted unfinished state。
- Batch download selection template保存。
- optional R2 account metrics。
- Model Availability / Preflight用R2 lookup。

旧 `r2-file-manager` のlocalhost serverは新規フローでは起動しない。

### 2.7 Validation / Preflight Service

- Artifact 単体検証。
- Artifact 間参照検証。
- Workflow 構造検証。
- Local / integrated R2 model availability の集約。
- READY / BLOCKED の判定。

R2-only modelは`transfer-required`としてBlockingにする。

## 3. Renderer の責務

Renderer はユーザー操作と表示を担当し、ファイルシステムや Node.js API を直接公開しない。

主要画面:

- Project / Overview
- Project initialization / Settings
- Story
- Model Catalog
- Models
- Prompt Plan
- Workflow compile result
- Model Availability / R2 file management
- Preflight

Renderer から Main process へは preload で許可した最小限の IPC だけを公開する。

R2 Secret本体やCivitai API keyをRendererへ返さない。R2設定画面は保存済みSecretについてconfigured boolのみ受け取る。

## 4. Grok Web の信頼境界

Grok WebContents は Local Renderer とは別の信頼領域とする。

### 4.1 必須設定

- `nodeIntegration: false`
- Grok 用 preload なし。
- Local IPC を Grok へ公開しない。
- Local file system API を公開しない。
- Local Renderer の DOM と混在させない。

### 4.2 Session

Grok ログイン session はアプリ専用の永続 partition に保存可能とするが、次へ複製しない。

- Project files
- `project_meta.json`
- Application log
- `model_catalog.json`
- R2 configuration

Project × Grok工程の復帰用conversation URLはapp-wide stateに保存してよいが、conversation本文やCookieをProjectへ保存しない。

### 4.3 Navigation

Grokログインに必要なOAuth popupはGrokと同じpersistent partitionを使用する。認証flow内のsecure redirect chainは同じElectron sessionに保持し、通常の非Grok外部navigationは既定ブラウザへ引き渡す。

## 5. データフロー

```text
User Brief
   |
   v
Project Service
   |
   +--> Grok Context Builder --> Clipboard --> User --> Grok Web
   |                                               |
   |                                               v
   |                                          story/models/plan text
   |                                               |
   +<---------------- Artifact Service <-----------+
   |
   +--> Civitai Catalog Service --> app-wide model_catalog.json
   |             |
   |             +--> models identity validation
   |
   +--> Workflow Compiler <---- Template + Manifest
   |          |
   |          v
   |      Workflow JSON
   |
   +--> R2 Manager <---- Cloudflare R2
   |       |
   |       +--> model existence / upload / file operations
   |
   +--> Validation / Preflight
              |
              v
          READY/BLOCKED
```

## 6. ファイル書込原則

- Grok 会話そのものを正本にしない。
- 受け取った成果物はまず Draft とする。
- 検証結果を表示する。
- ユーザーの明示操作で確定する。
- 既存確定ファイルを更新する前に履歴へ退避する。
- Civitai/R2のapp-wide stateやcredentialをProject artifactへコピーしない。

## 7. App-wide data

Electron `app.getPath('userData')` 配下にProject外の状態を保持する。

例:

```text
userData/
  ui-state.json
  grok-chat-state.json
  civitai/
    model_catalog.json
    selection_templates.json
  r2/
    config.json
    uploads.json
    batch-download-templates.json
```

`r2/config.json` にSecret平文を保存しない。暗号化blobだけを保持する。

## 8. 既存プロジェクト互換

既存プロジェクトには Batch Studio 固有 metadata が存在しない可能性がある。

- `project_meta.json` は既存プロジェクト読込時に必須としない。
- 旧 Workflow ファイル名を検出できる互換層を持つ。
- 新しい Artifact を追加しても、既存の `story.md` や Workflow を無断変換・上書きしない。
- 明示的な外部`catalogPath`は互換用に維持する。
- `r2IndexPath`は統合R2未設定の既存Project向け互換fallbackとして維持できる。

互換対象の具体的なファイル名と migration policy は `contracts/project-artifacts.md` で管理する。
