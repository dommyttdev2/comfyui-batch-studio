# ComfyUI Batch Studio Documentation

## 1. このディレクトリの役割

この `docs/` は、ComfyUI Batch Studio の要件・設計・データ契約・外部連携・判断履歴を、今後の仕様追加に耐えられる形で管理する正本である。

旧ドキュメントのように一つの設計書へ UI、データ、外部連携、Grok プロンプト、Workflow 内部構造を集約しない。変更理由と変更単位が異なる内容は分離し、同じ事実を複数文書へ重複記載しない。

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
│  └─ workflow-compiler.md
├─ contracts/
│  ├─ project-artifacts.md
│  ├─ grok-contract.md
│  └─ prompt-plan.md
├─ ui/
│  └─ project-initialization.md
├─ integrations/
│  └─ external-tools.md
├─ quality/
│  └─ validation-and-security.md
└─ decisions/
   └─ decision-log.md
```

## 3. 各文書の責務

| 文書 | 正本とする内容 |
| --- | --- |
| `requirements/requirements.md` | 要件 ID、状態、受け入れ条件、未決事項 |
| `product/scope-and-flow.md` | 製品目的、責務境界、対象範囲、全体工程 |
| `architecture/system-architecture.md` | Electron 構成、サービス境界、信頼境界、データフロー |
| `architecture/workflow-compiler.md` | 1枝テンプレートから最終 ComfyUI Workflow を機械生成する方式 |
| `contracts/project-artifacts.md` | プロジェクト内ファイル、正本関係、互換性 |
| `contracts/grok-contract.md` | Grok Web への入力、Grok の責務、Grok から受け取る成果物 |
| `contracts/prompt-plan.md` | `prompt_plan.json` の意味構造と Draft schema |
| `ui/project-initialization.md` | 新規プロジェクト画面と `project_brief.json` |
| `integrations/external-tools.md` | civit-model-viewer、R2 File Manager、ComfyUI との境界 |
| `quality/validation-and-security.md` | 検証、Preflight、秘密情報、Grok Web 隔離 |
| `decisions/decision-log.md` | 合意済み設計判断と未決判断の履歴 |

## 4. 文書更新ルール

### 4.1 One fact, one owner

同じ仕様を複数文書へコピーしない。詳細を持つ文書を一つ決め、他文書からはリンクまたは短い要約だけを記載する。

例:

- `prompt_plan.json` のフィールド定義は `contracts/prompt-plan.md` が所有する。
- Workflow の Node ID / Link ID 再採番は `architecture/workflow-compiler.md` が所有する。
- Grok が Workflow JSON を生成しないという責務境界は `product/scope-and-flow.md` と Decision Log で宣言し、具体的な Grok 返却形式は `contracts/grok-contract.md` が所有する。

### 4.2 Requirement ID

実装対象となる要件には `REQ-<DOMAIN>-NNN` を付ける。仕様変更では文章だけを書き換えず、対応する要件 ID も更新する。

### 4.3 Decision と Requirement を分ける

- **Requirement**: システムが満たす必要がある振る舞い。
- **Decision**: なぜその方式を採用したかという設計判断。
- **Open Question**: まだ固定していない内容。

合意済み方針を後から変更する場合は、Decision Log に「置換された判断」を残す。

### 4.4 Schema version

`project_brief.json`、`models.json`、`prompt_plan.json` 等の機械可読形式は `schemaVersion` を持つ。破壊的変更を文章だけで吸収しない。

### 4.5 Draft と Decided

会話中に出た提案を自動的に確定仕様へしない。

- ユーザーと合意済み: `Decided`
- 実装前に詳細確定が必要: `Draft`
- 方針自体が未確定: `Open`

## 5. 現在の設計原則

最上位の責務分担は次の通り。

> **Grok は「何を作るか・何を使うか」を考える。Batch Studio は「その決定を管理・検証・機械変換・保存する」。ユーザーが最終的に確定する。**

特に Workflow については例外なく、Grok に ComfyUI Workflow JSON を生成させない。Grok から受け取るのは共通プロンプト、使用 LoRA、枝と葉のプロンプトを表す構造化 JSON であり、最終 Workflow は Batch Studio の Workflow Compiler が生成する。

## 6. 旧文書からの移行

旧 `design.md`、`grok-prompt-contracts.md`、`project-initialization-schema.md` の内容は、この新構成へ責務別に移す。移行完了後は旧文書を残して二重正本にしない。
