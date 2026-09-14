# Application Shell UI

Status: Active

## 1. 目的

Electron の主画面で、Batch Studio のローカル工程とユーザー操作の Grok Web を同時に扱う UI 構造を定義する。

詳細な工程固有 UI は各契約・UI 文書が所有し、本書はアプリ全体の shell と共通 interaction を所有する。

- Execution / Remote Execution の詳細は `../architecture/remote-execution.md`。
- 外部 credential / Cloud Instance Provider / Vast.ai 管理は `../integrations/service-integrations.md`。
- R2 / Civitai の実体サービス責務は `../integrations/external-tools.md`。

## 2. 主画面

Projectを開いている場合の基本レイアウト:

```text
┌───────────────────────┬──────────────────────────────┐
│ Batch Studio Local UI │ Grok Web                     │
│                       │ user-operated               │
│ Overview              │ grok.com                     │
│ Project               │                              │
│ Story                 │                              │
│ Model Catalog         │                              │
│ Models                │                              │
│ Prompt Plan           │                              │
│ Workflow              │                              │
│ Model Availability    │                              │
│ Preflight             │                              │
│ Execution             │                              │
└───────────────────────┴──────────────────────────────┘
```

Grokが必要な工程では初期比率45:55を目安とし、divider resizeを許可する。Grok不要工程ではLocal UIを全幅で使用する。

Projectを閉じている場合はProject工程navigationを表示せず、HomeとService IntegrationsをLocal UI全幅で利用する。

## 3. Global Navigation

Projectを開いている場合:

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
```

Projectを閉じている場合:

```text
ホーム
サービス連携
```

R2 File Manager / Civit Explorer / Vast.ai管理画面は「サービス連携」のcontextに属する app-wide tool とする。Project未選択時の左navigationには `ホーム` / `サービス連携` を固定表示し、その下に連携済みサービスだけを `連携済みサービス` グループとして条件付き表示する。

`Prompt Tree` の独立navigationは設けない。Prompt構造の人間向け表示・編集はPrompt Planへ統合する。

## 4. Project Lifecycle / Home

起動時は前回明示的に開いていたProjectが有効なら自動復元する。

Projectを開いている間は「プロジェクトを閉じる」を提供する。閉じる操作はProject artifactを削除せず、現在Projectの選択と次回起動時の自動復元記録だけを解除する。

Projectを閉じたHomeでは最低限次を提供する。

- プロジェクトを新規作成。
- プロジェクトを開く。
- 最近使ったプロジェクト。
- サービス連携。
- 左navigation内の連携済みサービス直接導線（1件以上存在する場合のみ）。

初期状態のHomeを外部サービス管理画面の集合にしない。未連携サービスの設定は「サービス連携」を明示的に開いてから操作する。

連携済みサービスはHome中央コンテンツではなく左navigationの「連携済みサービス」グループへ条件付き表示する。未連携サービスは表示しない。

```text
Cloudflare R2 connected
  -> R2 File Manager

Civitai connected
  -> Civit Explorer

Vast.ai connected
  -> Vast.ai Instance管理画面
```

各service statusの取得失敗によってHome全体を利用不能にしない。取得できなかったserviceだけをショートカット対象外とする。

## 5. Service Integrations

Projectに依存しないapp-wide画面。

トップ階層:

```text
Cloudflare R2
Civitai
クラウドインスタンス
```

Cloudflare R2からR2 credential/default model storageを設定し、R2 File Managerを開ける。

CivitaiからAPI Keyを設定し、Civit Explorerを開ける。

クラウドインスタンスを選択するとprovider選択へ進む。初期providerはVast.aiのみ。

Vast.ai画面では次を提供する。

- API Key保存状態。
- `VASTAI_API_KEY` environment利用状態。
- API接続テスト。
- SSH private/public key path選択。
- SSH User。
- Instance一覧・5秒ごとの自動更新。
- Instance start。
- Instance stop / scheduling cancel。
- Instance destroy（Main Process確認dialog必須）。
- Instance reboot。
- GPU / status / cost / current SSH endpoint表示。
- ComfyUI Template互換On-demand Offer検索。
- Storage / GPU計算性能 / GPU数 / Reliability / 除外国等の検索条件。
- Offer検索結果の5秒ごとの更新。
- 利用不能Offerの一時抑止と再検索。
- Offer選択後の確認dialogを経たRENT / Instance作成。

SSH Port / Remote ComfyUI Portは設定へ固定保存せず、選択Instanceのcurrent API responseから実行時に解決する。

詳細は `../integrations/service-integrations.md` を正本とする。

## 6. Environment Settings

環境設定はBatch Studio自身の app-wide runtime / path 設定を扱う。

- Local ComfyUI install path。
- Remote ComfyUI install path（Remote実行時必須、POSIX絶対パス）。
- legacy external `model_catalog.json` path。
- legacy R2 index path。
- Workflow Template override。
- Manifest override。

R2 / Civitai / Vast.ai のcredential editorを環境設定へ重複配置しない。

## 7. Overview

最低表示:

- Project name / id / path。
- Story status。
- Models status。
- Prompt Plan status。
- Workflow status。
- Model availability / Preflight status。
- Execution target / latest Run status。
- 次に行うべき工程。

Artifact dependency更新時は下流Artifactをstaleとして表示する。

## 8. Grok Work Card / Artifact Editor

Story / Models / Prompt PlanでGrok Work Cardを提供する。

1. task。
2. 使用する確定Artifact。
3. 添付file。
4. prompt preview。
5. Copy Prompt。
6. Open Folder。
7. 手動作業checklist。

Model Catalog / Workflow / Model Availability / Preflight / ExecutionにはGrok Work Cardを置かない。

Grokから貼り戻す工程ではparse preview、Draft save、validation、current confirmedとの差分、explicit Confirmを提供し、pasteしただけでfinal fileを更新しない。

## 9. Civit Explorer / Model Catalog

Civit ExplorerはProject工程ではなくapp-wide toolとして提供する。サービス連携のCivitai画面、Home左navigationの連携済みCivitai導線、またはapplication menuの `Window > Civit Explorer` から開ける。

Projectのモデル選定画面は同じapp-wide Catalogを利用し、必要に応じてその場でSYNCできる。

Catalog SYNC、Collection選択、検索、Version/File/Base Model/trained words/thumbnail/strengthBaseline確認、同期metrics、Civitai model pageへの外部navigation等を提供する。詳細なCatalog仕様は `../integrations/external-tools.md` を正本とする。

## 10. Story / Models / Prompt Plan

Story:

- Current Brief summary。
- `story.md` status。
- Grok Work Card。
- editor / import / validation / confirm / history。

Models:

- Model Family選択。
- Illustrious Checkpoint / Anima Diffusion ModelのCatalog選択。
- Anima Text Encoder / VAEのLocal/R2 inventory選択。
- 選択済み基盤モデルを変更しないGrok LoRA Selection prompt。
- `model_loras.json` importと既存基盤モデルへのmerge。
- catalog identity validation。
- reason / promptFallbacks / missingRequirements。
- LoRA re-selection promptと履歴表示。
- explicit Confirm。

Prompt Plan:

- `prompt_plan.json` を正本とした左→右の擬似Workflow Tree。
- common / Root LoRA / Branch LoRA / Matrix表示。
- LoRA strength / leaf prompt / ordering / validationの編集。
- JSONと人間向けMarkdownの二重正本を作らない。

## 11. Workflow Screen

GrokではなくCompiler工程。

- Template / Manifest version。
- Models / Prompt Plan status。
- planned branch count。
- Compile。
- generated branch / node / link summary。
- UI Workflow output path。
- Execution API graphの出力path / validation status / workflow identityをWorkflow build provenanceとして扱う。
- structure validation。
- Workflow生成済みの場合の「フォルダを開く」。

## 12. Model Availability

Project工程「モデル配置」は `executionTarget` と必要modelの配置条件を扱う。

```text
Local target
  Local required
  R2 optional

Remote target
  Local optional
  R2 required
```

Remote targetではさらにCloud Instance選択を表示する。

```text
Provider   Vast.ai
Instance   #<id> | <status> | <GPU> | <label>
```

Projectへ保存するのは `remoteProvider=vastai` と `remoteInstanceId`。SSH Host / Portは保存せず、実行時にVast.ai APIから解決する。

Vast.ai未連携の場合は「サービス連携 → クラウドインスタンス → Vast.ai」で設定する必要があることを明示する。

R2 ExplorerはProject工程ではmodel availability確認用のread-only用途を基本とし、R2管理操作はサービス連携またはHomeの連携済みサービスから開くStandalone R2 File Managerへ集約する。

Remote targetでR2に存在するmodelはExecution開始時にRemote hostがR2から直接取得する。model binaryをSSH/SCPで送るUXを提供しない。

## 13. Standalone R2 File Manager

サービス連携のCloudflare R2画面、Home左navigationの連携済みR2導線、またはapplication menuの `Window > R2 File Manager` から開く。

Projectに依存せず、bucket管理、folder navigation、search、multipart upload、pause/resume/cancel、move/rename、delete、download情報生成、一括DL、名前付きbatch template、一時presigned PUT URL生成等を提供する。

数GB fileをRendererへ全読込せず、Main Processがstream/multipart uploadする。

詳細は `../integrations/external-tools.md` を正本とする。

## 14. Preflight Screen

共通表示:

```text
Artifacts
References
Workflow / API graph structure
Model availability
Execution target
Integrated service readiness
```

Remote targetでは最低限、ProjectにCloud Provider / Instanceが選択されていることをGateに含める。

Vast.ai/SSH/Remote Worker capabilityの実装に応じて次を段階的にblocking validationへ追加する。

- Vast.ai API Key / API reachability。
- selected Instance existence。
- SSH private key path。
- Environment Settings の Remote ComfyUI install path。
- current public SSH endpoint。
- private-key SSH authentication。
- Remote filesystem/runtime/disk。
- Remote localhost ComfyUI API / Scene Prompt Tools。
- required R2 models。

検証未実装のcapabilityを成功したように表示しない。

## 15. Execution Screen

> Current implementation: `実行` stage、persistent Execution Run、Local ComfyUI連続生成、Remote Vast.ai lifecycle / SSH / bootstrap / model staging / Scene Prompt連続生成 / artifact package・R2 upload・Local download・SHA-256検証まで実装済み。Start / Stop scheduling / Force interrupt / Resume / 別Instanceで新しく実行 / 最初からやり直すと、phase/progress/error/推定残り時間監視を提供する。

Grok paneは非表示とし、Local UIを全幅使用する。

最低表示:

```text
Execution target: Local / Remote
Current Run ID
Current phase
Connection status
Model preparation status
Overall generation progress
Current Scene Prompt branch
Branch progress
Current prompt ID
Artifact packaging status
R2 upload status
Local download status
Final verification status
```

Remote targetでは `generation completed` と `artifact delivery completed` を別状態として表示する。

操作:

- Start。
- Stop scheduling。
- Force interrupt。
- Resume。
- Open local output directory。

詳細は `../architecture/remote-execution.md` を正本とする。

## 16. Grok Pane Controls

| 工程 / Tool | Grok pane |
| --- | --- |
| 概要 | 非表示 |
| 基本設定 | 非表示 |
| ストーリー | 表示 |
| モデル選定 | 表示 |
| プロンプト設計 | 表示 |
| ワークフロー | 非表示 |
| モデル配置 | 非表示 |
| 実行前チェック | 非表示 |
| 実行 | 非表示 |
| Home / サービス連携 / R2 File Manager / Civit Explorer / Vast.ai | 非表示 |
| `Window` から開いたStandalone R2/Civit window | 非表示 |

工程切替時はこの既定表示を再適用する。

Grok paneを非表示にしてもWebContents/persistent sessionは破棄しない。

Grokを使用しない工程ではshow/hide control自体を表示しない。

## 16.1 Standalone tool windows

Electron application menuの `Window` には `R2 File Manager` と `Civit Explorer` を提供する。選択するとMain Windowとは独立した `BaseWindow + WebContentsView` で該当toolを表示する。同一tool windowが既に存在する場合は新規作成せず、既存windowをshow/focusする。

Standalone windowも同じpreload APIを利用するが、Grok paneは持たない。

## 17. Secret boundary in UI

- `CIVIT_API_KEY` / `VASTAI_API_KEY` の値自体をGrok paneやProject artifactへ表示/保存しない。
- R2 Secret Access Key / Cloudflare API Tokenの保存済み値をRendererへ再表示しない。
- SSH private key本文をRendererへ返さない。設定画面ではpathとconfigured/readable statusのみ扱う。
- R2 credential / SSH keyをProject artifactやGrok添付候補へ出さない。
- signed URL full query stringをExecution画面の通常logへ出さない。
- model binaryをGrok添付候補にしない。
- Grok Cookie / browser profileをLocal Artifactへ保存しない。

## 18. File Attachment UX

各fileについてname / absolute path / purpose / existenceを表示できること。

`Open Folder` はExplorer補助でありfile uploadを代行しない。

`prompt_tree.md` は標準添付候補に含めない。
