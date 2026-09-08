# Product Scope and End-to-End Flow

Status: Active

## 1. 目的

ComfyUI Batch Studio は、ComfyUI を使った大量画像生成プロジェクトについて、企画入力から Story、Civitaiモデルカタログ同期、モデル選定、プロンプト計画、Workflow生成、モデル所在確認、生成実行前Preflightまでを一つのデスクトップアプリで支援する。

本製品は「AIに全部やらせるアプリ」ではない。意味的判断、機械処理、最終決定を明確に分離する。

## 2. 最上位の責務原則

> **Grok は「何を作るか・何を使うか」を考える。Batch Studio は「その決定を管理・検証・機械変換・保存する」。ユーザーが最終的に確定する。**

### 2.1 Grok の責務

- 版権キャラクター等の公開情報の調査・整理。
- Story案の生成とユーザーとの会話による調整。
- `story.md` の作成。
- `model_catalog.json` を根拠にした使用モデルの選定。
- 共通プロンプト、Root LoRA、Branch、Leaf promptsの意味設計。

### 2.2 Batch Studio の責務

- プロジェクト状態と成果物管理。
- Brief、下書き、履歴、確定保存。
- Grokに渡す文脈と添付対象の準備。
- Civitai Model Collectionの同期。
- app-wide `model_catalog.json` の生成・generation管理。
- Model / Version / File / thumbnail / trained words取得。
- Civitai observed LoRA strength baseline集計。
- Collection / Model / Version選択テンプレート管理。
- Grokが選定したModel / Version / Fileの実在確認。
- Prompt Plan検証。
- Workflow TemplateとPrompt PlanからComfyUI Workflowを決定論的に生成。
- Local / R2 / `models.json` の所在差分確認。
- Preflight。

### 2.3 ユーザーの責務

- Project Brief入力。
- Civitai Collectionの整理・必要モデル追加。
- Grok Webでのログイン、送信、添付、会話継続。
- Story案、モデル選定、Prompt Planの最終確認。
- 警告・差分確認。
- 成果物の明示確定。

## 3. やらないこと

### 3.1 Grok操作の自動化

- Grok入力欄DOM操作。
- 自動送信。
- 自動ファイル添付。
- Grok回答scraping。
- ログイン自動化。
- Grok CookieのProject保存。

### 3.2 Grokに任せないこと

- ComfyUI Workflow JSON。
- Node / Link / Group ID。
- node/group position。
- `mode`。
- `widgets_values`。
- `widgets_values_named`。
- `scene_matrix_json`。
- R2操作。
- Civitai API keyやR2 secretの利用。

### 3.3 v1生成実行範囲

v1の責務終端は「生成可能なWorkflowと必要モデルが揃い、Preflightが完了した状態」。ComfyUI Queue / progress / output collectionは将来scope。

## 4. 全体工程

```text
[1. Project Brief]
Batch Studio
  -> project_brief.json
        |
        v
[2. Story]
Grok + User
  -> story.md Draft
        |
        v
Batch Studio
  -> Validate / Confirm
        |
        v
[3. Model Catalog]
Batch Studio Main Process
  -> Civitai Public/Private Model Collections
  -> Model / Version / File / thumbnail / trained words
  -> observed LoRA strength evidence
  -> app-wide model_catalog.json
  -> generation increment
        |
        v
Batch Studio Local UI
  -> Collection selection / cross-search
  -> Version inspection
  -> selection templates / JSON copy
        |
        v
[4. Model Selection]
story.md + model_catalog.json
        |
        v
Grok
  -> Checkpoint / LoRA / Version / File selection
  -> missingRequirements when needed
        |
        v
models.json Draft
        |
        v
Batch Studio
  -> catalog identity validation
  -> User Confirm
        |
        v
[5. Prompt Planning]
story.md + models.json
        |
        v
Grok
  -> Common Prompt / Root LoRA / Branch / Leaf prompts
        |
        v
prompt_plan.json Draft
        |
        v
Batch Studio
  -> schema / refs validation
  -> left-to-right pseudo Workflow tree review/edit
  -> User Confirm
        |
        v
[6. Workflow Compile]
Template + Manifest + prompt_plan.json + models.json
        |
        v
Workflow Compiler
        |
        v
LoRA_{project-destination-folder}.json
        |
        v
[7. Model Availability]
Batch Studio
  -> Local / R2 / models.json diff
        |
        v
R2 File Manager if transfer is required
        |
        v
[8. Preflight]
Batch Studio
        |
        v
READY FOR COMFYUI
```

Workflow JSON名の `{project-destination-folder}` はProject実フォルダの1階層上のフォルダ名を使う。

例:

```text
Project作成先:
D:\Tools\ComfyUI\Project\15_damon-slayer_kocho-shinobu

Project実フォルダ:
D:\Tools\ComfyUI\Project\15_damon-slayer_kocho-shinobu\project-o6a4d6

Workflow:
LoRA_15_damon-slayer_kocho-shinobu.json
```

`project.id` はWorkflow内のSave path等のProject識別に引き続き使用し、Workflow JSONファイル名には使用しない。

## 5. 工程ごとの Gate

| 工程 | 入力 | 出力 | 次へ進む条件 |
| --- | --- | --- | --- |
| 基本設定 | ユーザー入力 | `project_brief.json` | 必須Brief有効 |
| ストーリー | Brief / 参考資料 | `story.md` | User Confirm / validation成功 |
| モデルカタログ | Civitai Collection | app-wide `model_catalog.json` | Catalog生成済み。必要モデルがCollectionに含まれることをユーザーが確認可能 |
| モデル選定 | `story.md`, `model_catalog.json` | `models.json` | identity実在 / missing requirement解消 |
| プロンプト設計 | story, models | `prompt_plan.json` | schema / refs / branch-leaf整合性有効 |
| ワークフロー | Template, Manifest, models, plan | Workflow JSON | Compiler / structure validation成功 |
| モデル配置 | models, Local, R2 | 所在状態 | 必須モデルがLocal生成環境から利用可能 |
| 実行前チェック | 全成果物 | READY / BLOCKED | blocking errorなし |

## 6. UI工程ナビゲーション

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

Grok pane既定表示:

```text
ストーリー      表示
モデルカタログ  非表示
モデル選定      表示
プロンプト設計  表示
その他          非表示
```

Grokを使用しない工程では `Grokを表示` / `Grokを隠す` 操作自体を表示しない。

`prompt_tree.md` はLegacyのみ。Prompt構造の正本は`prompt_plan.json`。

## 7. Model Catalog ownership

`civit-model-viewer` の機能はBatch Studioへ統合済み。新規フローでは別Flask processやlocalhost:5055を起動しない。

Catalog標準保存先はElectron app data配下で、Projectは`project_meta.json.settings.catalogPath`から参照する。新規Projectは統合Catalogへ自動関連付けする。

既存Projectで外部`catalogPath`が明示されている場合は互換性のため維持し、「モデルカタログ」工程の明示操作で統合Catalogへ切り替える。

## 8. 完了状態の定義

Projectが`READY`になる最低条件:

1. `story.md` Confirmed。
2. `models.json` Confirmedかつcurrent catalogと整合。
3. `prompt_plan.json` Confirmed。
4. `LoRA_{project-destination-folder}.json` generatedかつTemplate/Manifest provenanceがstaleでない。
5. unused branch 0。
6. Workflow参照Checkpoint/LoRAが`models.json`と一致。
7. 必須モデル実体がLocal生成環境から利用可能。R2-onlyはtransfer完了までBlocking。
8. Preflight blocking errorなし。
