# Application Shell UI

Status: Active

## 1. 目的

Electron の主画面で、Batch Studio のローカル工程とユーザー操作の Grok Web を同時に扱う UI 構造を定義する。

詳細な工程固有 UI は各契約・UI 文書が所有し、本書はアプリ全体の shell と共通 interaction を所有する。

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

Model Catalog / Workflow / Model Availability / PreflightにはGrok Work Cardを置かない。

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
- output path。
- structure validation。
- Workflow生成済みの場合の「フォルダを開く」。

## 13. Model Availability / R2 File Manager

Project工程の「モデル配置」は `models.json` とLocal / integrated R2所在を一覧化し、同じ画面から統合R2 Managerを操作できる。

Projectなしの「R2 File Manager」はProject設定への紐付け操作を除き、同じR2管理機能をStandalone Toolとして利用できる。

Grok paneは非表示でLocal UIを全幅使用する。

最低限提供するUX:

- model availability再確認（Project工程のみ）。
- Local / R2 / state (`available` / `transfer-required` / `missing`)表示（Project工程のみ）。
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

数GB fileをRendererへ全読込せず、Main Processがstream/multipart uploadする。

R2-only modelはLocal転送完了まで`transfer-required` / Blockingのままとする。

## 14. Preflight Screen

```text
Artifacts
References
Workflow structure
Model availability
Integrated service readiness
```

Blocking / Warningを分離しREADY条件を明示する。

## 15. Grok Pane Controls

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
| ProjectなしHome / R2 File Manager / Civit Explorer | 非表示 |

工程切替時はこの既定表示を再適用する。

Grok paneを非表示にしてもWebContents/persistent sessionは破棄しない。

Grokを使用しない工程ではshow/hide control自体を表示しない。Grok使用工程では手動show/hide、reload、external browser、divider resizeを許可するが、DOM injection / automatic send / upload automationは行わない。

## 16. Secret boundary in UI

- `CIVIT_API_KEY` の値自体をGrok paneやProject artifactへ表示/保存しない。
- Catalog UIは「設定済み / 未設定」の状態だけを表示する。
- R2 Secret Access Key / Cloudflare API Tokenの保存済み値をRendererへ再表示しない。configured状態だけを返す。
- R2 credentialをProject artifactやGrok添付候補へ出さない。
- model binaryをGrok添付候補にしない。
- Grok Cookie / browser profileをLocal Artifactへ保存しない。

## 17. File Attachment UX

各fileについてname / absolute path / purpose / existenceを表示できること。

`Open Folder` はExplorer補助でありfile uploadを代行しない。

`prompt_tree.md` は標準添付候補に含めない。
