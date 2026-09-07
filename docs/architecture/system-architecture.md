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
│  │ Project / Story / Models / Prompt Plan / Workflow /     │          │
│  │ R2 / Preflight                                           │          │
│  └──────────────────────────────────────────────────────────┘          │
│                                                                      │
│  ┌──────────────────── Grok WebContentsView ────────────────┐          │
│  │ https://grok.com/                                        │          │
│  │ User-operated login / paste / attach / send / chat       │          │
│  └──────────────────────────────────────────────────────────┘          │
└──────────────────────────────────────────────────────────────────────┘
```

初期レイアウトは左右分割を基本とし、境界のリサイズとローカル側最大化を許容する。

## 2. Main Process Services

実装時のサービス境界は次を基準とする。

### 2.1 Project Service

- Project root の走査。
- 新規プロジェクト作成。
- `project_meta.json` / `project_brief.json` の読み書き。
- 既存プロジェクトとの互換読込。
- 下書き・履歴・確定保存。

### 2.2 Artifact Service

- `story.md`、`models.json`、`prompt_plan.json`、Workflow の読み書き。
- Artifact status 管理。
- 差分表示用データ生成。
- Artifact hash / update detection の将来拡張点。

### 2.3 Grok Context Builder

- 工程別プロンプトの組み立て。
- 添付候補ファイルの列挙。
- 秘密情報の除外。
- Clipboard 用文字列生成。

Grok DOM への書込や回答取得は行わない。

### 2.4 Model Catalog Adapter

- `civit-model-viewer` の `model_catalog.json` を読取。
- schemaVersion / generation / generatedAt の取得。
- Model / Version / File の lookup index 構築。
- `models.json` の参照検証。

Civitai との HTTP 通信や API key 管理は担当しない。

### 2.5 Workflow Compiler

- Workflow Template / Manifest 読込。
- Prompt Plan と models の解決。
- Branch Prototype の必要数複製。
- Node / Link / Group の再構成。
- 可変ノードの設定。
- 最終 Workflow の構造検証。

詳細は `workflow-compiler.md` を正本とする。

### 2.6 Validation / Preflight Service

- Artifact 単体検証。
- Artifact 間参照検証。
- Workflow 構造検証。
- model availability の集約。
- READY / BLOCKED の判定。

### 2.7 External Tool Adapter

初期段階では疎結合な起動・引き渡しだけを担当する。

- R2 File Manager を開く。
- 対象 object key / file name を Clipboard へ渡す。
- 将来の API 統合用境界を提供する。

## 3. Renderer の責務

Renderer はユーザー操作と表示を担当し、ファイルシステムや Node.js API を直接公開しない。

主要画面:

- Project list / Overview
- Project initialization
- Story
- Models
- Prompt Plan
- Workflow compile result
- R2 / Model availability
- Preflight

Renderer から Main process へは preload で許可した最小限の IPC だけを公開する。

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

### 4.3 Navigation

Grok ログインに必要な正規認証先は許可し、それ以外の外部遷移・新規ウィンドウは allowlist または既定ブラウザへの引き渡しを基本とする。

## 5. データフロー

```text
User Brief
   |
   v
Project Service
   |
   +--> Grok Context Builder --> Clipboard --> User --> Grok Web
                                                   |
                                                   v
                                              story.md text
                                                   |
                                                   v
Artifact Service <---------------------------------+
   |
   +--> Model Catalog Adapter ---- model_catalog.json
   |          ^
   |          |
   |     models.json from Grok
   |
   +--> prompt_plan.json from Grok
   |
   +--> Workflow Compiler <---- Template + Manifest
   |          |
   |          v
   |      Workflow JSON
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

## 7. 既存プロジェクト互換

既存プロジェクトには Batch Studio 固有 metadata が存在しない可能性がある。

- `project_meta.json` は既存プロジェクト読込時に必須としない。
- 旧 Workflow ファイル名を検出できる互換層を持つ。
- 新しい Artifact を追加しても、既存の `story.md` や Workflow を無断変換・上書きしない。

互換対象の具体的なファイル名と migration policy は `contracts/project-artifacts.md` で管理する。
