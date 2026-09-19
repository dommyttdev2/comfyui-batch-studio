# Grok Web Contract

Status: Active

## 1. 目的

Batch Studio と Grok Web の責務境界、各工程で Grok に渡す入力、Grok から受け取る成果物を定義する。

本書における「送信」は、Batch Studio が用意した内容をユーザーが Grok Web へ貼り付け・添付して送る操作を指す。Batch Studio が Grok を自動操作する意味ではない。

最終 Artifact は可能な限りチャット本文へ展開せずファイルとして受け取る。大きな JSON / Markdown を会話本文へ再掲しないことで、Grok 側の会話コンテキスト消費を抑える。

## 2. 共通原則

### 2.1 User-operated Web

- ユーザーが自分の Grok アカウントへログインする。
- Batch Studio はプロンプトを Clipboard へ準備する。
- ユーザーが必要ファイルを手動添付する。
- ユーザーが送信・会話継続を行う。
- 最終成果物ファイルを Grok から取得し、その内容を Batch Studio へ取り込む。

### 2.2 Grok output is Draft

Grok の回答を自動的に正本へ保存しない。

```text
Grok artifact file
   -> Draft
   -> Batch Studio validation
   -> User review
   -> Explicit confirm
   -> Project artifact
```

### 2.3 添付禁止

次は Grok 添付候補へ出さない。

- `.env`
- API key / token / credential
- R2 secret / configuration
- browser profile / Cookie
- model binary (`.safetensors` 等)
- アプリ内部の秘密情報

### 2.4 Final artifact file envelope

Grok が Batch Studio へ戻す最終 Artifact を生成する工程では、出力境界を固定する。

- 最終成果物は工程ごとに指定された名前の**ダウンロード可能なファイル**として生成・添付する。
- 成果物の内容をチャット本文、code block、引用、要約へ再掲しない。
- チャット本文には説明、挨拶、要約、注意書き、補足等の成果物外テキストを付けない。
- ファイルは UTF-8 のプレーンテキストとする。
- 指定された Markdown 見出しまたは JSON field 以外を追加しない。
- JSON は厳密に parse 可能とし、コメント、末尾カンマ、擬似値を含めない。
- 修正依頼の場合も同じ file envelope と同じファイル名を維持する。

この規則は次の最終出力に適用する。

```text
story.md
models.json
prompt_plan.json
```

Story の初回検討のような対話用回答は Project Artifact ではないため、この file envelope の対象外とする。

## 3. Prompt Composition

工程別依頼は原則として次の順に組み立てる。

```text
1. Task / expected artifact
2. Constraints
3. Project context
4. User additions
5. Attached files
6. Output format / output filename
```

大きい入力は本文へ全展開せず添付を優先する。大きい最終出力も本文へ全展開せず、ファイル出力を優先する。

## 4. Story Contract

### 4.1 Input

- `project_brief.json`
- プロジェクト名
- 版権キャラか
- キャラクター名
- 出典作品（任意）
- ターゲット読者の特徴
- 大まかな要望
- 除外方向
- 目標画像枚数
- 任意参考資料

### 4.2 First conversation

完成版を一度で要求せず、まず次を求める。

1. 調査・前提整理。
2. 大まかな Story 案を複数提示。
3. 各案の画像化しやすさ・特徴。
4. ユーザーが決めるべき点や不足情報。

版権キャラクターの場合は公開情報を調査し、不確かな設定を推測で確定しないよう要求する。

検討回答は次の見出し順を基本とする。

```markdown
# 調査・前提
# Story案
## 案A: ...
## 案B: ...
# 確認事項
```

これは会話用回答であり、Project Artifact として直接取り込まない。

### 4.3 Final Story output

ユーザーが案を選び調整した後、完成 `story.md` を **`story.md` という名前のダウンロード可能なファイル**として返すよう依頼する。本文へ `story.md` の内容を再掲しない。

`story.md` の最上位構造を次で固定する。

```markdown
# <作品タイトル>

## 作品コンセプト
## 登場人物
## 共通設定
## 全体進行
## シーン構成
### Scene 1: <短い場面名>
### Scene 2: <短い場面名>
## 生成上の一貫性メモ
```

各 Scene は少なくとも次の観点を持つ。

```text
目的
状況・場所
登場人物の状態
主な出来事
視覚的に重要な要素
次シーンへの変化
```

`story.md` には Prompt Plan、LoRA / Checkpoint 選定、ComfyUI node情報、個別画像の positive / negative prompt を含めない。

Batch Studio はファイル内容を取り込み、検証して Draft とする。

## 5. Model / LoRA Selection Contract

### 5.1 Ownership

Model Familyと基盤モデルはユーザーがBatch Studio UIで選択する。Grokはユーザー選択済みの基盤モデルを変更・再選定しない。

```text
Illustrious: User -> Checkpoint
Anima:       User -> Diffusion Model + Text Encoder + VAE
Grok:        -> LoRA selection only
```

### 5.2 Input

Grok のLoRA選定へ次を渡す。

- 確定済み `story.md`
- ユーザー選択済み基盤モデルを含む `models.json` Draft/Confirmed
- Batch Studioが同期したapp-wide `model_catalog.json`
- 必要に応じたプロジェクト制約

`model_catalog.json` と `models.json` はファイル添付を基本とする。

### 5.3 Grok duties

GrokはStoryと選択済みModel Familyに従って必要なLoRAだけを選定する。

- Character / Pose / Situation / Concept / Style等のLoRA
- 使用するVersion / File
- `trainedWords` の利用方針
- 各LoRAの採用理由
- Prompt Planで使用する実適用strengthの判断材料

`checkpoint` / `diffusionModel` / `textEncoder` / `clip` / `vae` / `modelFamily` を出力してはならない。Batch Studioはこれらを含むGrok返却を拒否する。

### 5.4 Missing / fallback resolution

Catalogに必要LoRAが無い場合、直ちに架空identityや `missingRequirements` を作らず、次の順で解決可能性を評価する。

1. `civitai.com` / `civitai.red` の公開情報から代替候補を調査する。
2. 複数のCatalog内LoRAを組み合わせて実現可能か確認する。
3. Danbooru系Promptだけで十分に代替可能か判断する。
4. Prompt代替できる場合は `promptFallbacks` として解決済みにする。
5. 外部候補は見つかったがCatalog未登録、または代替不能の場合だけ `missingRequirements` に残す。

`missingRequirements` が残る場合はユーザーがCivitai Collectionへ必要候補を追加し、Batch StudioでCatalog SYNC後に再選定する。

### 5.5 Output

Grokの返却ファイル名は **`model_loras.json`** とする。本文へ同じJSONを再掲しない。

最低shape:

```json
{
  "schemaVersion": 1,
  "loras": [],
  "promptFallbacks": [
    {
      "requirement": "camera angle",
      "positiveTags": ["from_below"],
      "negativeTags": [],
      "reason": "Promptだけで十分に代替可能"
    }
  ],
  "missingRequirements": []
}
```

`promptFallbacks` / `missingRequirements` は必要な場合だけ出力してよい。Batch Studioは `loras[]` をユーザー選択済み基盤モデルへmergeしてModels Draftを作る。

- unresolved `missingRequirements` が1件でもあればConfirm不可。
- `promptFallbacks` は確定 `models.json` へ残さず、`._batch_studio/model_prompt_fallbacks.json` に分離保存する。
- Prompt fallbackはcategoryを持たず、`positiveTags[]` / `negativeTags[]` の1要素1tagで保存する。最終categoryへの配置はPrompt Planning工程が担当する。
- Legacyの `positive` / `negative` comma stringは互換読み取り時にtag arrayへnormalizeできる。
- current `model_catalog.json` とidentity照合できたLoRAだけ確定可能。
- Model Familyに応じたPrompt dialectを守り、`trainedWords` はCatalog文字列を勝手に変換しない。

## 6. Prompt Planning Contract

### 6.1 Purpose

Grok は ComfyUI Workflow や最終Prompt文字列を作らない。

Grok が作るのは Workflow Compiler に必要な **Schema v2の構造化意味情報** である。

### 6.2 Input

- 確定 `story.md`
- 確定 `models.json`
- `project_brief.json` の目標画像枚数等の計画条件
- 必要に応じて `._batch_studio/model_prompt_fallbacks.json`
- Prompt設計上のルール
- ユーザーの追加入力

新規プロジェクトの `prompt_tree.md` は入力にしない。Workflow Template JSON自体も原則Grokへ渡さない。

### 6.3 Grok duties

Grok は次を決める。

- `common` に置く全画像不変tag。
- `branch.prompt` に置くBranch内不変tag。
- `leaf.prompt` に置く画像固有差分tag。
- Positive / Negative の意味category。
- Cameraの `pov / angle / framing / gaze / focus` 分類。
- 全枝共通で使用する Root LoRA。
- Branch分割と各BranchのLoRA。
- Leaf数と生成順。
- Root / Branch LoRA の実適用 `strengthModel` / `strengthClip`。
- Prompt fallback tagのStory上適切なscope/categoryへの配置。
- LoRAごとのtrigger候補の要否と適用scope（Common / Branch / Leaf）。

親scopeに存在するtagを子scopeへ再掲しない。

途中で変化する衣装、状態、場所を `common` へ置かない。

`models.json` に `strengthBaseline.value = w` があり、その値を初期値として採用する場合は `strengthModel=w` / `strengthClip=w` と展開する。baselineが無い場合は暗黙defaultで埋めない。

### 6.4 Prompt category

Positive:

```text
subject
identity
appearance
style
outfit
expression
action
pose
camera
environment
lighting
effects
```

Camera:

```text
pov
angle
framing
gaze
focus
```

Negative:

```text
anatomy
identity
appearance
subject
outfit
action
camera
environment
artifacts
content
```

1 array element は1tagだけを持つ。

Illustriousの通常tagはunderscore form、Animaはspace formとする。

### 6.5 Trigger word selection

`models.json.trainedWords` はGrokが選択するための候補一覧であり、全件をPrompt Planへ転記することを要求しない。

新規Prompt Planには `"triggerWordsMode": "selected"` を設定する。
GrokはCommon / Branch / Leafの `triggerWords` に `{ "modelRef": "...", "words": ["..."] }` を記録する。候補からの選択が不要なら空配列または省略とする。

- modelRefはそのscopeで実際に適用可能なBase Model / LoRAを参照する。
- wordは選定モデルの `trainedWords` にある文字列と完全一致させる。通常Danbooru dialect制約の対象外。
- 全画像に必要なものだけをCommonに置き、衣装・シーン固有のものはBranch / Leafで選ぶ。
- LoRAを使用してもトリガーワードを選択しない判断を許容する。
- CompilerはGrokが選んだ候補だけを展開し、未選択候補を自動追加しない。

既存 `triggerWordsMode` 未指定のSchema v2は、旧方式で作られたProjectの互換性のためだけに従来の自動注入でCompileする。

### 6.6 Batch Studio-owned Prompt policy

Grokは次を出力しない。

- Model Family quality preset。
- compile order。
- exact dedupe rule。
- 最終positive / negative string。
- Workflow JSON。
- ComfyUI node / link / group ID。
- node position。
- `mode` / bypass。
- `widgets_values`。
- `scene_matrix_json`。
- `positive_base` / `negative_base`。
- Save node path。
- KSampler内部値。

これらはBatch Studioが所有する。

### 6.7 Output

**`prompt_plan.json` という名前のダウンロード可能なJSONファイル**としてSchema v2 Prompt Planを返す。JSON本文をチャット本文やcode blockへ再掲しない。

最小shape:

```json
{
  "schemaVersion": 2,
  "common": {
    "positive": {},
    "negative": {}
  },
  "rootLoras": [],
  "branches": [
    {
      "id": "b01",
      "label": "Example",
      "loras": [],
      "leaves": [
        {
          "id": "s1-01-c1",
          "name": "S1-01_C1_example",
          "prompt": {
            "positive": {},
            "negative": {}
          }
        }
      ]
    }
  ]
}
```

意味schemaは `prompt-plan.md` および `schemas/prompt-plan.schema.json` を正本とする。

未知fieldを追加しない。

既存Schema v1はBatch Studio側で読み取り・Compile互換を維持するが、新規Grok出力はSchema v2とする。

## 7. Manual Attachment Checklist

Local UI では工程別に次の操作を支援する。

```text
[ ] 添付対象を確認
[ ] 添付ファイルの場所を開く
[ ] Grok Web で必要ファイルを添付
[ ] プロンプトをコピーして貼り付け
[ ] Grok との会話を完了
[ ] 最終成果物ファイルを Grok から取得
[ ] ファイル内容を Batch Studio へ取り込む
[ ] 検証結果を確認
[ ] 成果物を確定
```

## 8. Error Handling

### 8.1 Grok output parse failure

Grok が生成した JSON / Markdown ファイルの内容を取り込めない場合、原文を消さず Draft として保持し、parse error を表示する。

### 8.2 Unknown model selection

catalog に存在しない選定項目は自動修正しない。

- typo の可能性を表示。
- Grok へ再確認するための prompt を準備可能。
- ユーザー承認だけで架空の catalog identity を作らない。

### 8.3 Prompt plan invalid reference

`models.json` に存在しない LoRA 参照を検出した場合は Workflow Compile を block する。

## 9. 将来拡張時の原則

将来 xAI API 等の別経路を追加する場合でも、以下の semantic contract は維持する。

```text
Story generation
Model selection
Prompt planning
```

transport が Web manual operation から API に変わっても、Workflow Compiler に ComfyUI 内部形式を生成させる責務分離は崩さない。
