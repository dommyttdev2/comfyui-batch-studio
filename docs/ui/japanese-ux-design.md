# 日本語 UI/UX 実装設計

Status: Draft

## 1. 目的

ComfyUI Batch Studio を日本語 UI として実装する際の、画面構成、表示用語、工程別の操作フロー、主要コンポーネント、状態表示、Grok Web との手動連携 UX を整理する。

本書は UI/UX の実装詳細を扱う Draft 文書であり、データ schema、Grok の責務、Workflow Compiler の内部契約を再定義しない。

上位の Shell / 責務境界は次を正本とする。

```text
docs/ui/application-shell.md
docs/product/scope-and-flow.md
docs/contracts/grok-contract.md
```

本書では Grok に貼り付ける具体的な依頼文・プロンプト本文は定義しない。Workflow 生成用のプロンプトも扱わない。Workflow 工程は Batch Studio の Compiler 操作として設計する。

---

## 2. UX の基本原則

### 2.1 Artifact 中心ではなく工程・次の行動を中心にする

内部では `story.md`、`models.json`、`prompt_plan.json` 等の Artifact を管理するが、通常 UI ではファイルそのものより次を優先する。

```text
今どの工程か
↓
次に何をすべきか
↓
そのために必要な入力は揃っているか
↓
結果を確認・修正・確定できるか
```

### 2.2 Grok 連携は共通基盤を持ち、工程ごとに UX を最適化する

Story / Models / Prompt Plan はすべて手動で Grok Web と往復するが、目的が異なるため UI を同一化しすぎない。

```text
Shared Infrastructure
├─ 依頼内容生成
├─ Clipboard copy
├─ 添付候補表示
├─ Folder open
├─ Grok response paste
├─ code block / JSON 抽出
├─ Draft / History
└─ validation result

Stage-specific UX
├─ Story
│  └─ 会話 / 企画 / 完成 Story 取り込み
├─ Models
│  └─ 選定 / catalog 照合 / 不足モデル対応
└─ Prompt Plan
   └─ 大量構造データの生成 / 取り込み / レビュー / 修正
```

### 2.3 Grok Web はユーザー操作

Batch Studio は次を行わない。

- Grok への自動送信。
- Grok DOM の操作。
- 自動ファイル添付。
- 回答 scraping。

Batch Studio は「渡すものを準備する」「返ってきたものを取り込む」部分を支援する。

### 2.4 Prompt Plan は Tree-only UI にしない

数百〜数千の生成項目を扱う可能性があるため、単純な展開 Tree だけを主要 UI にしない。

標準構成は次を基本とする。

```text
Branch List
+
Leaf Table
+
Inspector
```

Leaf Table は virtualized list / virtualized table を前提とする。

---

## 3. 日本語 UI 用語

内部 schema / field name は既存の英語名称を維持する。UI 表示のみ日本語化する。

| 内部概念 | 日本語 UI |
| --- | --- |
| Project | プロジェクト |
| Project Brief | 基本設定 |
| Story | ストーリー |
| Models | モデル選定 |
| Prompt Plan | プロンプト設計 |
| Branch | ブランチ |
| Leaf | 生成項目 |
| Common Prompt | 共通プロンプト |
| Root LoRA | 全体共通 LoRA |
| Branch LoRA | ブランチ LoRA |
| strengthBaseline | Civitai 基準値 |
| strengthModel | Model 強度 |
| strengthClip | CLIP 強度 |
| Workflow | ワークフロー |
| Model Availability | モデル配置 |
| Preflight | 実行前チェック |
| Draft | 下書き |
| Confirmed | 確定済み |
| Validation | 検証 |
| History | 履歴 |

`Leaf` は内部用語として維持するが、通常 UI では「生成項目」と表示する。

v1 は `1 leaf = 1 image` なので、必要に応じて次のように件数と予定画像枚数を併記できる。

```text
ブランチ b01
48件 / 48枚
```

---

## 4. メインナビゲーション

左側のプロジェクト工程 Navigation は次を基本とする。

```text
概要
基本設定
ストーリー
モデル選定
プロンプト設計
ワークフロー
モデル配置
実行前チェック
```

### 4.1 名称方針

- `Project` はナビゲーション名として曖昧なため `基本設定` とする。
- `R2 / Models` は手段名なので、目的を表す `モデル配置` とする。
- `Prompt Tree` の独立 Navigation は設けない。

---

## 5. Application Shell

基本レイアウト:

```text
┌──────────────────────────────────────────────────────────────────┐
│ プロジェクト: {project.title}                 フォルダー   設定 │
├────────────┬────────────────────────────┬────────────────────────┤
│ 工程       │ Batch Studio              │ Grok                   │
│            │                            │                        │
│ 概要       │ 現在の作業                │ grok.com               │
│ 基本設定   │                            │                        │
│ ストーリー │ 次にすること              │                        │
│ モデル選定 │                            │                        │
│ プロンプト │ 編集 / 確認               │                        │
│ ワークフロー│                           │                        │
│ モデル配置 │ 検証結果                   │                        │
│ 実行前確認 │                            │                        │
└────────────┴────────────────────────────┴────────────────────────┘
```

Local UI / Grok Web の divider はリサイズ可能とする。

Local UI は長い Prompt Plan や validation を確認するため、一時最大化できるようにする。

---

## 6. Grok Pane の工程別初期状態

| 工程 | 初期表示 |
| --- | --- |
| 基本設定 | 非表示 |
| ストーリー | 表示 |
| モデル選定 | 表示 |
| プロンプト設計 | 表示 |
| ワークフロー | 非表示 |
| モデル配置 | 非表示 |
| 実行前チェック | 非表示 |

初期表示は UX 上の default であり、ユーザーは任意に show / hide できる。

表示切替は Grok Web の内容を操作するものではない。

---

## 7. 「次にすること」カード

各工程の上部では詳細 status より先に、ユーザーが今行うべき操作を表示する。

例:

```text
次にすること
────────────────────────────────

Grokでモデル選定を行ってください。

必要なファイル
✓ story.md
✓ model_catalog.json

[依頼内容を確認] [コピー] [ファイルの場所を開く]
```

別状態:

```text
次にすること
────────────────────────────────

モデル選定結果を確認して確定してください。

✓ すべてのモデルを確認済み
⚠ 1件の注意があります

[選定内容を確認]
```

目的は status の羅列ではなく、次の action を一意に理解できること。

---

## 8. 日本語ステータス表示

内部 status は既存値を維持する。

| Internal | 詳細 UI |
| --- | --- |
| MISSING | 未作成 |
| DRAFT | 下書き |
| INVALID | 要修正 |
| WARNING | 注意あり |
| CONFIRMED | 確定済み |
| STALE | 更新が必要 |
| GENERATED | 生成済み |
| BLOCKED | 続行できません |
| READY | 準備完了 |
| UNAVAILABLE | 利用できません |

Overview 等の高レベル表示ではさらに簡略化できる。

```text
未着手
作業中
要確認
確定済み
更新必要
準備完了
```

色だけに依存せず、アイコン + ラベル + 必要に応じて説明文を使う。

---

## 9. 概要画面

Artifact file list ではなく Pipeline Dashboard とする。

例:

```text
{project.title}

予定画像枚数
504枚


次にすること
────────────────────────────────
プロンプト設計の下書きを確認してください。

3件の注意があります。

[プロンプト設計を確認]


進行状況
────────────────────────────────

✓ 基本設定
✓ ストーリー
✓ モデル選定
● プロンプト設計      504件
○ ワークフロー
○ モデル配置
○ 実行前チェック


注意
────────────────────────────────

⚠ 目標500枚 / 現在504枚
⚠ 2件のLoRAにCivitai基準値がありません
```

Overview では「どのファイルが存在するか」より「プロジェクトがどこまで進んでいるか」を主役にする。

---

## 10. 基本設定画面

新規プロジェクトでは詳細設計を要求しない。

主要入力:

- プロジェクト名。
- 版権キャラかどうか。
- キャラクター名。
- 出典作品・シリーズ。
- ターゲット読者の特徴。
- 大まかな要望。
- 出さないもの・避けたい方向性。
- 固定前提の確認。

詳細設定は collapsed section とする。

- プロジェクト ID。
- Story 文書形式。
- 目標画像枚数。
- 想定モデル系。
- 目標章数。
- 参考ファイル。

初期画面は可能な限り1画面で完結させる。

---

## 11. ストーリー画面

Story は「会話・探索型」の UX とする。

### 11.1 基本構成

```text
ストーリー
────────────────────────────────────

状態: 作業中

■ 現在の基本設定

キャラクター
{character}

ターゲット
{audience}

目標画像枚数
{target}枚


■ Grokでストーリーを検討

[依頼内容を生成]
[依頼内容をコピー]
[参考ファイルの場所を開く]


■ ストーリーが決まったら

[完成版の作成依頼を生成]
[コピー]


■ 完成したストーリーを取り込む

┌────────────────────────────────┐
│ Grokの回答をここに貼り付け    │
│                                │
└────────────────────────────────┘

[内容を取り込む]
```

### 11.2 取り込み後

```text
取り込み結果

✓ story.md として読み込めます

[ストーリーを確認]
```

レビュー後:

```text
[下書きとして保存]
[確定]
```

Story 画面では parser / schema 等の技術語を通常 UI の主役にしない。

### 11.3 再修正

Story 専用 action:

```text
[ストーリーの修正依頼を作成]
```

Grok 用の具体的な依頼本文は本書では定義しない。

---

## 12. モデル選定画面

Models は「選定・照合型」の UX とする。

### 12.1 Grok 選定前

```text
モデル選定
────────────────────────────────────

カタログ
Generation {n}
最終更新: {datetime}

状態: 選定待ち


■ Grokでモデルを選定

必要なファイル

✓ story.md
✓ model_catalog.json

[選定依頼を生成]
[コピー]
[添付ファイルの場所を開く]


■ Grokの選定結果

┌────────────────────────────────┐
│ Grokの回答を貼り付け          │
└────────────────────────────────┘

[選定結果を解析]
```

### 12.2 解析後のモデルカード

Checkpoint:

```text
Checkpoint
────────────────────
モデル       {modelName}
バージョン   {versionName}
ファイル     {fileName}

✓ カタログ確認済み
```

LoRA:

```text
キャラクターLoRA
────────────────────
モデル       {modelName}
バージョン   {versionName}
ファイル     {fileName}

トリガーワード
{trainedWords}

Civitai基準値
0.70
17投稿から算出

✓ カタログ確認済み
```

通常 UI では `observed-usage-derived` 等の内部値をそのまま表示しない。

詳細表示では provenance を確認できる。

```text
算出方法
投稿単位中央値 → 全投稿中央値
対象投稿数: 17
```

### 12.3 不足モデル

単なる error list ではなく、解決手順を含む専用 UI とする。

```text
不足しているモデル
────────────────────────────────

ポーズ用LoRAが必要です。

理由
{reason}

現在のモデルカタログには該当候補がありません。

[不足内容をコピー]
[モデルカタログを確認]
```

解決フロー:

```text
1. Civitaiコレクションへモデルを追加
2. civit-model-viewerで同期
3. モデル選定をやり直す
```

再選定 action:

```text
[モデルを再選定する]
```

---

## 13. プロンプト設計画面

Prompt Plan は Grok から受け取る工程と、大量データをレビュー・修正する工程を分離する。

上部モード:

```text
[Grokから取得] [確認・編集] [履歴]
```

### 13.1 Grokから取得

```text
プロンプト設計をGrokで作成
────────────────────────────────

目標画像枚数
500枚

使用モデル
✓ 確定済み

必要なファイル
✓ story.md
✓ models.json

[作成依頼を生成]
[コピー]
[添付ファイルの場所を開く]
```

### 13.2 結果取り込み

```text
Grokの結果を取り込む
────────────────────────────────

┌──────────────────────────────────┐
│ Grokの回答全体を貼り付け        │
│                                  │
└──────────────────────────────────┘

[結果を解析]
```

Grok response が説明文 + JSON code block でも、Batch Studio が候補 JSON を抽出する。

解析例:

```text
解析結果
────────────────────────────────

✓ JSONを検出
✓ Prompt Plan Schema v1
✓ モデル参照を確認

ブランチ       12
生成項目       504
予定画像枚数   504

⚠ 目標500枚との差: +4枚

[下書きとして取り込む]
```

解析成功だけでは Confirm しない。

```text
Grok response
→ Parsed candidate
→ Draft
→ Review
→ Confirm
```

### 13.3 確認・編集

標準レイアウト:

```text
┌───────────────────────────────────────────────────────────────┐
│ プロンプト設計                       504件 / 504枚   ✓ 有効 │
├──────────────┬──────────────────────────────┬────────────────┤
│ ブランチ     │ 生成項目                     │ 編集           │
│              │                              │                │
│ 共通Prompt   │ 検索 [________________]      │ ID             │
│ 全体LoRA     │                              │ s1-01-c1       │
│              │ ID        名前        状態   │                │
│ ● b01   48   │ s1-01     座位...      ✓    │ 名前           │
│   b02    8   │ s1-02     立位...      ✓    │ [___________]  │
│   b03   92   │ s1-03     机...        ⚠    │                │
│   b04   44   │ ...                          │ Positive       │
│              │                              │ [            ] │
│              │                              │                │
│              │                              │ Negative       │
│              │                              │ [            ] │
└──────────────┴──────────────────────────────┴────────────────┘
```

構成:

- 左: Branch List / Common / Root LoRAs。
- 中央: Leaf Table。
- 右: Inspector。

### 13.4 Leaf Table

要件:

- virtualized rendering。
- 検索。
- Branch 単位 filter。
- validation state 表示。
- keyboard selection を考慮。
- 数百〜数千件でも全行 DOM 展開しない。

通常列候補:

```text
ID
名前
状態
```

Positive / Negative 全文は Inspector で編集する。

### 13.5 Inspector

選択した生成項目を編集する。

```text
ID
s1-01-c1

名前
[____________________________]

Positive
┌────────────────────────────┐
│                            │
└────────────────────────────┘

Negative
┌────────────────────────────┐
│                            │
└────────────────────────────┘
```

`leaf.id` は stable output identity なので、通常編集と ID 編集は分離して扱うことを検討する。

### 13.6 共通プロンプト

```text
共通プロンプト
────────────────────────────────

Positive
┌─────────────────────────────────────┐
│                                     │
└─────────────────────────────────────┘

Negative
┌─────────────────────────────────────┐
│                                     │
└─────────────────────────────────────┘
```

### 13.7 Branch 操作

Branch 一覧では最低限次を表示する。

```text
branch.id
branch.label
生成項目数
validation state
```

操作候補:

- 並べ替え。
- label 編集。
- Branch 選択。
- Branch LoRA 編集。

### 13.8 Prompt Plan 再修正

専用 action:

```text
[プロンプト設計の修正依頼を作成]
```

Grok 用の具体的な本文は本書では定義しない。

---

## 14. LoRA 強度 UI

Root / Branch で表示形式を統一する。

### 14.1 Civitai 基準値あり

```text
キャラクターLoRA
────────────────────────────

character.safetensors

Civitai基準値
0.70
17投稿から算出

現在の適用値

Model強度
[ 0.70 ]

CLIP強度
[ 0.70 ]

[基準値に戻す]
```

### 14.2 基準値から変更済み

```text
Civitai基準値
0.70

現在の適用値

Model強度
0.80

CLIP強度
0.65

● 基準値から変更されています

[基準値に戻す]
```

### 14.3 Civitai 基準値なし

```text
Civitai基準値
取得できませんでした

Model強度
[      ]

CLIP強度
[      ]

※ 使用する値を入力してください
```

Batch Studio は暗黙に `1.0 / 1.0` や `0.7 / 0.7` を補完しない。

---

## 15. Grok Result Import の共通基盤

Story / Models / Prompt Plan で内部部品として共通化する。

共通責務:

```text
Paste
↓
Candidate extraction
↓
Parse
↓
Stage-specific validation
↓
Draft
```

ただし UI 文言と validation 表示は工程別に最適化する。

### 15.1 Story

- Markdown / Story content 取り込み中心。
- parser terminology は通常表示しない。

### 15.2 Models

- Model / Version / File identity 照合中心。
- Missing Requirements を専用 UX で表示。

### 15.3 Prompt Plan

- JSON Schema / semantic validation。
- Branch / Leaf 件数。
- modelRef validation。
- target count 差分。
- 大量データレビューへの遷移。

---

## 16. ワークフロー画面

Workflow は Grok 工程ではない。

この画面には Grok 用の依頼生成・Prompt paste 機構を置かない。

### 16.1 生成前

```text
ワークフロー
────────────────────────────────

入力

✓ models.json        確定済み
✓ prompt_plan.json   確定済み
✓ Template           有効
✓ Manifest           有効

予定

ブランチ数     12
画像枚数       504

[ワークフローを生成]
```

### 16.2 生成後

```text
生成結果
────────────────────────────────

✓ 12ブランチ
✓ 504生成項目
✓ 未使用ブランチ 0
✓ Node ID衝突 0
✓ Link ID衝突 0

出力
LoRA_{project.id}.json

[フォルダーを開く]
```

詳細技術 validation は展開可能な詳細領域へ置く。

---

## 17. モデル配置画面

目的は R2 操作ではなく、必要モデルが生成環境に揃っているか確認すること。

```text
モデル配置
────────────────────────────────

必要モデル       Local       R2        状態

Checkpoint       ✓           ✓         使用可能
Character LoRA   ✓           ✓         使用可能
Pose LoRA        ✕           ✓         転送が必要
Style LoRA       ✕           ✕         見つかりません
```

選択したモデル詳細:

```text
Pose LoRA

pose.safetensors

Local
見つかりません

R2
見つかりました

[R2 File Managerを開く]
[ファイル名をコピー]
```

Batch Studio は初期段階で destructive R2 operation を独自実装しない。

---

## 18. 実行前チェック画面

技術ログを最初に見せず、まず READY / BLOCKED の結論を示す。

### 18.1 READY

```text
実行準備ができました

✓ READY FOR COMFYUI

504枚予定

すべての必須項目を確認しました。
```

### 18.2 BLOCKED

```text
実行準備が完了していません

3件の対応が必要です

────────────────────────

モデル配置
✕ pose.safetensors がLocalにありません

プロンプト設計
✕ 未入力のLoRA強度があります

ワークフロー
✓ 問題ありません

[問題のある項目を確認]
```

Blocking と Warning は明確に分ける。

---

## 19. Button / Action 文言

英語技術語をそのまま Button にしない。

推奨例:

| Internal action | 日本語 UI |
| --- | --- |
| Generate Prompt | 依頼内容を生成 |
| Copy Prompt | コピー |
| Open Folder | ファイルの場所を開く |
| Parse Result | 結果を解析 |
| Import Draft | 下書きとして取り込む |
| Confirm | 確定 |
| Revalidate | 再検証 |
| Retry Selection | モデルを再選定する |
| Reset to Baseline | 基準値に戻す |
| Compile Workflow | ワークフローを生成 |

Button 単体で意味が曖昧な場合は、画面見出しや補足文と合わせて理解できるようにする。

---

## 20. Empty / Error State

単に「データがありません」ではなく、次の行動を含める。

悪い例:

```text
モデルがありません
```

推奨:

```text
まだモデル選定結果がありません。

Grokでモデル選定を行い、結果をこの画面へ取り込んでください。

[選定依頼を生成]
```

解析失敗時も pasted original text を破棄しない。

```text
結果を解析できませんでした。

貼り付けた内容は下書きとして保持されています。
詳細を確認して再度取り込むか、Grokへ修正を依頼してください。
```

---

## 21. 日本語 UI 実装上の注意

### 21.1 ラベル幅

日本語ラベルは英語より短く見えても入力説明が長くなるため、form は固定 narrow label column に依存しすぎない。

### 21.2 技術用語

通常表示:

```text
Civitai基準値
生成項目
確定済み
更新が必要
```

詳細表示でのみ:

```text
strengthBaseline
modelRef
schemaVersion
observed-usage-derived
```

### 21.3 Tooltip 依存を避ける

重要な blocking reason や data provenance を tooltip だけに置かない。

### 21.4 色だけに依存しない

```text
✓ 確定済み
⚠ 注意あり
✕ 続行できません
```

のように icon + text を使う。

---

## 22. 実装コンポーネント候補

共通実装部品として次を想定する。

```text
AppShell
ProjectNavigation
NextActionCard
ArtifactStatusBadge
GrokPaneControls
AttachmentList
GeneratedRequestPanel
GrokResultPastePanel
ValidationSummary
DraftConfirmBar
HistoryView

StoryWorkspace
ModelSelectionWorkspace
MissingRequirementPanel
ModelSelectionCard

PromptPlanWorkspace
PromptPlanModeTabs
BranchList
LeafVirtualTable
LeafInspector
CommonPromptEditor
LoraStrengthEditor

WorkflowCompilePanel
ModelAvailabilityTable
PreflightSummary
```

見た目を共通化しても、Story / Models / Prompt Plan の業務フローまで同じ Component に押し込まない。

---

## 23. 本書で扱わないもの

次は別文書が正本であり、本 UX 文書では詳細定義しない。

- `models.json` schema。
- `prompt_plan.json` schema。
- Workflow Template Manifest schema。
- Workflow Node / Link / Group の生成アルゴリズム。
- Civitai observed baseline の集計アルゴリズム。
- Grok に貼り付ける具体的なプロンプト本文。
- Workflow 用プロンプト。
- R2 direct API。
- ComfyUI Queue 実行 UI。

---

## 24. 次の UX 詳細化対象

本 Draft を基礎として、次を個別に実装レベルまで詳細化する。

```text
1. Story UX
   - component hierarchy
   - state transition
   - empty/error/history

2. Models UX
   - selection result layout
   - missing model flow
   - catalog generation changes
   - strength provenance display

3. Prompt Plan UX
   - Branch List
   - Leaf Virtual Table
   - Inspector
   - bulk review
   - validation navigation
   - reordering
   - strength editing
```

個別画面の詳細化で新しい domain requirement が必要になった場合は、UI 文書だけで暗黙に仕様化せず Requirements / Decision を更新する。
