# Grok Web Contract

Status: Active

## 1. 目的

Batch Studio と Grok Web の責務境界、各工程で Grok に渡す入力、Grok から受け取る成果物を定義する。

本書における「送信」は、Batch Studio が用意した内容をユーザーが Grok Web へ貼り付け・添付して送る操作を指す。Batch Studio が Grok を自動操作する意味ではない。

## 2. 共通原則

### 2.1 User-operated Web

- ユーザーが自分の Grok アカウントへログインする。
- Batch Studio はプロンプトを Clipboard へ準備する。
- ユーザーが必要ファイルを手動添付する。
- ユーザーが送信・会話継続を行う。
- 最終成果物をユーザーが Batch Studio へ貼り戻す。

### 2.2 Grok output is Draft

Grok の回答を自動的に正本へ保存しない。

```text
Grok answer
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

## 3. Prompt Composition

工程別依頼は原則として次の順に組み立てる。

```text
1. Task / expected artifact
2. Constraints
3. Project context
4. User additions
5. Attached files
6. Output format
```

大きい入力は本文へ全展開せず添付を優先する。

## 4. Story Contract

### 4.1 Input

- `project_brief.json` 相当の入力
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

### 4.3 Final Story output

ユーザーが案を選び調整した後、完成 `story.md` を Markdown code block で返すよう依頼する。

Batch Studio は本文を取り込み、検証して Draft とする。

## 5. Model Selection Contract

### 5.1 Model selection owner

モデル選定主体は Grok である。

Batch Studio は「カタログ候補を手動選択する UI」を正本の選定経路としない。

### 5.2 Input

Grok に次を渡す。

- 確定済み `story.md`
- `civit-model-viewer` が生成した `model_catalog.json`
- 必要に応じたプロジェクト制約

`model_catalog.json` はファイル添付を基本とする。

### 5.3 Grok duties

Grok は Story を満たすために、カタログ中から次を選定する。

- Checkpoint
- Character LoRA
- Pose / Situation / Concept / Style 等の LoRA
- 使用する Version
- 使用する実ファイル
- trained words / trigger words の利用方針
- 各モデルの採用理由
- 必要に応じた LoRA weight の提案

### 5.4 Catalog is authoritative

カタログにない Model / Version / File を「存在する選定済みモデル」として捏造しない。

Story 実現に必要だが catalog に存在しない場合は、例として次のような不足要件として分離する。

```json
{
  "missingRequirements": [
    {
      "role": "pose",
      "requirement": "必要なLoRAの用途説明",
      "reason": "Story上の必要性"
    }
  ]
}
```

不足モデルはユーザーが Civitai collection 側へ追加し、`civit-model-viewer` を SYNC してから再選定できる。

### 5.5 Output

Grok の最終モデル選定は JSON code block で返す。

保存形式は `project-artifacts.md` の `models.json` Draft schema に従う。

Batch Studio が current `model_catalog.json` と照合した後に確定可能となる。

## 6. Prompt Planning Contract

### 6.1 Purpose

Grok は ComfyUI Workflow を作らない。

Grok が作るのは Workflow Compiler に必要な**意味情報**である。

### 6.2 Input

- 確定 `story.md`
- 確定 `models.json`
- Prompt 設計上のルール
- 任意の参考 Prompt Tree
- ユーザーの追加入力

Workflow Template JSON 自体は原則 Grok へ渡さない。Grok に Template の内部構造を理解させる必要がないためである。

### 6.3 Grok duties

Grok は次を決める。

- プロジェクト共通 positive / negative prompt。
- 全枝共通で使用する Root LoRA。
- 必要な Branch 数。
- 各 Branch の意味・label。
- 各 Branch で使用する LoRA。
- 各 Branch に属する leaf prompts。
- leaf ごとの positive / negative 差分。

### 6.4 Grok must not output

- Workflow JSON
- ComfyUI node ID
- link ID
- group ID
- node position
- `mode` / bypass
- `widgets_values`
- `scene_matrix_json`
- `SCENE_MATRIX_LINE` の Compiler-owned boilerplate
- Save node path widget
- KSampler internal values

### 6.5 Output

JSON code block で `prompt_plan.json` 相当を返す。

意味 schema は `prompt-plan.md` を正本とする。

## 7. Manual Attachment Checklist

左ペインには工程別に次のようなチェックを表示できる。

```text
[ ] 添付対象を確認
[ ] フォルダを開く
[ ] Grok Web で必要ファイルを添付
[ ] プロンプトをコピーして貼り付け
[ ] Grok との会話を完了
[ ] 最終 code block を Batch Studio へ貼り戻す
[ ] 検証結果を確認
[ ] 成果物を確定
```

## 8. Error Handling

### 8.1 Grok output parse failure

JSON / Markdown を取り込めない場合、原文を消さず Draft として保持し、parse error を表示する。

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
