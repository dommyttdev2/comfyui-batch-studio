# Product Scope and End-to-End Flow

Status: Active

## 1. 目的

ComfyUI Batch Studio は、ComfyUI を使った大量画像生成プロジェクトについて、企画入力から Story、モデル選定、プロンプト計画、Workflow 生成、モデル所在確認、生成実行前 Preflight までを一つのデスクトップアプリで支援する。

本製品は「AI に全部やらせるアプリ」ではない。意味的判断、機械処理、最終決定を明確に分離する。

## 2. 最上位の責務原則

> **Grok は「何を作るか・何を使うか」を考える。Batch Studio は「その決定を管理・検証・機械変換・保存する」。ユーザーが最終的に確定する。**

### 2.1 Grok の責務

- 版権キャラクター等の公開情報の調査・整理。
- Story 案の生成とユーザーとの会話による調整。
- `story.md` の作成。
- `model_catalog.json` を根拠にした使用モデルの選定。
- 共通プロンプトの設計。
- 全枝共通で使用する LoRA の判断。
- 枝分けの意味的設計。
- 各枝で使用する LoRA の判断。
- 各枝の SceneMatrix に入れる葉プロンプト群の設計。

### 2.2 Batch Studio の責務

- プロジェクト状態と成果物の管理。
- Brief、下書き、履歴、確定保存。
- Grok に渡す文脈と添付対象の準備。
- `model_catalog.json` の読取。
- Grok が選定した Model / Version / File の実在確認。
- Grok の構造化 Prompt Plan の検証。
- Workflow Template と Prompt Plan から ComfyUI Workflow を決定論的に生成。
- Local / R2 / `models.json` の所在差分確認。
- Preflight。

### 2.3 ユーザーの責務

- プロジェクト Brief の入力。
- Grok Web でのログイン、送信、添付、会話継続。
- Story 案の選択・修正。
- Grok が選定したモデルと Prompt Plan の最終確認。
- 警告・差分の確認。
- 成果物の明示確定。

## 3. やらないこと

v1 の非責務を明示する。

### 3.1 Grok 操作の自動化

Batch Studio は次を行わない。

- Grok 入力欄の DOM 操作。
- 自動送信。
- 自動ファイル添付。
- Grok 回答のスクレイピング。
- ログイン自動化。
- Grok Cookie や認証情報のプロジェクト保存。

### 3.2 Grok に任せないこと

Grok に次を生成・操作させない。

- ComfyUI Workflow JSON。
- Node ID / Link ID。
- ノード座標・Group 座標。
- `widgets_values` / `widgets_values_named`。
- `scene_matrix_json`。
- bypass / mode。
- SaveImage、KSampler、VAE Decode 等の機械的ノード設定。
- R2 操作。
- Civitai API key や R2 secret の利用。

### 3.3 v1 の生成実行範囲

v1 の責務終端は「生成可能な Workflow と必要モデルが揃い、Preflight が完了した状態」とする。

ComfyUI API への Queue 投入、生成進捗管理、結果画像取得は将来追加可能だが、現時点の必須スコープには含めない。

## 4. 全体工程

```text
[1. Project Brief]
Batch Studio
  - 新規/既存プロジェクト
  - project_brief.json
        |
        v
[2. Story]
Grok
  - 調査
  - Story案
  - ユーザーとの調整
  - story.md
        |
        v
Batch Studio
  - 検証
  - ユーザー確定
        |
        v
[3. Model Selection]
story.md + model_catalog.json
        |
        v
Grok
  - Checkpoint / LoRA / Version / File 選定
  - 不足モデル要件の提示
        |
        v
models.json
        |
        v
Batch Studio
  - catalog照合
  - ユーザー確定
        |
        v
[4. Prompt Planning]
story.md + models.json
        |
        v
Grok
  - 共通Prompt
  - Root LoRA
  - Branch設計
  - Branch LoRA
  - Matrix leaf prompts
        |
        v
prompt_plan.json
        |
        v
Batch Studio
  - schema / model ref / branch整合性検証
        |
        v
[5. Workflow Compile]
Template(Common + Branch Prototype x1)
        + prompt_plan.json
        + models.json
        |
        v
Workflow Compiler
  - 共通部設定
  - 枝Prototype複製
  - Node/Link/Group再採番
  - LoRA Stack設定
  - SceneMatrix生成
  - タイトル/保存先等の派生値生成
        |
        v
LoRA_{project}.json
        |
        v
[6. Model Availability]
Batch Studio
  - Local ComfyUI
  - R2
  - models.json
    の差分確認
        |
        v
R2 File Manager
  - 必要なら実体転送
        |
        v
[7. Preflight]
Batch Studio
        |
        v
READY FOR COMFYUI
```

## 5. 工程ごとの Gate

| 工程 | 入力 | 出力 | 次へ進む条件 |
| --- | --- | --- | --- |
| Project | ユーザー入力 | `project_brief.json` | 必須 Brief が有効 |
| Story | Brief / 参考資料 | `story.md` | ユーザー確定、基本検証成功 |
| Models | `story.md`, `model_catalog.json` | `models.json` | 選定項目が catalog に実在し不足必須モデルが解消 |
| Prompt Plan | `story.md`, `models.json` | `prompt_plan.json` | schema、モデル参照、枝/葉整合性が有効 |
| Workflow | Template, Manifest, models, plan | Workflow JSON | Compiler 完走、構造検証成功 |
| Availability | models, Local, R2 | 所在状態 | 必須モデルが生成環境から利用可能 |
| Preflight | 全成果物 | READY / BLOCKED | Blocking error なし |

## 6. UI の工程ナビゲーション

左ペインの主要工程は次を基準とする。

```text
概要
Project
Story
Models
Prompt Plan
Workflow
R2 / Models
Preflight
```

旧 `Prompt Tree` 画面の扱いは `prompt_tree.md` の正本関係が確定してから決める。人間向け表示として残す場合でも、Workflow Compiler の入力契約とは分離する。

## 7. 完了状態の定義

プロジェクトが `READY` になる最低条件:

1. `story.md` が確定済み。
2. `models.json` が確定済みで、必須選定が catalog と整合する。
3. `prompt_plan.json` が確定済み。
4. Workflow Compiler により最終 Workflow が生成済み。
5. 最終 Workflow に未使用枝が存在しない。
6. Workflow が参照する Checkpoint / LoRA が `models.json` と一致する。
7. 必須モデル実体が生成環境から利用可能。
8. Preflight に blocking error がない。
