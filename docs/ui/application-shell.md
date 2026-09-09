# Application Shell UI

Status: Active

## 1. 目的

Electron の主画面で、Batch Studio のローカル工程とユーザー操作の Grok Web を同時に扱う UI 構造を定義する。

詳細な工程固有 UI は各契約・UI 文書が所有し、本書はアプリ全体の shell と共通 interaction を所有する。

Execution / Remote Executionの詳細状態機械とtransport設計は `../architecture/remote-execution.md` を正本とする。

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

Projectを閉じている場合はProject工程navigationを表示せず、Home / R2 File Manager / Civit ExplorerをLocal UI全幅で利用できること。

## 3. Global Navigation

Projectを開いている場合:

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
実行
```

Projectを閉じている場合:

```text
ホーム
R2 File Manager
Civit Explorer
```

`Prompt Tree` の独立navigationは設けない。Prompt構造の人間向け表示・編集はPrompt Planへ統合する。

## 4. Project Lifecycle / Home

起動時は前回明示的に開いていたProjectが有効なら自動復元する。

Projectを開いている間は「プロジェクトを閉じる」を提供する。閉じる操作はProject artifactを削除せず、現在Projectの選択と次回起動時の自動復元記録だけを解除する。

Projectを閉じたHomeでは最低限次を提供する。

- プロジェクトを新規作成。
- プロジェクトを開く。
- R2 File Manager。
- Civit Explorer。

R2 File Manager / Civit ExplorerはProjectに依存しないアプリ共通Toolとして利用できる。一方、Projectを開いた場合の既存「モデルカタログ」「モデル配置」工程もそのまま維持する。

## 5. Overview

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

## 6. Grok Work Card

Story / Models / Prompt Planで提供する。

1. task。
2. 使用する確定Artifact。
3. 添付file。
4. prompt preview。
5. Copy Prompt。
6. Open Folder。
7. 手動作業checklist。

Model Catalog / Workflow / Model Availability / Preflight / ExecutionにはGrok Work Cardを置かない。

## 7. Artifact Editor / Import

Grokから貼り戻す工程では次を提供する。

- code block / raw text paste。
- parse preview。
- Draft save。
- validation result。
- current confirmed artifactとの差分。
- explicit Confirm。

Grok回答をpasteしただけでfinal fileを更新しない。

## 8. Model Catalog / Civit Explorer

Project工程の「モデルカタログ」は旧 `civit-model-viewer` の機能をBatch Studio UIへ統合する正規画面。

Projectなしの「Civit Explorer」は同じ統合CatalogをProjectに紐付けず閲覧・SYNCするStandalone Toolとする。

Grok paneは既定非表示とし、Local UIを全幅で使う。

必須表示・操作:

- Civitai API key configured / missing status。
- Catalog SYNC。
- sync state / phase / progress / message / error。
- generation / model count / added・updated・removed件数。
- 保存先catalog path。
- Public / Private Collection一覧。
- Collection選択。
- モデル名・ファイル名による検索。
- Version / files / trained words / thumbnail / strengthBaseline確認。
- Civitai model pageを外部ブラウザで開く。

Project工程側ではさらに「このCatalogを使用」、Project向け選択結果JSON、Collection / Model / Version選択template等を提供する。

同期失敗時も保存済みCatalogを消さず、存在する場合は閲覧可能にする。

初回起動で保存済みCatalogがなくAPI keyが設定済みの場合のみ自動SYNCを開始する。保存済みCatalogがある通常起動では保存値を即表示する。

## 9. Story Screen

- Current Brief summary。
- `story.md` status。
- Grok Work Card。
- Story editor / import。
- Validation。
- Confirm / history。

## 10. Models Screen

モデル選定主体はGrok。

- current catalog generation / model count。
- Grok Model Selection prompt。
- `models.json` import。
- catalog identity validation。
- reason / missingRequirements。
- re-selection prompt。
- explicit Confirm。

カタログの探索・Collection操作・Version比較は「モデルカタログ」工程へ分離し、Models Screenをカタログbrowserにしない。

## 11. Prompt Plan Screen

`prompt_plan.json` の人間向け正規UI。

主表示は左→右の擬似Workflow Tree。

```text
共通Prompt -> Root LoRA -> Branch LoRA -> Matrix
```

Leafを主ツリーへ1件ずつ大量展開せず、Matrix内へ集約する。

共通Prompt、Root/Branch LoRA strength、Leaf name/positive/negative、順序、validationを確認・編集できること。

選択Nodeの詳細は画面下部へ固定表示せずpopup/modalで表示する。LoRA popupではPrompt Planの適用強度に加え、`models.json`から解決したmodel名、version、file名、trained words、Civitai baselineを確認できること。

## 12. Workflow Screen

GrokではなくCompiler工程。

- Template / Manifest version。
- Models / Prompt Plan status。
- planned branch count。
- Compile。
- generated branch / node / link summary。
- UI Workflow output path。
- Execution API graph availability / validation status。
- structure validation。
- Workflow生成済みの場合の「フォルダを開く」。

## 13. Model Availability / R2 File Manager

Project工程の「モデル配置」は `models.json` とLocal / integrated R2所在を確認する工程であり、R2 Explorerは読み取り専用とする。

ProjectなしHomeから開く「R2 File Manager」はR2管理用Standalone Toolとし、Bucket作成/削除、upload、move/rename、複数delete等の変更操作はここへ集約する。

Grok paneは非表示でLocal UIを全幅使用する。

### Project工程「モデル配置」

最低限提供するUX:

- `executionTarget` Local / Remoteの選択と現在値表示。
- model availability再確認。
- Local / R2 / target-specific state表示。
- Local target: Local配置必須、R2配置任意。
- Remote target: R2配置必須、Local配置任意。
- R2接続設定 / 接続テスト。
- モデル参照先Bucketのプルダウン選択。
- Bucket選択時点でProjectの `r2Bucket` を保存し、そのBucket全体をモデル検索対象とする。
- 「この場所をモデル補完先に設定」のような追加確定buttonは設けない。
- R2 Explorerでのfolder navigation / object閲覧 / paging / realtime search。
- single object download info。
- 「一括DLのURL生成」。
- Bucket作成/削除、upload、move/rename、R2 object deleteは提供しない。

Explorer内のfolder移動は閲覧位置であり、モデル検索対象prefixを変更する操作ではない。

Local targetでLocal-missing modelはBlocking。Remote targetでR2-missing modelはBlockingとする。

Remote targetでR2に存在するmodelは、Execution開始時にRemote hostがR2から直接取得するため `remote-stage-ready` として扱える。model binaryをSSH/SCPで送るUXは提供しない。

### Standalone「R2 File Manager」

Projectに依存せず、次を提供する。

- R2接続設定 / 接続テスト。
- Bucket選択 / create / empty-bucket delete。
- file-explorer風folder navigation。
- 現在pathを1本で表示。
- root以外ではfile table先頭に `../` folder rowを表示し、クリックで親prefixへ移動する。独立した「親へ」buttonは置かない。
- folderとfileを同じtableへ表示。
- object list / paging。
- size / modified time。
- single object download info。
- upload file picker / progress / pause / resume / cancel。
- app再起動後のunfinished upload表示・再開。
- move / rename。
- main list checkboxによる複数delete。
- optional storage metrics。
- 「一括DLのURL生成」から開く独立popup。

R2のObject metadataはアプリ起動時にR2から同期してLocal userDataへ永続化する。保存済みindexは同期処理中も検索に利用できる。

検索はSearch buttonによるsubmit方式ではなく、入力値の変更に応じてLocal indexからリアルタイム表示する。文字入力ごとにR2 APIへ検索requestを送らない。

一括DLpopupはmain listのdelete selectionと独立したselection stateを持つ。folder移動・検索を跨いで最大500件保持し、選択済み一覧、個別解除、全解除、URL / curl / wget / aria2cの生成・一括copyを提供する。

一括DLpopupのtemplate UIはfile browserより上部に配置する。保存済みtemplateはカード一覧ではなくプルダウンから選択し、選択時に対象Objectをbatch selectionへ反映する。template保存・削除操作も同領域へまとめる。

一括DLpopupはheader、template領域、browser、選択済み一覧、footerの各領域に十分なmargin / paddingを確保し、隣接要素が密着・重なりしないこと。

数GB fileをRendererへ全読込せず、Main Processがstream/multipart uploadする。

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

Local targetではLocal ComfyUI API、Scene Prompt Tools、required custom nodes、output pathを確認する。

Remote targetではSSH設定/秘密鍵認証/Host Key、Remote filesystem/runtime/disk、Remote localhost ComfyUI API、Scene Prompt Tools、required R2 modelsを確認する。

Blocking / Warningを分離しREADY条件を明示する。

## 15. Execution Screen

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

Local targetでは不要なRemote/R2 transfer stateを隠すか`Not required`として明確に表示する。

Remote targetでは `generation completed` と `artifact delivery completed` を別状態として表示し、ComfyUI生成終了時点でRun完了に見せない。

操作:

- `Start`。
- `Stop scheduling`: 次のScene Prompt item投入を停止する。
- `Force interrupt`: current ComfyUI promptを明示的にinterruptする。
- `Resume`: persisted evidenceから安全に再開可能なRunにのみ表示。
- `Open local output directory`: Local成果物確認後に提供。

Stop / Force interrupt は見た目・確認文言を明確に分ける。

## 16. Grok Pane Controls

| 工程 | Grok pane |
| --- | --- |
| 概要 | 非表示 |
| 基本設定 | 非表示 |
| ストーリー | 表示 |
| モデルカタログ | 非表示 |
| モデル選定 | 表示 |
| プロンプト設計 | 表示 |
| ワークフロー | 非表示 |
| モデル配置 | 非表示 |
| 実行前チェック | 非表示 |
| 実行 | 非表示 |
| ProjectなしHome / R2 File Manager / Civit Explorer | 非表示 |

工程切替時はこの既定表示を再適用する。

Grok paneを非表示にしてもWebContents/persistent sessionは破棄しない。

Grokを使用しない工程ではshow/hide control自体を表示しない。Grok使用工程では手動show/hide、reload、external browser、divider resizeを許可するが、DOM injection / automatic send / upload automationは行わない。

## 17. Secret boundary in UI

- `CIVIT_API_KEY` の値自体をGrok paneやProject artifactへ表示/保存しない。
- Catalog UIは「設定済み / 未設定」の状態だけを表示する。
- R2 Secret Access Key / Cloudflare API Tokenの保存済み値をRendererへ再表示しない。configured状態だけを返す。
- SSH private key本文をRendererへ返さない。設定画面ではpathとconfigured/readable statusのみ扱う。
- R2 credential / SSH keyをProject artifactやGrok添付候補へ出さない。
- signed URL full query stringをExecution画面の通常logへ出さない。
- model binaryをGrok添付候補にしない。
- Grok Cookie / browser profileをLocal Artifactへ保存しない。

## 18. File Attachment UX

各fileについてname / absolute path / purpose / existenceを表示できること。

`Open Folder` はExplorer補助でありfile uploadを代行しない。

`prompt_tree.md` は標準添付候補に含めない。
