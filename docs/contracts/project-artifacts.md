# Project Artifacts Contract

Status: Active / some schemas Draft

## 1. 目的

プロジェクト内で何を正本として保存し、どの成果物がどの入力から作られるかを定義する。

Grok の会話そのものは正本ではない。ファイルシステム上に保存され、検証とユーザー確定を経た Artifact を正本とする。

## 2. 推奨プロジェクト構成

```text
{project_root}/
├─ project_brief.json
├─ project_meta.json
├─ story.md
├─ models.json
├─ prompt_plan.json
├─ LoRA_{project-destination-folder}.json
└─ ._batch_studio/
   ├─ drafts/
   └─ history/
```

新規プロジェクトでは `prompt_tree.md` を標準 Artifact として生成・維持しない。

既存プロジェクトでは全ファイルが存在することを要求しない。既存の `prompt_tree.md` は Legacy Artifact として認識できるが、新規の正本関係には参加させない。

## 3. Artifact 一覧

| Artifact | Owner | Source | Role |
| --- | --- | --- | --- |
| `project_brief.json` | Batch Studio / User | 初期画面 | Story作成前の最小入力 |
| `story.md` | Grok + User | Brief / reference | 作品・場面設計の人間可読正本 |
| `models.json` | User base selection + Grok LoRA selection + Batch Studio validation | `story.md`, app-wide model inventory / `model_catalog.json` | Model Family、基盤モデル、LoRA集合とCivitai由来の基準情報 |
| `prompt_plan.json` | Grok + Batch Studio validation + User approval | `story.md`, `models.json` | Workflow Compiler が読む確定済みの機械可読 Prompt Plan。Schema v2ではCommon/Branch/Leafの構造化tagと実際のLoRA適用強度を保持する |
| `LoRA_{project-destination-folder}.json` | Workflow Compiler | Template, Manifest, models, plan, `project.id`, Project実フォルダ親名 | 最終ComfyUI UI Workflow |
| `project_meta.json` | Batch Studio | System | Artifact status、version、Workflow build provenance 等 |

### 3.1 Post-processing state / generated outputs

### キャプション / Pixiv用タイトル

- Grok / Codex は `caption_content.json` を `._batch_studio/drafts/` に取り込み、Batch Studio が検証・保存する。新規生成は `schemaVersion: 2` とし、既存の `title` / `description` / 任意の `contents` に加えて `pixivTitle: { ja, en }` を必須とする。
- `pixivTitle.ja` / `pixivTitle.en` は改行を含まない非空の32 Unicodeコードポイント以内とする。UIから個別編集・保存・コピーが可能である。
- 旧 `schemaVersion: 1` の下書きは Pixiv用タイトルなしでも有効。手動保存でv2へ移行するか、Grok / Codexで再生成できる。
- `caption.txt` は既存の `title` / `description` / `contents`、最終成果物の実測枚数、定型注意書きから作る。Pixiv用タイトルは含めず、Pixiv用タイトルだけの編集は `caption.txt` のstale判定を変えない。


後処理工程の編集状態・生成物はStory / Models / Prompt Plan等の意味Artifactとは分離する。

販売サイト用画像:

```text
{project_root}/
├─ marketplace/
│  ├─ FANZA/
│  │  ├─ package.<ext>
│  │  └─ thumbnail.<ext>
│  ├─ DLsite/
│  │  ├─ package.<ext>
│  │  └─ thumbnail.<ext>
│  ├─ custom/
│  │  └─ custom-output.<ext>
│  └─ marketplace-images.zip
└─ ._batch_studio/
   └─ marketplace-images.json
```

- `marketplace-images.json` はsource image、mode、target別crop、出力形式、custom resize設定を保持するeditor stateであり、Grok Artifactではない。
- `sourceType: final-artifact` のsource imageは `project_meta.json.settings.finalArtifactDirectory` 内の画像から選択する。
- `sourceType: thumbnail` のsource imageは `project_meta.json.settings.artifactOutputPath/thumbnails/` 内に出力済みで、現在のthumbnail editor stateにIDが存在するPNG/JPEG画像から選択する。
- サムネイル編集データは新規projectで5枚を初期生成し、追加・削除可能とする。既存projectの保存済み枚数は読み込み時に維持する。削除後も既存IDを詰め直さない。
- サムネイルの単体・一括出力先は `project_meta.json.settings.artifactOutputPath/thumbnails/` とする。入力用の最終成果物directoryとは分離する。
- FANZA / DLsiteの同寸法targetも別crop stateと別renderを持つ。
- target size / service / filenameの定義は `src/shared/marketplace-image-targets.json` が機械可読正本である。
- JPEG / PNG / WebPを出力でき、JPEG / WebPの品質設定は100固定とする。

Legacy:

| Artifact | Status | Role |
| --- | --- | --- |
| `prompt_tree.md` | Legacy only | 既存プロジェクトの過去形式。新規生成・正本運用・Workflow Compiler の直接入力には使用しない |

## 4. project_brief.json

詳細は `../ui/project-initialization.md` を正本とする。

Brief は Story 全体の詳細 schema ではなく、Grok に最初の提案を依頼するための最小入力である。

`project.id` は表示名とは独立したstable filesystem identityであり、ComfyUI生成物保存先等の内部identityに使用する。Workflow JSONファイル名だけはProject実フォルダの親フォルダ名から派生する。

`generation.target_image_count` はPrompt設計の目標値であり、実生成予定枚数の正本ではない。実生成予定枚数は確定 `prompt_plan.json` のleaf総数からCompilerが算出する。

## 5. story.md

`story.md` は Grok とユーザーの会話で作成し、Batch Studio へ貼り戻して確定する。

少なくとも以下を表現できることを期待する。

- タイトル / 読者対象
- 対象キャラクターと設定
- 人物関係
- 舞台 / 時間 / 開始・終了状態
- 外見 / 衣装 / 性格 / 視覚上の不変特徴
- 章 / 場面構成
- 画像化ポイント
- 禁止・除外方向
- 目標画像枚数へ展開できる粒度

厳密な Markdown schema は現時点で固定しない。

## 6. models.json

### 6.1 意味

Model Familyと基盤モデルはユーザーがBatch Studio UIで選択し、Grokはその基盤モデルを変更せずLoRAだけを選定する。IllustriousはCheckpoint、AnimaはDiffusion Model / Text Encoder / VAEを固定する。

Batch Studio は基盤モデル選択、Grok LoRA結果のmerge、catalog実在性の検証、Draft管理、ユーザー確認、確定保存を担当する。

`models.json` は同時に、選定した LoRA について Civitai をソースとする基準強度を取得できる場合、その値と provenance を保持する。

ここで保持する強度はモデル側の基準情報であり、最終 Workflow へ必ずそのまま適用される値ではない。実際に Root / Branch で使用する強度は `prompt_plan.json` が所有する。

### 6.2 Current schema / compatibility

`schemas/models.schema.json` を機械可読正本とする。新規の基盤モデル保存は **Schema v5** を使用し、v1〜v4は既存Projectの読み取り互換として保持する。

現行shape:

```text
Illustrious:
  schemaVersion: 5
  modelFamily: illustrious
  catalog
  checkpoint          # ref = checkpoint.main
  loras[]

Anima:
  schemaVersion: 5
  modelFamily: anima
  catalog
  diffusionModel      # ref = diffusion_model.main
  textEncoder          # models/text_encoders からの相対file name
  vae                  # models/vae からの相対file name
  loras[]
```

- Illustriousで `diffusionModel` / `textEncoder` / `vae` は許可しない。
- Animaで `checkpoint` は許可せず、`diffusionModel` / `textEncoder` / `vae` を必須とする。
- Anima Text Encoder / VAE にCivitai identityを捏造せず、用途別directoryからの相対 `fileName` を保存する。
- `loras[]` はModel Family共通でCivitai identityを保持する。
- 新規保存で旧schemaへdowngradeしない。

### 6.3 Selection ownership / Grok merge

基盤モデルはユーザー選択、LoRAはGrok選定という責務境界を持つ。

Grokから受け取る `model_loras.json` は `schemaVersion: 1` と `loras[]` を中心とし、`checkpoint` / `diffusionModel` / `textEncoder` / `clip` / `vae` / `modelFamily` を含む回答は拒否する。

Batch Studioは現在のModels DraftまたはConfirmed基盤モデルへLoRAだけをmergeし、`models.json` Draftを構築する。`promptFallbacks` はDraft処理で受け入れ、確定時に `._batch_studio/model_prompt_fallbacks.json` へ分離する。未解決 `missingRequirements` が残るDraftは確定できない。

### 6.4 Stable reference

正式 field name は `ref` とする。

Checkpoint は予約値:

```text
checkpoint.main
```

LoRA は次の形式:

```regex
^lora\.[a-z][a-z0-9._-]{0,58}$
```

例:

```text
lora.character
lora.character.secondary
lora.style
lora.pose.cowgirl
lora.concept.facesitting
```

原則:

- Project 内の全 `ref` は一意。
- `prompt_plan.json` の `modelRef` はこの `ref` を参照する。
- `.safetensors` ファイル名を Prompt Plan 側の安定識別子として使わない。
- `ref` はモデルファイル名変更や catalog 表示名変更から Project 内参照を分離する。

JSON Schema は形式を検証し、Project-wide uniqueness と `prompt_plan.json` からの参照解決は Batch Studio semantic validator が検証する。

### 6.5 Civitai identity

`checkpoint` と各 `loras[]` は、確定時に少なくとも次を保持する。

```text
modelId
modelName
versionId
versionName
fileId
fileName
modelUrl
trainedWords
reason
```

意味:

- `modelId` / `versionId` / `fileId`: `model_catalog.json` へ一意に再照合する Civitai identity。
- `modelName` / `versionName` / `fileName` / `modelUrl` / `trainedWords`: 選定時の catalog 由来情報。
- `reason`: Grok が当該 Project でそのモデルを選定した理由。

`reason` は Civitai provenance ではなく Grok 由来の意味情報である。

app-wide Civitai catalogに存在しないCivitai由来metadataや Batch Studio 独自semantic roleを捏造しない。Catalogの `baseModel` は取得できる場合に表示・検索へ利用する。

`trainedWords` が存在しない場合も空配列 `[]` として保持する。

### 6.6 Catalog provenance and revalidation

`models.json` は、基盤モデル/LoRA選定時に使用した `model_catalog.json` の provenance として少なくとも次を保持する。

```text
catalog.schemaVersion
catalog.generation
catalog.generatedAt
```

`generation` は「その選定後に catalog が変更されたか」を検出するための世代番号として扱う。

原則:

- 現在の catalog と `models.json` の `catalog.generation` が同じであれば、generation 差分を理由とする再検証は不要。
- `catalog.generation` が異なる場合は、`models.json` に固定された全 Model / Version / File identity を現在の catalog に対して再検証する。
- generation が異なるだけでは `models.json` を invalid / stale と判定しない。
- 選定済み Model / Version / File がすべて現在の catalog に存在する場合は `models.json` を valid と扱う。
- identity は維持されているが後続処理に関係する metadata が変化した場合は valid を維持しつつ warning を表示できる。
- 選定済み Model / Version / File が現在の catalog から消失した場合は blocking error とする。

```text
generation mismatch
  != project stale

generation mismatch
  = catalog changed since selection
  = selected identities must be revalidated
```

現行schemaでは catalog 内容全体の hash を必須 provenance としない。

### 6.7 LoRA strengthBaseline

Civitai 由来の根拠を取得できる LoRA だけ、任意 field `strengthBaseline` を持てる。

`strengthBaseline.provenance.basis`:

```text
creator-declared
observed-usage-derived
```

#### observed-usage-derived

投稿画像metadataから基準値を導出する現行policy:

```text
source images:
  exact modelVersionId
  sort=Newest
  withMeta=true
  max 200 images

valid resource:
  type == lora
  modelVersionId == exact selected versionId
  weight is numeric
  postId available

per post:
  median(valid weights in the post)

final value:
  median(per-post medians)

minimum evidence:
  5 distinct posts
```

provenance:

```json
{
  "strengthBaseline": {
    "value": 0.7,
    "provenance": {
      "source": "civitai",
      "basis": "observed-usage-derived",
      "method": "median-of-post-medians:newest-200",
      "sampleCount": 24
    }
  }
}
```

`sampleCount` は画像枚数ではなく、aggregationに利用した distinct `postId` 数を表す。

現行実装ではweightを0..1等へclampせず、追加の範囲filter / IQR除去 / trimmed meanを行わない。5 distinct posts未満なら `strengthBaseline` を生成しない。

この値はCivitai上で観測できた利用例のbaselineであり、作者の明示推奨値や普遍的最適値と表示しない。

#### creator-declared

`creator-declared` は、将来Civitaiがstructured field等で作者の明示strengthを提供し、その意味を機械的に確認できる場合に利用できる。

Model / Version descriptionの文章からregexやLLMで値を抽出し、それを `creator-declared` として保存することは禁止する。

#### General rules

- Civitai 由来の根拠がない場合は `strengthBaseline` field 自体を省略する。
- `null` や経験則による仮値で正本を埋めない。
- `source` は現行実装では `civitai`。
- `observed-usage-derived` の場合は `method` と `sampleCount` を必須にする。
- `creator-declared` と observed usage 由来の値を同一視しない。
- strength evidence取得・集計はBatch Studio Electron Main Processの統合Civitai Catalogが行い、exact versionの投稿metadataから `strengthBaseline` を生成する。
- evidenceはTTL付きapp-wide cacheを利用し、Catalog SYNC時のcurrent membershipと組み合わせて再利用する。

`schemas/models.schema.json` はこのoptional provenance shapeを表現する。投稿metadataの根拠が不足する場合は通常どおり `strengthBaseline` absentになり得る。

### 6.8 missingRequirements

`missingRequirements` は確定版 `models.json` に含めない。

不足要件は Grok response、Models Draft、Batch Studio UI state で管理する。

```text
Grok selection response
   -> missingRequirements
   -> Models Draft / UI
   -> User updates Civitai collection
   -> Batch Studio Civitai SYNC
   -> Grok re-selection
   -> validation
   -> models.json Confirm
```

未解決 `missingRequirements` が1件でも存在する場合:

```text
Models status = BLOCKED
models.json Confirm = prohibited
```

したがって確定済み `models.json` は「解決済みの使用モデル集合」だけを表す。

### 6.9 Extension / validation policy

各schema versionはJSON Schemaで定義した未知fieldを許可しない。

```text
additionalProperties: false
```

汎用 `metadata` / `extensions` / `extra` 領域も設けない。

検証は二段構成とする。

```text
JSON Schema validation
  +
Batch Studio semantic validation
```

JSON Schema:

- root / object shape。
- required fields。
- Civitai ID type。
- ref format。
- `strengthBaseline` provenance shape。
- unknown field rejection。

Semantic validator:

- Project-wide `ref` uniqueness。
- Model / Version / File identity の current catalog 実在確認。
- `prompt_plan.json` の `modelRef` 解決。
- unresolved `missingRequirements` の Confirm blocking。
- catalog generation mismatch 時の revalidation。
- catalog由来 observed baselineを使用する場合の `method` / `sampleCount` policy整合。

将来、VAE / Text Encoder / Embedding / ControlNet 等を Project Model Artifact として管理する要件が生じた場合は、汎用 field へ押し込まず schema evolution として追加する。

## 7. prompt_plan.json

`prompt_plan.json` は Grok から返された意味的な生成計画を、Batch Studio の検証とユーザー承認を経て確定した機械可読 Artifact である。

標準ファイル名:

```text
prompt_plan.json
```

プロジェクト直下には現在の確定版を1ファイルだけ置き、Workflow Compiler はこの確定版を Prompt Plan の入力として使用する。

```text
Grok response
   -> Draft
   -> Batch Studio validation
   -> User approval
   -> prompt_plan.json
   -> Workflow Compiler
```

確定前の候補や旧版は標準ファイル名へ直接保存しない。

```text
._batch_studio/drafts/prompt_plan/{timestamp}
._batch_studio/history/prompt_plan/{timestamp}
```

版番号や `final` などの状態をファイル名へ埋め込まず、`prompt_plan_v2.json`、`prompt_plan_final.json` 等を正規運用として作らない。

正本定義の詳細は `prompt-plan.md` が所有する。

Workflow 内部形式を含まず、主に次を持つ。

- Schema v2のCommon structured prompt
- root LoRA references
- root LoRA の実適用強度
- branches
- branch structured prompt
- branch LoRA references
- branch LoRA の実適用強度
- leaf structured prompt
- Schema v1 compatibility用のlegacy prompt strings

`models.json` の強度はモデル基準情報、`prompt_plan.json` の強度は当該プロジェクトで実際に Workflow へ適用する可変値であり、役割が異なる。

人間向けの確認・編集は `prompt_plan.json` から構築した Batch Studio の Prompt Plan Web UI で行う。Markdown など別の人間可読 Artifact を正本として並行管理しない。

Schema v2では最終Prompt文字列を正本として保存しない。Model Family quality preset、`models.json.trainedWords`、category compile order、exact dedupeはBatch Studio Prompt Compilerが所有し、構造化tagからScenePrompter / SceneMatrix向け文字列を決定論的に生成する。既存Schema v1は従来文字列を変更せずCompileする。

## 8. Legacy prompt_tree.md

Status: Legacy only

`prompt_tree.md` は新規プロジェクトの標準 Artifact ではない。

原則:

- Batch Studio は新規プロジェクトで `prompt_tree.md` を生成・維持しない。
- Workflow Compiler は `prompt_tree.md` を直接入力として使用しない。
- 人間向け Prompt Tree はファイルではなく Prompt Plan Web UI で表示する。
- UI 上の編集結果は `prompt_plan.json` に反映し、別の Markdown 正本を作らない。
- `prompt_tree.md` が欠損・削除されていても、新規方式の Workflow 生成には影響しない。

既存プロジェクトに `prompt_tree.md` が存在する場合は Legacy Artifact として認識できる。

Legacy から新方式へ移行する必要がある場合は、`prompt_tree.md` を自動的に正本へ昇格させず、Import / conversion candidate として解析し、ユーザー確認を経て `prompt_plan.json` として確定する。

```text
Legacy prompt_tree.md
      -> Import / conversion candidate
      -> Batch Studio validation / review
      -> User approval
      -> prompt_plan.json
```

Legacy conversion の詳細 schema / parser は必要になった時点で別要件として定義する。

## 9. Workflow Artifact

新規生成時の標準名:

```text
LoRA_{project-destination-folder}.json
```

`project-destination-folder` はProject実フォルダの1階層上にある作成先フォルダ名である。例えばProject rootが `D:/BatchProjects/office_boss/project-a` なら、生成Workflowは `LoRA_office_boss.json` となる。

`project.id` はWorkflow filenameには使用せず、Branchごとの生成物保存先とleaf output identityに使用する。

```text
save path  = BatchStudio/{project.id}/{branch.id}
row_id     = leaf.id
path_label = leaf.id
name       = leaf.id
```

`leaf.name` はBatch Studio UI上の人間向け表示名として保持する。ComfyUI Matrix側は `leaf.id` を使用し、日本語等の表示名を最終画像file nameへ持ち込まない。

実ファイルのextension・numeric sequence・timestamp・collision suffix等はSceneSaveImage custom nodeの責務とし、Batch Studioが再実装しない。

既存プロジェクトの旧命名は読み取り対象になり得るが、新規Compiler outputは上記命名へ統一する。

最終 Workflow は Grok の成果物ではなく Compiler output である.

## 10. project_meta.json

新規プロジェクトで利用する Batch Studio metadata。

`project_meta.json` 全体の正式 schema はまだ Draft だが、Workflow Compiler が生成した Workflow の build provenance を `workflowBuild` として保持する責務は確定済みとする。

Draft example:

```json
{
  "schemaVersion": 1,
  "projectId": "15_example",
  "displayName": "Example",
  "createdAt": "...",
  "artifacts": {
    "story": {"path": "story.md", "status": "confirmed"},
    "models": {"path": "models.json", "status": "confirmed"},
    "promptPlan": {"path": "prompt_plan.json", "status": "confirmed"},
    "workflow": {"path": "LoRA_15_example.json", "status": "generated"}
  },
  "workflowBuild": {
    "compilerVersion": "1.0.0",
    "manifest": {
      "schemaVersion": 1,
      "version": "1.0.0",
      "sha256": "..."
    },
    "template": {
      "id": "default-scene-batch",
      "version": "1.0.0",
      "sha256": "..."
    }
  }
}
```

`workflowBuild` の意味:

- `compilerVersion`: Compile を実行した Compiler release version。
- `manifest.schemaVersion`: 使用した Manifest schema version。
- `manifest.version`: 使用した `manifestVersion`。
- `manifest.sha256`: Compile 時の Manifest UTF-8 file bytes に対する SHA-256。
- `template.id`: Workflow Template の stable ID。
- `template.version`: Workflow Template release version。
- `template.sha256`: Manifest が bind した Template UTF-8 file bytes の SHA-256。

Manifest 自身には Compiler version や Manifest 自身の hash を埋め込まない。これらは実行結果側の provenance として `project_meta.json` が保持する。

将来追加候補:

- artifact hashes
- source catalog generation の project-level snapshot

既存プロジェクトでは metadata を必須にしない。

### 10.1 Artifact output root

環境設定の `BATCH_STUDIO_ARTIFACT_ROOT` が設定されている場合、Project作成時に `<artifactRoot>/<project.id>` を作成し、`project_meta.json.settings.artifactOutputPath` に絶対pathを保存する。これは生成画像等の成果物配置先として後続Executionから参照するためのProject設定であり、Project Artifact本体のrootを移動するものではない。

## 11. Draft / History

確定前入力:

```text
._batch_studio/drafts/{artifact-file}
```

確定ファイル更新直前の履歴:

```text
._batch_studio/history/{artifact-key}/{timestamp}-{artifact-file}
```

原則:

- ユーザー確認前に final artifact を上書きしない。
- Grok の貼り戻し直後は Draft。
- 確定済み `prompt_plan.json` の更新時は、更新前の版を history へ退避してから新しい確定版へ置き換える。
- Compiler output も最初は generated candidate とし、検証後に確定可能とする。

## 12. Artifact Dependency

```text
project_brief.json
      |
      v
   story.md
      |
      +------------------+
      |                  |
      v                  v
app-wide model inventory / model_catalog.json
      |                  |
      +-------> models.json
                   |
                   v
             prompt_plan.json
                         |
              Template + Manifest
                         |
                         v
                  Workflow Compiler
                         |
                         v
      LoRA_{project-destination-folder}.json
```

`prompt_tree.md` は Legacy Artifact であり、この新規 Artifact dependency graph には含めない。