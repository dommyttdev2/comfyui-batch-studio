# Project Initialization / Story Brief

Status: Active

## 1. 目的

新規プロジェクト画面は、ユーザーに細かな Story 設計を入力させる画面にしない。

ユーザーは「誰を対象に、どのような読者向けの作品を作りたいか」と最低限の制約だけを入力する。人物詳細、舞台、章構成、衣装推移、カメラ設計等は Grok が提案し、ユーザーとの会話で `story.md` にまとめる。

初期入力は `project_brief.json` に保存する。

## 2. v1 の保存構造

```json
{
  "schemaVersion": 1,
  "project": {
    "id": "15_example",
    "title": "Example project"
  },
  "subject": {
    "copyrightedCharacter": true,
    "characterName": "Character Name",
    "series": "Source Work"
  },
  "audience": "求める体験・関係性・視覚要素など",
  "request": "大まかな要望",
  "exclusions": "避けたい方向性",
  "assumptions": {
    "adultCharacters": true,
    "consensual": true
  },
  "generation": {
    "target_image_count": 500,
    "modelFamily": "Illustrious"
  },
  "references": []
}
```

実装・Grok連携・validationはこの field 名を使用する。

## 3. 初期画面で入力するもの

### 3.1 必須

- プロジェクト名 `project.title`
- プロジェクトID `project.id`。通常はタイトルから自動生成する
- 版権キャラクターか `subject.copyrightedCharacter`
- 版権キャラクターの場合のキャラクター名 `subject.characterName`
- ターゲット読者の特徴 `audience`
- 成人前提 `assumptions.adultCharacters = true`
- 合意前提 `assumptions.consensual = true`
- 正整数の目標画像枚数 `generation.target_image_count`

### 3.2 任意

- 出典作品・シリーズ `subject.series`
- 大まかな要望 `request`
- 出さないもの・避けたい方向性 `exclusions`
- 参考ファイル情報 `references`
- 想定モデル系 `generation.modelFamily`

初期画面を Story Editor 化しない。章、衣装、カメラ、LoRA、個別Prompt等はここでは入力させない。

## 4. プロジェクト名とID

### 4.1 `project.title`

人間向け表示名であり、後から変更可能とする。Workflow filenameや生成物保存先のfilesystem identityには直接使用しない。

### 4.2 `project.id`

Project内のstable filesystem identityである。

正式形式:

```regex
^[a-z0-9][a-z0-9._-]{0,63}$
```

原則:

- 1〜64文字。
- 先頭は小文字英数字。
- 以降は小文字英数字、`.`、`_`、`-` を許可する。
- 数字開始を許可する。
- Workflow filename `LoRA_{project.id}.json` の派生元とする。
- 保存先 `BatchStudio/{project.id}/{branch.id}` の派生元とする。
- Project作成後は表示名を変更しても自動変更しない。
- 既存Projectの設定画面から変更しない。

### 4.3 自動生成

新規作成画面ではユーザーにID入力を必須作業として要求しない。

タイトル変更時、ユーザーがIDを手動編集していない限り候補を自動更新する。

- ASCII英数字を含むタイトルは、小文字化し、使用不能文字を `-` に整理して候補を作る。
- 日本語等でfilesystem-safe文字列を直接作れない場合は、決定論的な `project-<hash>` 候補を作る。
- ユーザーは必要ならIDを手動編集できる。
- 「自動生成」でタイトル由来候補へ戻せる。
- 同じIDの非空Project directoryが既に存在する場合は作成を拒否し、既存Projectを暗黙上書きしない。

## 5. キャラクター

### 5.1 `subject.copyrightedCharacter`

版権キャラクターかどうかをbooleanで保持する。

版権キャラクターの場合、GrokのStory検討では公開情報を調査し、不確かな設定を推測で確定しないよう依頼する。

### 5.2 `subject.characterName`

`copyrightedCharacter = true` の場合は必須。オリジナルキャラクターでは空欄を許容する。

### 5.3 `subject.series`

同名キャラクター等の誤認を減らすための任意情報。

## 6. ターゲット・要望・除外

### 6.1 `audience`

必須の複数行テキスト。

年齢等の属性入力ではなく、作品に求める体験を記述する。例として、好む関係性・主導権、感情・雰囲気、キャラクターの魅力、視覚要素、避けたい方向性等を表現できる。

### 6.2 `request`

任意の自由記述。テーマ、関係性、場所、場面等の大まかな希望を入れる。空欄ならGrokが複数案を提案できる。

### 6.3 `exclusions`

任意の自由記述。キャラクター、衣装、場所、構図、トーン等の除外条件を入れる。

## 7. 成人・合意の固定前提

```json
{
  "assumptions": {
    "adultCharacters": true,
    "consensual": true
  }
}
```

新規作成時の初期値は両方 `false` とし、ユーザーの明示操作なしに確認済み扱いにしない。

現在のUIでは1つの確認操作で両値を同時にtrue/falseへ設定する。両方がtrueでない場合はProject作成をBlockする。

## 8. 目標画像枚数

`generation.target_image_count` は1以上の整数とする。

これは厳密なCompile枚数指定ではなく、Story / Prompt Planningで目標とする画像枚数である。

```text
target_image_count = 500
       -> Grokへ500 leaf程度を目標として提示
       -> prompt_plan.json
       -> actualImageCount = total leaf count
```

v1では `1 leaf = 1 image`。実生成予定枚数の正本は確定 `prompt_plan.json` のleaf総数である。

目標値との差分はWarning/Informationalとして表示できるが、その差分だけではPrompt Plan確定やWorkflow CompileをBlockしない。

## 9. 初期画面では入力させないもの

- 外見 anchor / invariant / 詳細衣装。
- 性格 / 口調 / 物語上の役割。
- 相手役 / 人物関係 / 主導権の詳細。
- 舞台一覧。
- 開始・終了状態。
- 状態遷移。
- 章 / scene 構成。
- camera / viewpoint 原則。
- 衣装推移。
- 詳細 Prompt 設計。
- 使用 Checkpoint / LoRA。
- Workflow内部設定。

これらは後続の Grok Story / Model Selection / Prompt Planning またはWorkflow Compilerへ責務を分ける。

## 10. Validation

Blocking error:

- `project.title` が空。
- `project.id` が空、またはstable ID regexを満たさない。
- `subject.copyrightedCharacter = true` かつ `subject.characterName` が空。
- `audience` が空。
- `assumptions.adultCharacters !== true`。
- `assumptions.consensual !== true`。
- `generation.target_image_count` が1以上の整数でない。

既存Projectの編集では、`project.id` の変更もBlockする。

## 11. App-wide Project / Artifact roots

現在の実装では環境設定に次のapp-wide pathを持つ。

```text
Project root          -> BATCH_STUDIO_PROJECT_ROOT
成果物配置 root       -> BATCH_STUDIO_ARTIFACT_ROOT
```

- `Project root` が設定されている場合、新規Project画面の作成先初期値に使用する。
- ユーザーは新規Project画面で別の作成先を選び直せる。
- `成果物配置 root` が設定されている場合、Project作成時に `<artifactRoot>/<project.id>` を作成する。
- 作成した成果物pathは `project_meta.json.settings.artifactOutputPath` に絶対pathで保存する。
- root設定は既存Projectの実フォルダを自動移動しない。
- 両rootとも絶対pathかつ存在するdirectoryのみ保存可能とする。

## 12. Story への引き渡し

初回Grok依頼では完成Storyを一度で要求せず、まず調査・Story案・不足確認を行う。

その後、ユーザーがGrok上で案を調整し、完成版作成工程で `story.md` をMarkdown code blockとして受け取る。

Batch StudioはGrokを自動操作せず、依頼文生成・Clipboard・添付候補表示・回答貼り付け・Draft検証を支援する。

`generation.target_image_count` はStory / Prompt Planningが最終的にその規模へ展開できる目標値としてGrok用文脈へ渡す。ComfyUI内部の生成回数設定をGrokへ要求しない。

具体的なGrok契約は `../contracts/grok-contract.md` を正本とする。
