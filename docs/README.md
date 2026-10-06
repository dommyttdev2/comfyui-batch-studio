# ComfyUI Batch Studio Documentation

## 1. このディレクトリの役割

この `docs/` は、ComfyUI Batch Studio の要件・設計・データ契約・UI・外部連携・品質基準・判断履歴・実装順序を、今後の仕様追加に耐えられる形で管理する正本である。

一つの巨大な設計書へ UI、データ、外部連携、Grok 契約、Workflow 内部構造を集約しない。変更理由と変更単位が異なる内容は分離し、同じ事実を複数文書へ重複記載しない。

## 2. ドキュメント構成

```text
docs/
├─ README.md
├─ requirements/
│  └─ requirements.md
├─ product/
│  └─ scope-and-flow.md
├─ architecture/
│  ├─ system-architecture.md
│  ├─ project-window-execution-runtime.md
│  ├─ workflow-compiler.md
│  └─ remote-execution.md
├─ contracts/
│  ├─ project-artifacts.md
│  ├─ agent-contract.md
│  └─ prompt-plan.md
├─ ui/
│  ├─ application-shell.md
│  ├─ japanese-ux-design.md
│  └─ project-initialization.md
├─ integrations/
│  ├─ external-tools.md
│  └─ service-integrations.md
├─ quality/
│  └─ validation-and-security.md
├─ roadmap/
│  └─ implementation-phases.md
└─ decisions/
   └─ decision-log.md
```

Docker DesktopでのLinuxローカル検証は [実行手順](operations/docker-local-tests.md) を参照する。

## 3. 各文書の責務

| 文書 | 正本とする内容 |
| --- | --- |
| `requirements/requirements.md` | 要件 ID、状態、未決事項の索引 |
| `product/scope-and-flow.md` | 製品目的、責務境界、対象範囲、全体工程、工程 Gate |
| `architecture/system-architecture.md` | Electron 構成、サービス境界、信頼境界、データフロー |
| `architecture/project-window-execution-runtime.md` | Project Window / Project / Execution Run / app-wide Execution Runtime の ownership、Multi Window lifecycle、resource lock |
| `architecture/standard-image-execution.md` | 標準ノード、1 Leaf = 1 POST、seed固定、旧Run拒否の正本 |
| `quality/standard-image-execution-validation.md` | #284の自動テスト・実ComfyUI生成・検証範囲 |
| `architecture/workflow-compiler.md` | 生成設定Templateから標準ComfyUI Workflowを機械生成する方式 |
| `architecture/remote-execution.md` | Local / Remote Execution、SSH + Remote Worker、標準画像連続生成、R2経由のモデル配置・成果物回収、Run State / Resume |
| `contracts/project-artifacts.md` | プロジェクト内ファイル、正本関係、依存関係、互換性 |
| `contracts/agent-contract.md` | Grok/Codex CLI の共通意味契約、session/workspace、AI成果物契約 |
| `contracts/prompt-plan.md` | `prompt_plan.json` の意味構造と Draft schema |
| `ui/application-shell.md` | 主画面、工程 navigation、AssistantPane、Artifact editor、Model Catalog、Model Availability/R2 等の上位 Shell / 共通 interaction |
| `ui/japanese-ux-design.md` | 日本語 UI の工程別 UX 要件、AI agent連携 capability、表示用語、状態・操作要件、受入基準。個別画面レイアウトや Component 構成は固定しない |
| `ui/project-initialization.md` | 新規プロジェクト画面と `project_brief.json` |
| `integrations/external-tools.md` | Batch Studio内蔵Civitai Catalog、Cloudflare R2、ComfyUI、Project filesystemとの境界。旧Standalone reposの位置づけ |
| `integrations/service-integrations.md` | Homeのサービス連携、外部credential UI、Cloud Instance Provider abstraction、Vast.ai API/Instance管理、Remote Executionへのprovider handoff |
| `quality/validation-and-security.md` | 検証、Preflight、秘密情報、AI CLI workspace隔離、failure policy |
| `operations/versioning.md` | エージェント向けのアプリ付番、独立した契約バージョン、リリース準備・検証手順 |
| `roadmap/implementation-phases.md` | 依存関係に沿った実装順序。要件の正本ではない |
| `decisions/decision-log.md` | 合意済み設計判断、置換された判断、未決判断の履歴 |

## 4. 文書更新ルール

### 4.1 One fact, one owner

同じ仕様を複数文書へコピーしない。詳細を持つ文書を一つ決め、他文書からはリンクまたは短い要約だけを記載する。

例:

- `prompt_plan.json` のフィールド定義は `contracts/prompt-plan.md` が所有する。
- Workflow の Node ID / Link ID 再採番は `architecture/workflow-compiler.md` が所有する。
- Project Window / Project / Execution Run / app-wide Execution Runtime の ownership、Multi Window lifecycle、Window close / app quit、execution resource lock は `architecture/project-window-execution-runtime.md` が所有する。
- Execution / Remote Execution の SSH、Remote Worker、standard image sequence、R2 transfer、Run State詳細は `architecture/remote-execution.md` が所有する。
- Home のサービス連携、Vast.ai API Key / Instance lifecycle / provider handoff は `integrations/service-integrations.md` が所有する。
- AI agent が Workflow JSON を生成しないという責務境界は `product/scope-and-flow.md` と Decision Log で宣言し、具体的なAI成果物・session/workspace契約は `contracts/agent-contract.md` が所有する。
- 主画面の UI 共通構造は `ui/application-shell.md` が所有する。
- Civitai / R2の実体サービス責務・secret境界は`integrations/external-tools.md`、それらをユーザーが設定するService Integration UXは`integrations/service-integrations.md`が所有する。
- 日本語 UI で各工程が満たすべき UX capability と受入基準は `ui/japanese-ux-design.md` が Draft として所有し、具体的な画面レイアウト・Component hierarchy は実装エージェントへ委ねる。
- 個別 Artifact schema は UI 文書へコピーしない。

### 4.2 Requirement ID

実装対象となる要件には `REQ-<DOMAIN>-NNN` を付ける。仕様変更では文章だけを書き換えず、対応する要件 ID も更新する。

### 4.3 Decision と Requirement を分ける

- **Requirement**: システムが満たす必要がある振る舞い。
- **Decision**: なぜその方式を採用したかという設計判断。
- **Open Question**: まだ固定していない内容。
- **Roadmap**: 何から実装するか。仕様そのものではない。

合意済み方針を後から変更する場合は、Decision Log に置換関係を残す。

### 4.4 Schema version

`project_brief.json`、`models.json`、`prompt_plan.json`、Template Manifest 等の機械可読形式は `schemaVersion` を持つ。破壊的変更を文章だけで吸収しない。

### 4.5 Draft と Decided

会話中に出た提案を自動的に確定仕様へしない。

- ユーザーと合意済み: `Decided` / Decision Log では `Accepted`
- 実装前に詳細確定が必要: `Draft`
- 方針自体が未確定: `Open`

## 5. 現在の設計原則

最上位の責務分担は次の通り。

> **AI agent は「何を作るか・何を使うか」を考える。Batch Studio は「その決定を管理・検証・機械変換・保存する」。ユーザーが最終的に確定する。**

特に Workflow については、Grok に ComfyUI Workflow JSON を生成させない。AI agent から受け取るのは共通プロンプト、使用 LoRA、枝と葉のプロンプトを表す構造化 JSON であり、最終 Workflow は Batch Studio の Workflow Compiler が生成する。

Model Familyと基盤モデルはユーザーがBatch Studio UIで選択し、AI agentはBatch Studio内蔵 `model_catalog.json` を根拠にLoRAだけを選定する。Batch StudioはCivitai同期・Catalog生成・基盤モデル選択UI・LoRA選定結果の検証/merge・保存を担当する。

Cloudflare R2もBatch Studio Main Processが直接管理する。旧 `civit-model-viewer` / `r2-file-manager` はStandalone/Legacyであり、新規Batch Studioフローの外部依存にはしない。

外部credentialとクラウドリソースはHomeの「サービス連携」からapp-wideに管理する。初期Cloud Instance ProviderはVast.aiとし、Projectは`remoteProvider + remoteInstanceId`をstable selectionとして保持する。詳細は`integrations/service-integrations.md`を正本とする。

Execution では Local / Remote を同一 Project flow で扱う。 Execution Runtime は Project Window / Project lifecycle から独立した app-wide Main Process service とし、Project配下には永続 Execution Run 履歴を保持する。Multi Window と Execution ownership の詳細は `architecture/project-window-execution-runtime.md`、Local / Remote の実行方式詳細は `architecture/remote-execution.md` を正本とする。Remote は公開 SSH + 秘密鍵認証を control plane、Cloudflare R2 を large binary transfer plane とし、SSH Tunnel は使用しない。詳細は `architecture/remote-execution.md` を正本とする。

## 6. 要件追加時の流れ

新しい要件を追加するときは次の順を基本とする。

```text
1. requirements/requirements.md に要件または Open Question を追加
2. 方式選択が必要なら decisions/decision-log.md に判断を追加
3. 正本となる domain document を更新
4. schema 変更なら schemaVersion / migration を検討
5. roadmap が影響を受ける場合だけ implementation-phases.md を更新
```

UI 要望だけで Compiler schema を変えたり、ComfyUI node 内部事情だけで Grok contract を変えたりしない。

## 7. 旧文書からの移行

旧 `design.md`、`grok-prompt-contracts.md`、`project-initialization-schema.md` の内容は、この新構成へ責務別に移行した。

移行後は旧文書を残して二重正本にしない。過去内容の履歴は Git history から参照する。
