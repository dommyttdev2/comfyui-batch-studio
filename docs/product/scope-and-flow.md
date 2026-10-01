# Product Scope and End-to-End Flow

Status: Active

## 1. 目的

ComfyUI Batch Studio は、ComfyUI を使った大量画像生成プロジェクトについて、企画入力から Story、Civitaiモデルカタログ同期、モデル選定、プロンプト計画、Workflow生成、モデル所在確認、Cloudflare R2管理、生成実行前Preflight、Local / Remote ComfyUIでの実行、成果物回収、最終成果物選定後のCaption・サムネイル・販売サイト用画像作成までを一つのデスクトップアプリで支援する。

本製品は「AIに全部やらせるアプリ」ではない。意味的判断、機械処理、最終決定を明確に分離する。

## 2. 最上位の責務原則

> **AI agent は「何を作るか・何を使うか」を考える。Batch Studio は「その決定を管理・検証・機械変換・保存・実行する」。ユーザーが最終的に確定する。**

### 2.1 AI agent の責務

- 版権キャラクター等の公開情報の調査・整理。
- Story案の生成とユーザーとの会話による調整。
- `story.md` の作成。
- `model_catalog.json` を根拠にしたLoRA選定。基盤モデルはユーザー選択済みのものを変更しない。
- Common / Branch / Leaf scopeへの構造化Danbooru tag設計、Root / Branch LoRAの意味設計。

### 2.2 Batch Studio の責務

- プロジェクト状態と成果物管理。
- Brief、下書き、履歴、確定保存。
- AI agentへ渡す意味文脈とworkspace参照入力の準備。
- Civitai Model Collectionの同期。
- app-wide `model_catalog.json` の生成・generation管理。
- Model / Version / File / thumbnail / trained words取得。
- Civitai observed LoRA strength baseline集計。
- Collection / Model / Version選択テンプレート管理。
- ユーザーが選択した基盤モデルとAI agentが選定したLoRAのModel / Version / File実在確認。
- Prompt Plan schema / semantic validation。
- Model Family別Prompt policy、trainedWords注入、category順、exact dedupeによる最終Promptの決定論的compile。
- Workflow TemplateとPrompt PlanからComfyUI Workflowを決定論的に生成。
- Cloudflare R2 credentialのMain Process内管理。
- R2 bucket / object / upload / download / move / delete / URL生成。
- Local / R2 / `models.json` の所在差分確認。
- Preflight。
- `executionTarget` に応じた Local / Remote Execution。
- Scene Prompt Tools `ScenePrompterExpand` の連続生成 orchestration。
- Remote実行時のR2経由モデル配置、成果物upload、Local回収、完全性検証。
- Execution Runのprogress / stop / resume状態管理。
- 手作業で選定・モザイク処理された最終成果物ディレクトリの指定と後工程への引き渡し。
- 最終成果物の実画像枚数を用いたCaption組み立て。
- 最終成果物を素材とするサムネイル編集・書き出し。
- 最終成果物を素材とするFANZA / DLsite向け画像の独立クロップ、Lanczos3リサイズ、JPEG / PNG / WebP出力、ZIP化。

### 2.3 ユーザーの責務

- Project Brief入力。
- Civitai Collectionの整理・必要モデル追加。
- Grok CLI / Codex CLIの利用に必要な各providerの認証。
- AssistantPaneでの会話、provider/model選択。
- Story案、基盤モデル/LoRA選定、Prompt Planの最終確認。
- R2の接続設定と破壊操作の明示実行。
- Remote executionを使用する場合のSSH接続設定・秘密鍵path設定。
- 警告・差分確認。
- 成果物の明示確定。

## 3. やらないこと

### 3.1 AI transport

現行フローでは次を使用しない。

- Grok Webの埋め込み / DOM操作。
- Clipboardを前提とした手動prompt transport。
- Grok回答scraping。
- provider CookieのProject保存。
- Codex App Server。

AI通信はMain ProcessのCLI adapterを通し、通常会話はAssistantPane、工程成果物taskは左工程UIから開始する。

### 3.2 AI agentに任せないこと

- ComfyUI Workflow JSON。
- Node / Link / Group ID。
- node/group position。
- `mode`。
- `widgets_values`。
- `widgets_values_named`。
- `scene_matrix_json`。
- R2操作。
- Civitai API keyやR2 secretの利用。
- SSH / Remote Worker / ComfyUI API実行制御。

### 3.3 生成実行範囲

責務終端は Preflight ではなく `実行` 工程とする。

Local executionではWorkflow実行とLocal成果物確認までを対象とする。

Remote executionでは、Remote環境準備、必要モデル配置、Workflow実行、成果物package、R2 upload、R2からLocalへのdownload、完全性検証までを1つのExecution Runとして扱う。

Remote executionの詳細設計は `../architecture/remote-execution.md` を正本とする。

現時点で必須責務としないもの:

- Vast.ai instanceの自動契約・作成。
- SSH Tunnel。
- ComfyUI API portの外部公開。

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
[3. Model Selection]
Batch Studio Main Process / Local UI
  -> Civitai Collectionをapp-wide model_catalog.jsonへ同期
  -> UserがModel Familyを選択
  -> Illustrious: CheckpointをCatalogから選択
  -> Anima: Diffusion ModelをCatalog、Text Encoder / VAEをLocal/R2 inventoryから選択
        |
        v
ユーザー選択済み基盤モデル + story.md + model_catalog.json
        |
        v
Grok
  -> LoRAのみ選定
  -> catalog外候補 / 複数LoRA / Prompt代替を評価
  -> unresolvedのみmissingRequirements
        |
        v
Batch Studio
  -> 基盤モデルへloras[]をmerge
  -> catalog identity validation
  -> User Confirm
        |
        v
models.json
        |
        v
[4. Prompt Planning]
story.md + models.json
        |
        v
Grok
  -> Schema v2 Common / Branch / Leaf structured tags
  -> Root / Branch LoRA usage
  -> trainedWordsはPrompt Planへ転記しない
        |
        v
prompt_plan.json Draft
        |
        v
Batch Studio
  -> schema / refs / semantic validation
  -> category editor / compiled prompt preview
  -> User Confirm
        |
        v
[6. Workflow Compile]
Template + Manifest + prompt_plan.json + models.json
        |
        v
Workflow Compiler
  -> Model Family quality policy
  -> Base / Root / Branch trainedWords injection
  -> category-order compile / exact dedupe
        |
        v
LoRA_{project-destination-folder}.json
+ API-format execution graph
        |
        v
[7. Model Availability / R2]
Batch Studio
  -> models.json / Local / integrated R2 diff
  -> Local target: Local配置必須、R2任意
  -> Remote target: R2配置必須、Local任意
        |
        v
[8. Preflight]
Batch Studio
  -> artifact / workflow / model validation
  -> target-specific operational checks
        |
        v
READY TO EXECUTE
        |
        v
[9. Execution]
executionTarget == local
  -> Local ComfyUI API
  -> Scene Prompt continuous run
  -> Local artifact confirmation

executionTarget == remote
  -> SSH private-key auth
  -> Remote Worker
  -> R2 GET model staging
  -> Remote localhost ComfyUI API
  -> Scene Prompt continuous run
  -> Remote package/hash
  -> presigned PUT -> R2
  -> R2 GET -> Local
  -> Local hash verification
        |
        v
COMPLETED
        |
        v
[10. Final Artifact]
User + Batch Studio
  -> 手作業で選定・モザイク処理した最終成果物ディレクトリを指定
        |
        v
[11. Caption]
Grok + Batch Studio
  -> title / description JSON
  -> Batch Studioが最終成果物の実画像枚数を数えてcaption.txtを組み立て
        |
        v
[12. Thumbnail]
User + Batch Studio
  -> 最終成果物画像からサムネイルを編集・生成
        |
        v
[13. Marketplace Images]
User + Batch Studio
  -> 最終成果物画像からFANZA / DLsite各ターゲットを独立クロップ
  -> marketplace/FANZA/*
  -> marketplace/DLsite/*
  -> marketplace-images.zip
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
| モデル選定 | `story.md`, app-wide `model_catalog.json`, Local/R2 model inventory | `models.json` | Model Family/基盤モデル選択済み、LoRA identity実在、unresolved `missingRequirements` なし |
| プロンプト設計 | story, models | `prompt_plan.json` | schema / refs / structured tag semantic validation / branch-leaf整合性有効 |
| ワークフロー | Template, Manifest, models, plan | UI Workflow + Execution API graph | UI Workflow / API graph生成、構造validation、hash / workflow identity整合が成功 |
| モデル配置 | models, Local, integrated R2, executionTarget | 所在状態 / R2操作 | Local targetはLocal配置済み。Remote targetはR2配置済み |
| 実行前チェック | 全成果物 + target環境 | READY / BLOCKED | artifact/model validationとtarget-specific operational checkにblocking errorなし |
| 実行 | READY Project + executionTarget | Execution Run / Local成果物 | Localは生成+成果物確認、Remoteは生成+R2経由Local回収+hash検証成功 |
| 最終成果物 | ユーザーが選定・処理した画像ディレクトリ | 最終成果物directory設定 | directoryが存在し画像を1枚以上含む |
| キャプション | 最終成果物、Grok caption content | `caption.txt` | caption content有効、最終成果物の実画像枚数をBatch Studioが取得可能 |
| サムネイル | 最終成果物画像 | 成果物フォルダ内 `thumbnails/*` | 必要な画像を選択・編集して書き出し可能 |
| 販売サイト用画像 | 最終成果物画像 | 成果物フォルダ内 `marketplace/FANZA/*`, `marketplace/DLsite/*`, ZIP | FANZA / DLsite各ターゲットのcropが有効で生成可能 |

## 6. UI工程ナビゲーション

```text
概要
基本設定
ストーリー
モデル選定
プロンプト設計
ワークフロー
モデル配置
実行前チェック
実行
最終成果物
キャプション
サムネイル
販売サイト用画像
```

Grok pane既定表示:

```text
ストーリー      表示
モデル選定      表示
プロンプト設計  表示
その他          非表示
```

Grokを使用しない工程では `Grokを表示` / `Grokを隠す` 操作自体を表示しない。

`prompt_tree.md` はLegacyのみ。Prompt構造の正本は`prompt_plan.json`。

## 7. Integrated service ownership

### 7.1 Model Catalog

`civit-model-viewer` の機能はBatch Studioへ統合済み。新規フローでは別Flask processやlocalhost:5055を起動しない。

Catalog標準保存先はElectron app data配下で、標準フローは統合Catalogを直接利用する。Civit ExplorerはProject工程ではなくapp-wide toolであり、モデル選定画面からもCatalog同期を実行できる。既存Projectの明示的な外部`catalogPath`は互換用として維持する。

### 7.2 R2

`r2-file-manager` の主要機能はBatch Studioへ統合済み。新規フローでは別Python/Flask processやlocalhost R2 UIを起動しない。

R2 Secret / Cloudflare API TokenはElectron Main Processでのみ復号・利用し、Project artifactやGrokへ渡さない。Projectの`モデル配置`工程ではR2をread-only参照し、upload / move / delete / 一括DL / 一時PUT URL等の管理操作はStandalone R2 File Managerへ集約する。

Remote executionではIntegrated R2 Managerが model GET URL、artifact presigned PUT、Local artifact GETを所有する。RemoteへR2 credentialを渡さない。

既存Projectの`r2IndexPath`は互換用fallbackとして残すが、標準のModel Availability / PreflightはProjectに設定されたR2 bucket/prefixを統合R2 Managerから直接照会する。

### 7.3 Execution

Executionの詳細責務は `../architecture/remote-execution.md` を正本とする。

- Local targetはLocal ComfyUI APIを利用する。
- Remote targetは公開SSH endpointへの秘密鍵認証を利用する。
- SSH Tunnelは使用しない。
- Remote WorkerがRemote host内のComfyUI localhost APIを利用する。
- SSHはcontrol plane、R2はlarge binary transfer planeとする。
- Scene Prompt Expand連続生成はfrontend button clickではなくAPI orchestrationで再現する。

### 7.4 Current implementation boundary

現在のProject navigationは `概要 -> 基本設定 -> ストーリー -> モデル選定 -> プロンプト設計 -> ワークフロー -> モデル配置 -> 実行前チェック -> 実行 -> 最終成果物 -> キャプション -> サムネイル -> 販売サイト用画像` まで実装済みである。

Executionではpersistent Run、Local ComfyUI API + Scene Prompt Tools連続生成、Stop scheduling / Force interrupt / Resume、Vast.ai Instance lifecycle、公開SSH + Host Key検証、Remote Worker、Remote環境bootstrap、R2からのmodel staging、Remote Scene Prompt連続生成、成果物ZIP/manifest作成、R2 upload、Local download、SHA-256検証、cleanupまで実装済みである。

Vast.ai Remote Runは選択InstanceがstoppedならRun開始時に起動し、Batch Studioが起動したInstanceはRun終端後にinitial stateへ戻す。Run開始前からrunningだったInstanceはrunningを維持する。

一方、Preflight自体はすべてのruntime operational checkを事前実行しているわけではない。API graphとArtifact/model/provider GateはPreflightで検証し、SSH接続・Host Key・Remote filesystem/runtime・ComfyUI/Scene Prompt capability等の一部はExecution開始後の各phaseで検証する。

## 8. 状態定義

### 8.1 READY

Projectが`READY`になる最低条件:

1. `story.md` Confirmed。
2. `models.json` Confirmedかつcurrent catalogと整合。
3. `prompt_plan.json` Confirmed。
4. `LoRA_{project-destination-folder}.json` generatedかつTemplate/Manifest provenanceがstaleでない。
5. API-format execution graphがWorkflowと整合。
6. unused branch 0。
7. Workflow参照Modelが`models.json`と一致。
8. Local targetでは必須モデルがLocal生成環境から利用可能。
9. Remote targetでは必須モデルがR2に存在する。
10. target-specific Preflight blocking errorなし。

`READY` は「実行開始可能」を意味し、生成完了を意味しない。

### 8.2 COMPLETED

Local target:

- Scene Prompt continuous runが完了。
- expected Local artifactを確認済み。

Remote target:

- Remote model staging完了。
- Scene Prompt continuous run完了。
- expected Remote artifactを確認済み。
- package / SHA-256生成済み。
- R2 upload成功。
- R2からLocalへのdownload成功。
- Local SHA-256がRemote package SHA-256と一致。

これらを満たしたExecution Runだけを`COMPLETED`とする。
