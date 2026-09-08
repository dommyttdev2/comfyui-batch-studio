# Application Shell UI

Status: Active

## 1. 目的

Electron の主画面で、Batch Studio のローカル工程とユーザー操作の Grok Web を同時に扱う UI 構造を定義する。

詳細な工程固有 UI は各契約・UI 文書が所有し、本書はアプリ全体の shell と共通 interaction を所有する。

## 2. 主画面

基本レイアウト:

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

## 3. Global Navigation

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

`Prompt Tree` の独立navigationは設けない。Prompt構造の人間向け表示・編集はPrompt Planへ統合する。

## 4. Overview

最低表示:

- Project name / id / path。
- Story status。
- Models status。
- Prompt Plan status。
- Workflow status。
- Model availability / Preflight status。
- 次に行うべき工程。

Artifact dependency更新時は下流Artifactをstaleとして表示する。

## 5. Grok Work Card

Story / Models / Prompt Planで提供する。

1. task。
2. 使用する確定Artifact。
3. 添付file。
4. prompt preview。
5. Copy Prompt。
6. Open Folder。
7. 手動作業checklist。

Model Catalog / Workflow / Model Availability / PreflightにはGrok Work Cardを置かない。

## 6. Artifact Editor / Import

Grokから貼り戻す工程では次を提供する。

- code block / raw text paste。
- parse preview。
- Draft save。
- validation result。
- current confirmed artifactとの差分。
- explicit Confirm。

Grok回答をpasteしただけでfinal fileを更新しない。

## 7. Model Catalog Screen

旧 `civit-model-viewer` の機能をBatch Studio UIへ統合する正規画面。

Grok paneは既定非表示とし、Local UIを全幅で使う。

必須表示・操作:

- Civitai API key configured / missing status。
- Catalog SYNC。
- sync state / phase / progress / message / error。
- generation / model count / added・updated・removed件数。
- 保存先catalog path。
- 現Projectが統合Catalogを使用中か。
- 「このCatalogを使用」による明示切替。
- Public / Private Collection一覧。
- Collection選択 / 全選択 / 解除。
- モデル名・ファイル名による全Collection横断検索。
- Model選択状態を検索・Collection切替をまたいで保持。
- Version切替。
- thumbnail。
- files / primary file。
- trained words。
- Civitai observed `strengthBaseline` とsampleCount。
- Civitai model pageを外部ブラウザで開く。
- 選択結果JSONコピー。
- 名前付きCollection / Model / Version選択テンプレートの保存・適用・削除。
- 大量Modelの段階表示。

検索語がある場合はCollection選択に関係なく全Collectionを検索する。

同期失敗時も保存済みCatalogを消さず、存在する場合は閲覧可能にする。

初回起動で保存済みCatalogがなくAPI keyが設定済みの場合のみ自動SYNCを開始する。保存済みCatalogがある通常起動では自動SYNCせず、保存値を即表示する。

## 8. Story Screen

- Current Brief summary。
- `story.md` status。
- Grok Work Card。
- Story editor / import。
- Validation。
- Confirm / history。

## 9. Models Screen

モデル選定主体はGrok。

- current catalog generation / model count。
- Grok Model Selection prompt。
- `models.json` import。
- catalog identity validation。
- reason / missingRequirements。
- re-selection prompt。
- explicit Confirm。

カタログの探索・Collection操作・Version比較は「モデルカタログ」工程へ分離し、Models Screenをカタログbrowserにしない。

## 10. Prompt Plan Screen

`prompt_plan.json` の人間向け正規UI。

主表示は左→右の擬似Workflow Tree。

```text
共通Prompt -> Root LoRA -> Branch LoRA -> Matrix
```

Leafを主ツリーへ1件ずつ大量展開せず、Matrix内へ集約する。

共通Prompt、Root/Branch LoRA strength、Leaf name/positive/negative、順序、validationを確認・編集できること。

選択Nodeの詳細は画面下部へ固定表示せずpopup/modalで表示する。LoRA popupではPrompt Planの適用強度に加え、`models.json`から解決したmodel名、version、file名、trained words、Civitai baselineを確認できること。

## 11. Workflow Screen

GrokではなくCompiler工程。

- Template / Manifest version。
- Models / Prompt Plan status。
- planned branch count。
- Compile。
- generated branch / node / link summary。
- output path。
- structure validation。
- Workflow生成済みの場合の「フォルダを開く」。

## 12. Model Availability / R2 Screen

`models.json` とLocal / integrated R2所在を一覧化し、旧 `r2-file-manager` の主要機能を同じ工程へ統合する。

Grok paneは非表示でLocal UIを全幅使用する。

最低限提供するUX:

- model availability再確認。
- Local / R2 / state (`available` / `transfer-required` / `missing`)表示。
- R2接続設定 / 接続テスト。
- Bucket選択 / create / empty-bucket delete。
- breadcrumb付きfolder navigation。
- object list / paging / bucket-wide search。
- size / modified time。
- single object download info。
- upload file picker / progress / pause / resume / cancel。
- app再起動後のunfinished upload表示・再開。
- move / rename。
- main list checkboxによる複数delete。
- optional storage metrics。
- 「一括DLのURL生成」から開く独立popup。

一括DLpopupはmain listのdelete selectionと独立したselection stateを持つ。folder移動・検索を跨いで最大500件保持し、選択済み一覧、個別解除、全解除、名前付きtemplate、URL / curl / wget / aria2cの生成・一括copyを提供する。

数GB fileをRendererへ全読込せず、Main Processがstream/multipart uploadする。

R2-only modelはLocal転送完了まで`transfer-required` / Blockingのままとする。

## 13. Preflight Screen

```text
Artifacts
References
Workflow structure
Model availability
Integrated service readiness
```

Blocking / Warningを分離しREADY条件を明示する。

## 14. Grok Pane Controls

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

工程切替時はこの既定表示を再適用する。

Grok paneを非表示にしてもWebContents/persistent sessionは破棄しない。

Grokを使用しない工程ではshow/hide control自体を表示しない。Grok使用工程では手動show/hide、reload、external browser、divider resizeを許可するが、DOM injection / automatic send / upload automationは行わない。

## 15. Secret boundary in UI

- `CIVIT_API_KEY` の値自体をGrok paneやProject artifactへ表示/保存しない。
- Catalog UIは「設定済み / 未設定」の状態だけを表示する。
- R2 Secret Access Key / Cloudflare API Tokenの保存済み値をRendererへ再表示しない。configured状態だけを返す。
- R2 credentialをProject artifactやGrok添付候補へ出さない。
- model binaryをGrok添付候補にしない。
- Grok Cookie / browser profileをLocal Artifactへ保存しない。

## 16. File Attachment UX

各fileについてname / absolute path / purpose / existenceを表示できること。

`Open Folder` はExplorer補助でありfile uploadを代行しない。

`prompt_tree.md` は標準添付候補に含めない。
