# 日本語 UI/UX 要件

Status: Draft

## 1. 目的

ComfyUI Batch Studio を日本語 UI として実装する際に、ユーザーが各工程で達成できなければならないこと、表示すべき情報、操作上の制約、Grok Web との手動連携要件を定義する。

本書は **画面レイアウトやコンポーネント構成を固定する設計書ではない**。

実際の画面構成、ペイン数、タブ、カード、モーダル、Inspector 等の具体的な UI 実装は、実装エージェントが本書と上位契約を満たす範囲で判断する。

ただし、Prompt Plan の主表示については、ユーザーが実際の ComfyUI Workflow と近い感覚で意味構造を把握できることを重視し、左から右へ展開する擬似 Workflow Tree を必須 UX とする。これは ComfyUI の実 Node / Link を表示するものではなく、Prompt Plan の意味構造を可視化するための表現である。

上位の責務・契約は次を正本とする。

```text
docs/ui/application-shell.md
docs/product/scope-and-flow.md
docs/contracts/grok-contract.md
docs/contracts/project-artifacts.md
docs/contracts/prompt-plan.md
```

本書では Grok に貼り付ける具体的な依頼文・プロンプト本文は定義しない。Workflow 生成用のプロンプトも扱わない。Workflow 工程は Batch Studio の Compiler 操作として扱う。

---

## 2. 実装エージェントの裁量

実装エージェントは、次を自由に決定してよい。

- 画面全体のレイアウト。
- ペイン構成。
- Navigation の視覚表現。
- タブ / セクション / モーダル等の使い分け。
- Editor / Inspector の配置。
- Matrix 内の生成項目一覧を Table / List / Tree 等のどれで表現するか。
- Responsive / resize behavior。
- 共通 Component の切り方。
- loading / transition / animation の表現。
- keyboard shortcut や詳細な操作補助。
- 擬似 Workflow Tree の描画ライブラリや内部実装方式。

ただし、次は変更してはならない。

- Grok と Batch Studio の責務境界。
- Grok Web の手動操作原則。
- Artifact の Draft / Validate / Confirm lifecycle。
- `models.json` / `prompt_plan.json` 等の正式 schema。
- Workflow Compiler の責務。
- Civitai / R2 / ComfyUI の外部連携境界。
- 本書に定義する必須 UX capability。
- Prompt Plan の主表示を、左から右へ展開する擬似 Workflow Tree とすること。
- Prompt Plan の Leaf を主ツリー上へ1件ずつ大量展開せず、Branch ごとの Matrix ノード内へ集約すること。

UI 都合だけで domain schema や責務境界を変更しない。

---

## 3. UX 基本原則

### 3.1 Artifact より工程と次の行動を優先する

内部では `story.md`、`models.json`、`prompt_plan.json` 等の Artifact を管理するが、通常 UI ではユーザーが次を理解できることを優先する。

```text
今どの工程か
↓
次に何をすべきか
↓
必要な入力は揃っているか
↓
何が未完了・要修正か
↓
結果を確認・修正・確定できるか
```

### 3.2 Grok 連携は工程ごとに最適化する

Story / Models / Prompt Plan はすべてユーザーが Grok Web へ手動で入力し、回答を手動で Batch Studio へ戻す。

ただし目的が異なるため、同じ UI をそのまま使い回すことを要件としない。

必要な共通 capability:

- Grok へ渡す依頼内容を Batch Studio が生成できる。
- 必要な添付ファイルをユーザーが把握できる。
- 依頼内容を Clipboard へコピーできる。
- 添付対象の場所を開ける。
- Grok の回答全体を Batch Studio へ貼り付けられる。
- 必要な Markdown / JSON code block 等を回答から抽出できる。
- 工程固有 validation を行える。
- valid / invalid にかかわらず貼り付けた原文を失わない。
- 取り込み結果を Draft として扱える。
- ユーザーが確認した後だけ Confirm できる。

### 3.3 Grok Web はユーザー操作

Batch Studio は次を行わない。

- Grok への自動送信。
- Grok DOM 操作。
- 自動ファイル添付。
- Grok 回答 scraping。
- ログイン自動化。

Batch Studio は「渡すものを準備する」「返ってきたものを取り込む」部分を支援する。

### 3.4 Prompt Plan は ComfyUI に近い擬似 Workflow Tree で理解できること

Prompt Plan は数百〜数千の生成項目を持つ可能性がある。

主表示では大量の Leaf を1件ずつ並べるのではなく、Prompt Plan の意味構造を ComfyUI Workflow に近い擬似ノードツリーとして可視化する。

ツリーの主方向は **左から右** とする。

概念構造:

```text
[共通プロンプト]
      |
      v
[全体共通 LoRA]
      |
      +--------------------+--------------------+
      |                    |                    |
      v                    v                    v
[Branch LoRA b01]    [Branch LoRA b02]    [Branch LoRA b03]
      |                    |                    |
      v                    v                    v
[Matrix 48件]         [Matrix 72件]         [Matrix 36件]
```

実際の画面では接続方向を左から右として表現し、ユーザーが次の流れを一目で追えること。

```text
共通設定
→ 全体共通 LoRA
→ Branch 固有 LoRA
→ Matrix
```

要件:

- 共通プロンプトを独立した擬似ノードとして認識できる。
- 全体共通 LoRA を独立した擬似ノードとして認識できる。
- `prompt_plan.branches[]` ごとにサブツリーとして分岐していることを視覚的に把握できる。
- Branch ごとの LoRA 設定を擬似ノードとして認識できる。
- Branch ごとの Leaf 群を Matrix ノードとして集約表示する。
- Matrix ノードから当該 Branch の生成項目数 / 予定画像枚数を把握できる。
- Leaf を主ツリーへ1件ずつノードとして展開しない。
- Matrix ノードを選択すると、その Matrix に属する生成項目を確認できる。
- Matrix 内の任意の生成項目を選択し、`name` / Positive / Negative を確認・編集できる。
- validation error / warning が存在する場合、どの Branch / Matrix に問題があるかツリー上から把握できる。
- 数百件規模でもツリー全体の俯瞰性を失わない。

この擬似ツリーは Prompt Plan の意味構造を表示するものであり、実際の ComfyUI Workflow JSON を直接表示するものではない。

Prompt Plan UI へ次のような Compiler-owned 実ノードを持ち込まない。

```text
Node ID
Link ID
Reroute
CLIPTextEncode
KSampler
VAEDecode
SceneSaveImage
その他 ComfyUI 内部ノード
```

概念上の分離:

```text
Prompt Plan UI
  共通プロンプト
  全体共通 LoRA
  Branch LoRA
  Matrix
       |
       v
Workflow Compiler
       |
       v
実 ComfyUI Workflow
  Checkpoint
  LoRA Stack
  SceneMatrix
  ScenePrompter
  CLIP Encode
  KSampler
  VAEDecode
  SceneSaveImage
  ...
```

Matrix 内の生成項目一覧や詳細編集をどの UI 技法で表現するかは実装エージェントに任せる。

---

## 4. 日本語 UI 用語

内部 schema / field name は既存の英語名称を維持する。通常 UI の表示のみ日本語化する。

| 内部概念 | 日本語 UI |
| --- | --- |
| Project | プロジェクト |
| Project Brief | 基本設定 |
| Story | ストーリー |
| Models | モデル選定 |
| Prompt Plan | プロンプト設計 |
| Branch | ブランチ |
| Leaf | 生成項目 |
| Matrix | Matrix |
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

`Leaf` は内部用語として維持し、通常 UI では原則「生成項目」と表示する。

v1 は `1 leaf = 1 image` なので、件数と予定画像枚数の関係をユーザーが確認できること。

---

## 5. 主工程

ユーザーが次の工程へアクセスできること。

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

名称方針:

- `Project` ではなく、初期入力工程は `基本設定` と表示する。
- `R2 / Models` ではなく、ユーザー目的を表す `モデル配置` とする。
- `Prompt Tree` を独立した通常工程として設けない。

Navigation の具体的な表示方法は実装エージェントに任せる。

---

## 6. Grok Web 表示要件

Story / Models / Prompt Plan は Grok Web と往復する工程であるため、ユーザーが Batch Studio と Grok Web を効率よく行き来できること。

Workflow / Model Availability / Preflight は Grok を必要としない。

Grok pane の初期表示、サイズ、配置、show/hide の具体的な UX は実装エージェントに任せる。

ただし次を満たすこと。

- Grok Web を必要なときに表示できる。
- Local UI の作業領域を十分確保できる。
- Grok Web を非表示にしても session を不必要に破棄しない。
- 表示切替が Grok DOM の自動操作にならない。

---

## 7. 次に行う操作の提示

各工程では、現在の status 一覧だけでなく、ユーザーが **次に何をすべきか** を判断できること。

表示内容の例:

- Grok でストーリーを検討する必要がある。
- 基盤モデルをユーザーが選択し、Grok のLoRA選定結果を取り込む必要がある。
- モデルが不足しているため catalog 更新が必要。
- Prompt Plan の下書き確認が必要。
- Workflow の再生成が必要。
- Local に不足モデルがある。

具体的な Card / Banner / CTA の表現は固定しない。

---

## 8. 日本語ステータス表示

内部 status は既存値を維持する。

| Internal | 日本語表示 |
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

必要に応じて高レベル表示では簡略化してよい。

色だけに依存せず、文字・アイコン等でも状態を判別できること。

---

## 9. 概要 UX 要件

概要では Artifact のファイル一覧より、プロジェクトの進行状況を優先する。

最低限確認できる情報:

- プロジェクト名。
- 目標画像枚数 / 現在の予定画像枚数。
- 各工程の進捗。
- 現在対応すべき工程。
- Blocking issue。
- Warning。
- 次に行うべき操作。

各問題から該当工程へ移動できることが望ましい。

---

## 10. 基本設定 UX 要件

初期プロジェクト作成時に、細かな Story / Prompt / Model 設計をユーザーへ要求しない。

主要入力:

- プロジェクト名。
- 版権キャラかどうか。
- キャラクター名。
- 出典作品・シリーズ。
- ターゲット読者の特徴。
- 大まかな要望。
- 出さないもの・避けたい方向性。
- 固定前提の確認。

追加設定:

- プロジェクト ID。
- Story 文書形式。
- 目標画像枚数。
- 想定モデル系。
- 目標章数。
- 参考ファイル。

詳細項目の見せ方は実装エージェントに任せるが、初回入力の負荷を過度に増やさないこと。

---

## 11. ストーリー工程 UX 要件

Story は会話・探索型の工程として扱う。

ユーザーは最低限次を行えること。

1. 現在の基本設定を確認する。
2. Grok へ渡す初回依頼内容を生成する。
3. 必要な参考ファイルを確認する。
4. Grok と手動で会話を継続する。
5. Story が決まった後、完成版作成用の依頼内容を生成する。
6. Grok の最終回答を Batch Studio へ貼り付ける。
7. `story.md` candidate を取り込む。
8. 内容を確認・修正する。
9. 下書き保存・履歴確認・確定を行う。
10. 必要なら Story 修正用の依頼内容を再生成する。

通常 UI では JSON Schema / parser 等の技術用語を主役にしない。

---

## 12. モデル選定工程 UX 要件

Models は **ユーザーによる基盤モデル選択 + GrokによるLoRA選定 + Batch Studioによる照合** の工程として扱う。

ユーザーは最低限次を行えること。

1. Model Familyとして Illustrious / Anima を選択する。
2. IllustriousではCheckpoint、AnimaではDiffusion Model / Text Encoder / VAEを選択する。
3. Civitai Catalogのgeneration / generatedAtと必要なModel / Version / File / Base Modelを確認できる。
4. 基盤モデルを保存した後、Grokへ渡すLoRA選定依頼を生成する。
5. `story.md` / ユーザー選択済み基盤モデル / `model_catalog.json` が添付対象であることを確認する。
6. Grokから返された `model_loras.json` をファイルとして取り込む。
7. LoRAごとにModel / Version / File / trainedWords / Civitai基準値 / 選定理由を確認する。
8. `promptFallbacks` と `missingRequirements` を区別して確認する。
9. 未解決 `missingRequirements` がないvalidなModels DraftだけをConfirmできる。
10. 基盤モデル変更時は後段Prompt Plan / Workflowがreset対象になることを理解できる。

### 12.1 Civitai 基準値表示

通常 UI では `observed-usage-derived` 等の内部 enum をそのまま主表示しない。

ユーザーが最低限次を理解できる表示にする。

- Civitai 基準値の有無。
- 値。
- observed data 由来の場合は投稿数。
- 詳細を開けば provenance / method を確認可能。

この値を作者推奨値として誤表示しない。

### 12.2 不足LoRA / 代替解決

Catalogに必要LoRAが無い場合は単なる `not found` error にせず、次の解決手段を区別して示す。

```text
Catalog外のCivitai候補がある
  -> Collectionへ追加
  -> Batch StudioでSYNC
  -> GrokでLoRA再選定

Catalog内の複数LoRAで代替可能
  -> 組合せを選定結果へ反映

Promptだけで代替可能
  -> promptFallbacksとして解決済み

いずれでも解決不能
  -> missingRequirementsとしてBLOCK
```

`missingRequirements` が残る状態で確定操作を有効にしない。

## 13. プロンプト設計工程 UX 要件

Prompt Plan は次の2種類の作業を区別して扱えること。

```text
A. Grok から Prompt Plan を受け取る
B. 受け取った Prompt Plan を擬似 Workflow Tree でレビュー・修正する
```

具体的にタブで分けるか、別画面にするか等は実装エージェントに任せる。

### 13.1 Grok へ渡す前

最低限確認できること。

- Story が確定済みか。
- Models が確定済みか。
- 目標画像枚数。
- 必要添付ファイル。
- Prompt Plan 作成依頼を生成できること。

### 13.2 Grok 結果取り込み

ユーザーは Grok の回答全体を貼り付けられること。

Batch Studio は JSON code block 等から Prompt Plan candidate を抽出できること。

取り込み後に最低限次を表示する。

- JSON として解析できたか。
- Prompt Plan Schema validation 結果。
- semantic validation 結果。
- Branch 数。
- 生成項目数。
- 予定画像枚数。
- target image count との差。
- modelRef error / warning。

解析成功だけで Confirm しない。

### 13.3 Prompt Plan レビュー

Prompt Plan の主レビュー UI は、3.4 の **左から右へ展開する擬似 Workflow Tree** とする。

ユーザーはツリー全体から最低限次を行えること。

- common positive / negative を表す共通プロンプトノードを確認・選択できる。
- Root LoRA を表す全体共通 LoRA ノードを確認・選択できる。
- Branch の分岐構造を視覚的に把握できる。
- Branch label / Branch LoRA を確認できる。
- 各 Branch の末端に対応する Matrix ノードを確認できる。
- Matrix ノードから生成項目数 / 予定画像枚数を把握できる。
- validation error / warning がある Branch / Matrix をツリー上で識別できる。
- Branch ordering を確認・編集できる。

ノード選択後の詳細編集では最低限次を行えること。

共通プロンプトノード:

- common positive / negative の確認・編集。

全体共通 LoRA ノード:

- Root LoRA 一覧の確認。
- 実適用強度の確認・編集。

Branch LoRA ノード:

- Branch label の確認・編集。
- Branch LoRA 一覧の確認。
- 実適用強度の確認・編集。

Matrix ノード:

- 当該 Branch の生成項目一覧を確認できる。
- 目的の生成項目を検索・絞り込みできる。
- Leaf ordering を確認・編集できる。
- validation error / warning 対象へ移動できる。
- 任意の生成項目を選択できる。

生成項目選択後:

- `leaf.id` を確認できる。
- `leaf.name` を確認・編集できる。
- Positive を確認・編集できる。
- Negative を確認・編集できる。

大量Leafは主ツリーへ直接展開しない。

```text
Branch
  -> Matrix
       -> 内部に数十〜数百の生成項目
```

という情報階層を維持する。

Matrix 内部の一覧方式、詳細パネル位置、検索 UI、Leaf reorder UI 等は実装エージェントに任せる。

Draft / Confirm lifecycle は常に維持する。

### 13.4 Prompt Plan 再修正

Grok へ再度修正を依頼できること。

Batch Studio は現在の validation result やユーザーの修正意図を利用して再依頼用内容を生成できること。

具体的なプロンプト本文は本書では定義しない。

---

## 14. LoRA 強度 UX 要件

Root / Branch LoRA の実適用強度を編集できること。

Civitai baseline が存在する場合:

- baseline value を確認できる。
- baselineの根拠を確認できる。
- `strengthModel` / `strengthClip` の現在値を確認・編集できる。
- 現在値が baseline から変更されていることを判別できる。
- baseline へ戻す操作を提供できる。

Civitai baseline が存在しない場合:

- 「基準値なし」であることを明示する。
- Batch Studio が `1.0 / 1.0` や `0.7 / 0.7` を暗黙補完しない。
- 必須の実適用値が未入力なら validation で検出する。

表示方法は実装エージェントに任せる。

---

## 15. Grok Result Import 共通要件

Story / Models / Prompt Plan の内部実装では共通基盤を持ってよい。

概念フロー:

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
↓
User review
↓
Confirm
```

重要要件:

- Grok回答の説明文を含む全文を貼り付け可能。
- candidate抽出失敗時も原文を保持する。
- parse失敗時も原文を保持する。
- invalid result を確定版 Artifact へ直接保存しない。
- 再貼り付け・再解析できる。
- 工程ごとに適切なエラー文言を表示する。

---

## 16. ワークフロー工程 UX 要件

Workflow は Grok 工程ではない。

Grok 用の依頼生成・回答 paste を必須機能として置かない。

ユーザーが最低限確認・実行できること。

- Models status。
- Prompt Plan status。
- Template status。
- Manifest status。
- planned branch count。
- planned image count。
- Workflow compile 実行。
- compile validation result。
- generated branch count。
- unused branch count。
- output Workflow path / filename。
- generated artifact の folder open。

技術的な validation 詳細は必要に応じて確認可能にするが、通常 UI では成功 / Blocking reason を優先する。

---

## 17. モデル配置工程 UX 要件

目的は R2 を操作することではなく、`models.json` が要求するモデル実体が生成環境で利用可能か確認すること。

ユーザーは最低限次を確認できること。

- 必要モデル一覧。
- Local ComfyUI に存在するか。
- R2 に存在するか。
- 使用可能 / 転送必要 / 見つからない等の状態。
- 対象ファイル名。
- 必要なら R2 File Manager を開ける。
- handoff に必要な識別情報をコピーできる。

Batch Studio は v1 で destructive R2 operation を独自実装しない。

具体的な一覧 UI は固定しない。

---

## 18. 実行前チェック UX 要件

最初に技術ログではなく、Project が READY / BLOCKED のどちらかを明確に示す。

最低限確認できること。

- READY / BLOCKED。
- 予定画像枚数。
- Blocking issue の件数と内容。
- Warning の件数と内容。
- 問題が属する工程。
- 問題の工程へ移動する導線。

Blocking と Warning を明確に区別する。

---

## 19. 日本語 Action 文言

英語技術語を通常の主要 Button 文言としてそのまま使わない。

推奨用語:

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

実装エージェントは文脈に応じてより自然な日本語へ変更してよいが、同じ意味の操作で用語が不必要に揺れないようにする。

---

## 20. Empty / Error State 要件

Empty / Error state は状態だけでなく、可能な限り次の行動を示す。

例:

悪い表示:

```text
モデルがありません
```

期待する意味:

```text
まだ基盤モデル / LoRA選定が完了していない
+ Model Familyと基盤モデルを選択する
+ 基盤モデル保存後にGrokへLoRA選定依頼を生成できる
```

解析失敗時:

- 貼り付けた原文を消さない。
- 何を解析できなかったかを示す。
- 再試行または Grok 再修正への導線を持つ。

---

## 21. 日本語 UI 実装上の品質要件

- 重要な Blocking reason を tooltip だけに置かない。
- 色だけに状態判定を依存しない。
- 日本語の長い説明文でも破綻しない。
- 技術用語は必要な詳細表示で確認できるようにし、通常操作では人間向け名称を優先する。
- `strengthBaseline`、`modelRef`、`schemaVersion` 等の内部用語を通常の主要操作ラベルへ露出しすぎない。
- 数百件以上の Prompt Plan でも操作可能な性能を確保する。
- Prompt Plan の主ツリーを左から右へ追跡できること。
- Branch 数が増えても共通部分と各 Branch / Matrix の関係を把握できること。
- destructive / confirm action は誤操作しにくくする。
- Draft と Confirmed の違いをユーザーが認識できること。

---

## 22. 本書で扱わないもの

次は別文書が正本であり、本 UX 文書では詳細定義しない。

- Prompt Plan 擬似 Workflow Tree 以外の個別画面レイアウト。
- Component hierarchy。
- Matrix 内部の Table / List / Tree 等の具体的 UI 技法。
- Modal / Drawer / Inspector 等の採否。
- 擬似 Workflow Tree の描画ライブラリ / 実装技術。
- CSS / Design System / color / typography の詳細。
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

## 23. 実装時の受入方針

実装エージェントが選んだ画面構成そのものではなく、各工程で本書の capability が満たされているかを評価する。

特に次を受入基準とする。

1. ユーザーが次に何をすべきか判断できる。
2. Grokとの手動往復がStory / LoRA Selection / Prompt Planそれぞれで成立する。
3. Grokから受け取った内容を直接確定せず Draft / Validation / Confirm を経由する。
4. 不足モデル等のBlocking状態から解決方法を理解できる。
5. Prompt Plan が左から右へ展開する擬似 Workflow Tree として表示される。
6. 共通プロンプト → 全体共通 LoRA → Branch LoRA → Matrix の関係を視覚的に追跡できる。
7. 数百件の Leaf を主ツリーへ直接展開せず Matrix 内へ集約している。
8. Matrix を選択して内部の生成項目を確認でき、各生成項目の Positive / Negative を確認・修正できる。
9. validation error / warning の属する Branch / Matrix をツリーから把握できる。
10. Civitai baselineとProject実適用strengthを混同しない。
11. Workflow工程でGrokにWorkflow JSONを生成させない。
12. Model Availability / PreflightでREADY/BLOCKED理由を追跡できる。
13. UI都合で正式schemaや責務境界を変更していない。
14. 通常操作が日本語で理解できる。
