# System Architecture

Status: Active

## 1. 実行形態

ComfyUI Batch Studio は Electron デスクトップアプリとする。

Project Window は Local Renderer と provider-neutral な `AssistantPane` の2つの local `WebContentsView` を持つ。Story / Models / Prompt Plan / Caption では必要に応じて左右分割し、それ以外の工程ではLocal UIを全幅で使用する。

```text
┌──────────────────────── ComfyUI Batch Studio ────────────────────────┐
│ Electron Main                                                        │
│                                                                      │
│  ┌──────────────────── Local Renderer ─────────────────────┐          │
│  │ Project / Story / Models / Prompt Plan / Workflow /     │          │
│  │ Availability / Preflight / Execution / post-processing  │          │
│  └──────────────────────────────────────────────────────────┘          │
│                                                                      │
│  ┌──────────────────── AssistantPane ───────────────────────┐          │
│  │ selected provider: Grok CLI / Codex CLI                  │          │
│  │ conversation / history / streaming / activity / model    │          │
│  └──────────────────────────────────────────────────────────┘          │
└──────────────────────────────────────────────────────────────────────┘
```

外部AIのWebページはProject Windowへ埋め込まない。AI通信はMain Processのprovider adapterからCLIを起動し、structured eventsを共通 `AgentEvent` へ正規化する。

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

### 2.3 AI Agent Runtime

AI連携はprovider-neutral runtimeとしてMain Processが所有する。

```text
AssistantPane / Stage UI
        |
        v
Common Assistant IPC
        |
        +--> AgentConversationRunner --> AgentCliAdapter
        |                               +--> Grok CLI
        |                               +--> Codex CLI
        |
        +--> GrokCliTaskRunner / CodexCliTaskRunner
                |
                +--> isolated AgentWorkspace
                +--> Artifact validation/import
```

責務:

- Project × stage × provider の選択状態を `AssistantProviderStore` で保持。
- session IDを `AgentSessionStateStore` で保持。
- UI表示用の安全な会話本文を `AgentConversationStore` で保持。
- model / reasoning設定を `AgentModelSelectionStore` で保持。
- 通常会話のstart / resume / streaming / stopを `AgentConversationRunner` へ集約。
- 工程成果物taskはprovider別CLI task runnerを使い、隔離workspaceへ参照入力と成果物出力を限定。
- provider固有CLI出力を `AgentEvent` へ正規化し、raw reasoning本文はUIへ渡さない。
- Codex model catalogは `codex debug models` を使用し、App Serverへ依存しない。

意味契約とworkspace契約は `../contracts/agent-contract.md` を正本とする。

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
- Execution用API-format graphをdeterministicに生成またはTemplate contractから解決。

詳細は `workflow-compiler.md` を正本とする。Execution用API graphとの境界は `remote-execution.md` も参照する。

### 2.6 Integrated R2 Manager

- Cloudflare R2 S3-compatible API通信。
- R2 credential / Cloudflare API TokenのMain Process内利用。
- `safeStorage`によるSecret暗号化保存。暗号化不能時の平文fallback禁止。
- Bucket list / create / empty-bucket delete。
- Object list / folder navigation / paging / search。
- Public / presigned GET URL生成。
- Execution用presigned PUT URL生成。
- URL / curl / wget / aria2c command生成。
- Object move / rename / delete。
- Main Process streaming multipart upload。
- Main Process streaming download-to-local-file。
- Upload pause / resume / cancel / persisted unfinished state。
- Batch download selection template保存。
- optional R2 account metrics。
- Model Availability / Preflight用R2 lookup。
- Remote model staging / artifact delivery用のsigned URL発行。

旧 `r2-file-manager` のlocalhost serverは新規フローでは起動しない。

### 2.7 Validation / Preflight Service

- Artifact 単体検証。
- Artifact 間参照検証。
- Workflow 構造検証。
- Local / integrated R2 model availability の集約。
- `executionTarget` に応じた operational check。
- READY / BLOCKED の判定。

Local targetでは必須モデルのLocal配置を要求する。Remote targetでは必須モデルのR2配置を要求する。

### 2.8 Execution Service

Local / Remote の生成実行を **Project / Project Window から独立した app-wide Main Process service** として所有する。

Project配下に保持するのは persistent Execution Run の状態・履歴であり、`LocalExecutionService` / `RemoteExecutionService`、active worker、SSH session、runtime resource lock は Project lifecycle に属さない。

```text
ExecutionService
|
+-- LocalExecutionService
|
+-- RemoteExecutionService
    +-- SshService
    +-- RemoteWorkerClient
    +-- RemoteModelStager
    +-- ExecutionCoordinator
    +-- RemoteArtifactService
    +-- R2TransferService
    +-- ExecutionStateStore
```

原則:

- Local targetはLocal ComfyUI APIを使用。
- Remote targetは外部公開されたSSH endpointへ秘密鍵認証。
- SSH Tunnelは使用しない。
- Remote WorkerがRemote host内の `127.0.0.1:<comfy-port>` へComfyUI API requestを送る。
- SSHはcontrol plane、R2はlarge binary transfer plane。
- 画像ごとの連続生成はfrontend button操作ではなくAPI orchestrationで再現。
- Remote RunはR2 upload、Local download、hash verificationまで成功して完了。

Local / Remote の個別実行手順は `remote-execution.md` を正本とする。Project Window / Project / Execution Runtime の ownership と lifecycle は `project-window-execution-runtime.md` を正本とする。

### 2.9 Project Window Manager / Execution Coordinator

Multi Windowでは各Project WindowがLocal Renderer / AssistantPane / window-local UI stateを所有し、Executionを所有しない。

```text
Project Window A ----+
Project Window B ----+--> Main Process
Project Window C ----+      |
                            +-- ProjectWindowManager
                            |     +-- Local Renderer View
                            |     +-- AssistantPane View
                            +-- Agent Runtime
                            +-- ExecutionCoordinator
                                  +-- LocalExecutionService
                                  +-- RemoteExecutionService
                                  +-- ExecutionResourceLockManager
```

`ExecutionCoordinator` はRun start / resume / stop / interrupt、executor選択、active Run追跡、runtime resource lockをApplication-levelで担当する。RemoteのVast.ai起動、SSH、bootstrap、model staging、generation、artifact delivery、finalizationを含むRun lifecycle全体をactive executionとして扱う。

Project Windowを閉じてもExecutionCoordinatorやexecutorをdisposeしない。active Runが存在する場合、最後のProject Windowを閉じてもMain Processを終了しない。

同一Project rootは同時に1 Project Windowのみとし、既に開かれているProjectを再度Openした場合は既存Windowをfocusする。

詳細は `project-window-execution-runtime.md` を正本とする。

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
- Execution

Execution画面ではtarget、phase、connection、model preparation、overall/branch generation progress、artifact package、R2 upload、Local download、verificationを表示し、Start / Stop scheduling / Force interrupt / Resume等の明示操作を提供する。

Renderer から Main process へは preload で許可した最小限の IPC だけを公開する。

R2 Secret本体、SSH秘密鍵本文、Civitai API keyをRendererへ返さない。R2設定画面は保存済みSecretについてconfigured boolのみ受け取る。

## 4. AI Agent の信頼境界

AI provider CLIはLocal Rendererから直接起動しない。Main Processだけが子process、session、workspace、model selectionを扱う。

### 4.1 CLI execution

- RendererへNode.js child process APIを公開しない。
- provider CLIへProject全体のwrite権限を与えない。
- 通常会話は原則read-only、工程成果物taskは隔離workspaceだけwrite可能とする。
- approval policyやnetwork policyはadapterが明示する。
- prompt本文はstdinで渡し、ユーザー入力をshell command文字列へ連結しない。

### 4.2 Workspace

工程taskの参照ファイルは必要なものだけ `input/` へコピーし、成果物は `output/` から検証して取り込む。

- Project本体をagentの書込先にしない。
- symlink / path escapeを拒否する。
- Secret、Cookie、API key、SSH private key、model binaryをworkspaceへ入れない。
- invalid / incomplete / cancelled outputはProject Draftへ反映しない。

### 4.3 Session / history

session IDと安全な会話本文はapp-wide `userData` に保存可能とするが、providerのraw rolloutやraw reasoningをProject Artifactの正本にしない。

## 5. データフロー

```text
User Brief
   |
   v
Project Service
   |
   +--> AI Agent Runtime
   |       |
   |       +--> Grok CLI / Codex CLI
   |       +--> normal conversation -> AssistantPane
   |       +--> stage task -> isolated workspace -> Artifact Service
   |
   +--> Civitai Catalog Service --> app-wide model_catalog.json
   |             |
   |             +--> models identity validation
   |
   +--> Workflow Compiler <---- Template + Manifest
   |          |
   |          +--> UI Workflow JSON
   |          +--> API-format execution graph
   |
   +--> R2 Manager <---- Cloudflare R2
   |       |
   |       +--> model existence / upload / signed GET/PUT
   |
   +--> Validation / Preflight
   |          |
   |          v
   |      READY/BLOCKED
   |          |
   |          v
   +--> Execution Service
              |
              +--> Local ComfyUI
              |
              +--> SSH --> Remote Worker --> Remote localhost ComfyUI
              |                 |
              |                 +--> R2 GET model staging
              |                 +--> R2 PUT artifact upload
              |
              +<-- R2 GET final artifact
              |
              v
          COMPLETED
```

## 6. ファイル書込原則

- AI agent の会話そのものをProject Artifactの正本にしない。
- 受け取った成果物はまず Draft とする。
- 検証結果を表示する。
- ユーザーの明示操作で確定する。
- 既存確定ファイルを更新する前に履歴へ退避する。
- Civitai/R2のapp-wide stateやcredentialをProject artifactへコピーしない。
- SSH private key contentsをProject artifactへコピーしない。
- Execution Run stateへsigned URLやsecretを不要に永続化しない。

## 7. App-wide data

Electron `app.getPath('userData')` 配下にProject外の状態を保持する。

例:

```text
userData/
  ui-state.json
  grok-chat-state.json
  app-settings.json
  civitai/
    model_catalog.json
    selection_templates.json
  r2/
    config.json
    uploads.json
    batch-download-templates.json
```

SSH Host / Port / User / private key path等のRemote接続設定はapp-wide settingsに保持できるが、秘密鍵本文はコピーしない。
