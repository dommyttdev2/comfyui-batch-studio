# Requirements Registry

Status: Active

この文書は要件の索引である。詳細設計をここへ重複記載せず、各要件の正本となる文書へリンクする。

## 1. Product / Scope

| ID | Status | Requirement | Owner |
| --- | --- | --- | --- |
| REQ-SCOPE-001 | Decided | Batch Studio はプロジェクト作成から生成実行前 Preflight までを支援する。ComfyUI への Queue 投入・生成進捗管理は v1 の必須範囲に含めない。 | `product/scope-and-flow.md` |
| REQ-SCOPE-002 | Decided | Grok Web はユーザーが直接操作し、Batch Studio は Grok の入力欄・添付・送信・回答取得を自動操作しない。 | `product/scope-and-flow.md` |
| REQ-SCOPE-003 | Decided | Grok の回答は下書きであり、ユーザー確認と Batch Studio の検証を経て明示保存されたファイルだけをプロジェクト成果物として扱う。 | `contracts/project-artifacts.md` |

## 2. Project / Story

| ID | Status | Requirement | Owner |
| --- | --- | --- | --- |
| REQ-PROJ-001 | Decided | 初期画面は細かなストーリー設計を要求せず、プロジェクト名・対象キャラクター・ターゲット読者・固定前提・大まかな要望を Brief として保存する。 | `ui/project-initialization.md` |
| REQ-STORY-001 | Decided | Story の調査・案出し・詳細化は Grok に担当させ、ユーザーとの会話後に `story.md` を確定する。 | `contracts/grok-contract.md` |

## 3. Model Selection

| ID | Status | Requirement | Owner |
| --- | --- | --- | --- |
| REQ-MODEL-001 | Decided | 使用モデルの選定主体は Grok とする。Batch Studio の UI でユーザーがモデルを一件ずつ手動選択する方式を主経路にしない。 | `product/scope-and-flow.md` |
| REQ-MODEL-002 | Decided | Grok は `civit-model-viewer` が出力する `model_catalog.json` を根拠にモデル・バージョン・ファイルを選定する。 | `integrations/external-tools.md` |
| REQ-MODEL-003 | Decided | Batch Studio は Grok の選定結果を `model_catalog.json` と照合し、存在しない Model / Version / File を確定させない。 | `quality/validation-and-security.md` |
| REQ-MODEL-004 | Decided | カタログ内に必要モデルがない場合、Grok は架空のファイル名を作らず不足要件として返す。 | `contracts/grok-contract.md` |
| REQ-MODEL-005 | Decided | `models.json` はモデル選定時に使用した `model_catalog.json` の provenance として少なくとも `schemaVersion`、`generation`、`generatedAt` を記録する。現在の catalog の `generation` が異なる場合は選定済み Model / Version / File を現在の catalog に対して再検証し、generation の不一致だけでは `models.json` を無効化しない。 | `contracts/project-artifacts.md` |
| REQ-MODEL-006 | Decided | `models.json` は既存形式との互換性を要件とせず、ComfyUI Batch Studio 専用の新しい schema を定義して使用する。 | `contracts/project-artifacts.md` |
| REQ-MODEL-007 | Decided | LoRA の推奨・基準強度を Civitai 由来の情報として取得できる場合、`models.json` にその値と provenance を保持する。Civitai に根拠となる情報がない場合は値を捏造しない。 | `contracts/project-artifacts.md` |

## 4. Prompt Planning

| ID | Status | Requirement | Owner |
| --- | --- | --- | --- |
| REQ-PLAN-001 | Decided | Grok から Workflow JSON を受け取らず、共通プロンプト、ルート LoRA、枝ごとの LoRA、枝内 Matrix 用プロンプト群を JSON で受け取る。 | `contracts/prompt-plan.md` |
| REQ-PLAN-002 | Decided | Grok の JSON は ComfyUI の Node ID、Link ID、`widgets_values`、`scene_matrix_json` 等の内部形式を含まない。 | `contracts/prompt-plan.md` |
| REQ-PLAN-003 | Decided | Grok から受け取り、Batch Studio の検証とユーザー承認を経て確定する構造化 Prompt Plan の標準ファイル名を `prompt_plan.json` とする。プロジェクトごとに確定版は1ファイルとし、Workflow Compiler はこのファイルを Prompt Plan の機械可読入力として使用する。確定前の回答や旧版は `prompt_plan.json` を上書きせず Draft / History 領域で管理する。 | `contracts/prompt-plan.md` |
| REQ-PLAN-004 | Decided | `prompt_plan.json` を Prompt 設計の機械可読な正本とし、人間向けの確認・編集は Batch Studio の Prompt Plan Web UI で提供する。新規プロジェクトでは `prompt_tree.md` を標準 Artifact として生成・維持せず、Workflow Compiler の入力にも使用しない。既存の `prompt_tree.md` は Legacy Artifact としてのみ扱う。 | `contracts/project-artifacts.md` |
| REQ-PLAN-005 | Decided | `prompt_plan.json` は Root / Branch で実際に適用する LoRA 強度を保持する。この値は Batch Studio の Web UI から調整可能とし、`models.json` に保存した Civitai 由来の推奨・基準値を書き換えない。 | `contracts/prompt-plan.md` |
| REQ-PLAN-006 | Decided | `prompt_plan.json` Schema v1 の正式 field name と構造を固定し、機械可読 schema を `schemas/prompt-plan.schema.json` とする。Branch ID / Leaf ID は Project 全体で一意とし、配列順を順序の正本とする。LoRA の `modelRef` / `strengthModel` / `strengthClip` は必須、未知 field と汎用 metadata/extensions 領域は v1 で許可しない。 | `contracts/prompt-plan.md` |

## 5. Workflow Compiler

| ID | Status | Requirement | Owner |
| --- | --- | --- | --- |
| REQ-WF-001 | Decided | 最終 ComfyUI Workflow は Batch Studio が機械的に生成する。Grok に Workflow JSON を編集・生成させない。 | `architecture/workflow-compiler.md` |
| REQ-WF-002 | Decided | 基本テンプレート Workflow は共通部と枝 Prototype 1本だけを持つ。 | `architecture/workflow-compiler.md` |
| REQ-WF-003 | Decided | `prompt_plan` の枝数に応じて Prototype を複製し、必要な枝だけを最終 Workflow に存在させる。 | `architecture/workflow-compiler.md` |
| REQ-WF-004 | Decided | 最終 Workflow に未使用枝、空の予約枝、未使用枝用 bypass ノード群を残さない。 | `architecture/workflow-compiler.md` |
| REQ-WF-005 | Decided | Compiler は枝複製時に Node ID、Link ID、関連参照、Group、座標を衝突なく再生成する。 | `architecture/workflow-compiler.md` |
| REQ-WF-006 | Decided | Root LoRA は全枝共通、Branch LoRA は当該枝だけに適用する。Root LoRA が不要なプロジェクトでは空 Stack を許容する。 | `architecture/workflow-compiler.md` |
| REQ-WF-007 | Draft | Template の可変ノードを Node ID のコード埋め込みで特定せず、Manifest に role / boundary / prototype 情報を定義する。 | `architecture/workflow-compiler.md` |
| REQ-WF-008 | Open | Prototype の正式な Manifest schema、枝間隔、Group 複製方式、Compiler version の記録形式を実装前に固定する。 | `architecture/workflow-compiler.md` |

## 6. External Tools

| ID | Status | Requirement | Owner |
| --- | --- | --- | --- |
| REQ-INT-001 | Decided | Civitai との同期・API key 管理は `civit-model-viewer` の責務とし、Batch Studio は保存済み `model_catalog.json` を読む。 | `integrations/external-tools.md` |
| REQ-INT-002 | Decided | R2 の実体ファイル操作は初期段階では既存 R2 File Manager へ委譲する。 | `integrations/external-tools.md` |
| REQ-INT-003 | Decided | Batch Studio は Civitai API key と R2 secret を Grok へ渡さない。 | `quality/validation-and-security.md` |
| REQ-INT-004 | Draft | Civitai 由来の LoRA 強度情報を利用する場合も、Civitai API 通信は `civit-model-viewer` の責務とし、必要な strength evidence / recommendation を `model_catalog.json` 経由で Batch Studio へ渡せるようにする。 | `integrations/external-tools.md` |

## 7. Validation / Security

| ID | Status | Requirement | Owner |
| --- | --- | --- | --- |
| REQ-VAL-001 | Decided | `story.md`、`models.json`、`prompt_plan.json`、最終 Workflow を工程ごとに検証する。 | `quality/validation-and-security.md` |
| REQ-VAL-002 | Decided | Preflight では成果物相互のモデル参照、Workflow の構造、必要な実モデルの所在を確認する。 | `quality/validation-and-security.md` |
| REQ-SEC-001 | Decided | Grok 用 WebContents とローカル UI を権限・session 境界で分離する。 | `architecture/system-architecture.md` |
| REQ-SEC-002 | Decided | `.env`、credential、R2 設定、ブラウザデータ、`.safetensors` 本体を Grok 添付候補へ出さない。 | `quality/validation-and-security.md` |

## 8. Open Questions

未決事項は実装時に暗黙決定せず、Decision Log へ判断を追加してから `Open` / `Draft` を `Decided` へ変更する。

1. `models.json` 専用 schema の正式フィールド、stable reference、`missingRequirements` の配置。
2. Workflow Template Manifest の正式 schema。
3. Workflow の保存パス・枝タイトル・画像枚数など、Grok 指定と Compiler 派生値の境界。
4. R2 File Manager との将来の直接 API 統合。
5. ComfyUI Queue / 進捗管理を将来スコープへ追加する条件。
6. Civitai の投稿画像メタデータ等から LoRA の基準強度を導出する場合の正式アルゴリズム、provenance schema、および Civitai の単一 weight を `strengthModel` / `strengthClip` へどう初期展開するか。
