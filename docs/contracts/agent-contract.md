# AI Agent Contract

Status: Active

## 1. 目的

Batch Studio と AI agent（Grok CLI / Codex CLI）の責務境界、各工程へ渡す入力、agent から受け取る成果物を定義する。

AI連携のtransportは、Electron内の共通 `AssistantPane` と Main Process の provider adapter / task runner が所有する。Grok Webの埋め込み、Clipboard経由の手動送信、Codex App Serverは現行transportでは使用しない。

意味上の契約はproviderに依存しない。同じStory / LoRA selection / Prompt Planning契約をGrokとCodexへ渡し、provider固有差分はCLI adapterに閉じ込める。

## 2. 共通原則

### 2.1 CLI session

- ユーザーが選択したproviderをProject × stage単位で保持する。
- 通常会話は `AssistantPane` から共通session APIで開始・継続・中断する。
- 工程成果物の生成・修正・再実行は左側の工程UIから共通task APIで開始する。
- provider session IDは `AgentSessionStateStore` がProject × stage × provider単位で保持する。
- 会話表示用の安全なuser/assistant本文は `AgentConversationStore` が保持する。
- raw reasoning本文はUIへ表示・保存しない。

### 2.2 Agent output is Draft

AI agent の成果物を自動的に正本へ確定しない。

```text
CLI workspace output
   -> Batch Studio import
   -> Draft
   -> Batch Studio validation
   -> User review
   -> Explicit confirm
   -> Project artifact
```

### 2.3 Secret / input boundary

agent workspaceへ渡さないもの:

- `.env`
- API key / token / credential
- R2 secret / configuration
- browser profile / Cookie
- SSH private key
- model binary（`.safetensors` 等）
- アプリ内部の秘密情報

工程taskに必要な参照ファイルだけを隔離workspaceの `input/` へコピーする。

### 2.4 File artifact envelope

Project Artifactを生成する工程では、Batch Studioがproviderごとに隔離workspaceを作成する。

```text
workspace/
├─ input/     # read-only semantic inputs
└─ output/    # agentが完成成果物だけを書き込む
```

agentは指定された `output/<filename>` へUTF-8プレーンテキストとして成果物を書き込む。Project本体や `input/` を直接変更しない。

適用対象:

- `story.md`
- `model_loras.json`
- `prompt_plan.json`
- `prompt_plan_patch.json`
- `caption_content.json`

JSONは厳密にparse可能とし、コメント・末尾カンマ・擬似値を含めない。Story初回検討のような通常会話は成果物workspaceの対象外とする。

### 2.5 Provider capability

model / reasoning strength UIはprovider adapterが公開するcapabilityに基づいて表示する。

- Grok: Grok CLIが公開するmodel catalogを使用する。
- Codex: `codex debug models` のJSON catalogを使用する。
- 選択値は `AgentModelSelectionStore` にProject × stage × provider単位で保存する。
- 選択不可model / reasoning effortは保存前に拒否する。

## 3. Prompt Composition

工程別依頼は原則として次の順に組み立てる。

```text
1. Task / expected artifact
2. Constraints
3. Project context
4. User additions
5. Workspace input references
6. Output contract / output filename
```

大きい入力はprompt本文へ全展開せず `input/` の参照ファイルとして渡す。大きい成果物もチャット本文へ再掲させず `output/` へ書かせる。

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
2. 大まかなStory案を複数提示。
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

これは通常会話であり、Project Artifactとして直接取り込まない。

### 4.3 Final Story output

ユーザーが案を選び調整した後、完成 `story.md` をworkspaceの `output/story.md` へ書き込む。

最上位構造:

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

各Sceneは少なくとも、目的、状況・場所、登場人物の状態、主な出来事、視覚的に重要な要素、次シーンへの変化を持つ。

`story.md` にはPrompt Plan、LoRA / Checkpoint選定、ComfyUI node情報、個別画像のpositive / negative promptを含めない。

## 5. Model / LoRA Selection Contract

### 5.1 Ownership

Model Familyと基盤モデルはユーザーがBatch Studio UIで選択する。AI agentはユーザー選択済みの基盤モデルを変更・再選定しない。

```text
Illustrious: User -> Checkpoint
Anima:       User -> Diffusion Model + Text Encoder + VAE
AI agent:    -> LoRA selection only
```

### 5.2 Input

- 確定済み `story.md`
- ユーザー選択済み基盤モデルを含む `models.json` Draft/Confirmed
- Batch Studioが同期したapp-wide `model_catalog.json`
- 必要に応じたプロジェクト制約

参照ファイルはworkspace `input/` から読み取る。

### 5.3 Agent duties

Storyと選択済みModel Familyに従って必要なLoRAだけを選定する。

- Character / Pose / Situation / Concept / Style等のLoRA
- 使用するVersion / File
- `trainedWords` の利用方針
- 各LoRAの採用理由
- Prompt Planで使用する実適用strengthの判断材料

`checkpoint` / `diffusionModel` / `textEncoder` / `clip` / `vae` / `modelFamily` を出力してはならない。Batch Studioはこれらを含む返却を拒否する。

### 5.4 Missing / fallback resolution

Catalogに必要LoRAが無い場合は次の順で解決可能性を評価する。

1. `civitai.com` / `civitai.red` の公開情報から代替候補を調査する。
2. 複数のCatalog内LoRAを組み合わせて実現可能か確認する。
3. Danbooru系Promptだけで十分に代替可能か判断する。
4. Prompt代替できる場合は `promptFallbacks` として解決済みにする。
5. 外部候補は見つかったがCatalog未登録、または代替不能の場合だけ `missingRequirements` に残す。

### 5.5 Output

`output/model_loras.json` へ次のshapeで書き込む。

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

- unresolved `missingRequirements` が1件でもあればConfirm不可。
- `promptFallbacks` は確定 `models.json` へ残さず、`._batch_studio/model_prompt_fallbacks.json` へ分離保存する。
- current `model_catalog.json` とidentity照合できたLoRAだけ確定可能。
- Model Familyに応じたPrompt dialectを守り、`trainedWords` はCatalog文字列を変更しない。

## 6. Prompt Planning Contract

### 6.1 Purpose

AI agentはComfyUI Workflowや最終Prompt文字列を作らない。Workflow Compilerに必要なSchema v2の構造化意味情報を作る。

### 6.2 Input

- 確定 `story.md`
- 確定 `models.json`
- `project_brief.json` の目標画像枚数等の計画条件
- 必要に応じて `._batch_studio/model_prompt_fallbacks.json`
- Prompt設計上のルール
- ユーザーの追加入力

Workflow Template JSON自体は原則agentへ渡さない。

### 6.3 Agent duties

- `common` に置く全画像不変tag。
- `branch.prompt` に置くBranch内不変tag。
- `leaf.prompt` に置く画像固有差分tag。
- Positive / Negative の意味category。
- Cameraの `pov / angle / framing / gaze / focus` 分類。
- 全枝共通で使用するRoot LoRA。
- Branch分割と各BranchのLoRA。
- Leaf数と生成順。
- Root / Branch LoRA の実適用 `strengthModel` / `strengthClip`。
- Prompt fallback tagの適切なscope/category。
- LoRAごとのtrigger候補の要否と適用scope。

親scopeに存在するtagを子scopeへ再掲しない。途中で変化する衣装、状態、場所を `common` へ置かない。

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

1 array elementは1tagだけを持つ。Illustriousの通常tagはunderscore form、Animaはspace formとする。

### 6.5 Trigger word selection

`models.json.trainedWords` は候補一覧であり、全件をPrompt Planへ転記しない。

新規Prompt Planには `"triggerWordsMode": "selected"` を設定する。Common / Branch / Leafの `triggerWords` に `{ "modelRef": "...", "words": ["..."] }` を記録する。選択不要なら空配列または省略を許可する。

Compilerは選択された候補だけを展開し、未選択候補を自動追加しない。

### 6.6 Batch Studio-owned Prompt policy

AI agentは次を出力しない。

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

### 6.7 Output

`output/prompt_plan.json` へSchema v2 Prompt Planを書き込む。

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

意味schemaは `prompt-plan.md` と `schemas/prompt-plan.schema.json` を正本とする。未知fieldを追加しない。

### 6.8 Partial revision

Prompt Planの部分修正は `output/prompt_plan_patch.json` を使う。

- 現在のPrompt Plan SHA-256を `baseSha256` に入れる。
- `before` は現在値と完全一致させる。
- Common / Branch / Leafの許可された配列pathだけを変更する。
- Batch Studioはhash / before / schemaを検証してDraftへ原子的に適用する。
- stale hashや対象不一致では既存Draftを変更しない。

## 7. Caption Contract

agentは `output/caption_content.json` を生成する。

- schemaVersion 2。
- `title: { ja, en }`
- `description: { ja, en }`
- optional `contents`
- `pixivTitle: { ja, en }`
- Pixiv用タイトルは各32文字以内。
- 実画像枚数はagentが推測しない。Batch Studioが最終成果物directoryを数える。
- Batch Studioが定型注意書きと枚数を最終 `caption.txt` へ合成する。

## 8. UI / Operation Contract

### 8.1 AssistantPane

右Paneはprovider-neutralな `AssistantPane` 1つだけを表示する。

- provider切替。
- conversation history。
- new conversation。
- streaming answer。
- activity / tool / file status。
- capabilityに応じたmodel / reasoning設定。
- stop current conversation turn。

工程成果物の生成・修正・再実行ボタンは置かない。

### 8.2 Stage task controls

左工程UIが工程taskを所有する。

```text
Stage UI
  -> assistant.startTask(...)
  -> selected provider CLI task runner
  -> isolated workspace
  -> validation/import
  -> Draft
```

中断は `assistant.stopTask(...)` を使用する。

### 8.3 Manual fallback

CLIが成果物を生成できない場合に備え、工程UIはユーザーが成果物ファイルを選択・解析・取り込めるprovider-neutralなmanual fallbackを維持する。

## 9. Error Handling

- CLI未導入 / 未認証 / unsupported versionはavailabilityとして明示し、偽装成功しない。
- model catalog取得失敗時はモデル設定UIを利用不可として扱う。
- session resume ID不一致は新sessionとして黙って継続せずエラーにする。
- JSON / Markdown成果物がinvalidなら原文を保存し、既存Draftを上書きしない。
- catalogに存在しないmodel identityを自動修正・捏造しない。
- `models.json` に存在しないLoRA参照があるPrompt PlanはWorkflow Compileをblockする。
- cancelled turnの不完全なworkspace outputはimportしない。

## 10. 将来拡張

新しいproviderやAPI transportを追加しても、`AgentCliAdapter` / common event / session / workspace contractへ適合させる。

維持するsemantic contract:

```text
Story generation
Model selection
Prompt planning
Caption generation
```

provider追加を理由にWorkflow CompilerへComfyUI内部形式生成の責務を移さない。
