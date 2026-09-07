# Application Shell UI

Status: Active

## 1. 目的

Electron の主画面で、Batch Studio のローカル工程とユーザー操作の Grok Web を同時に扱う UI 構造を定義する。

詳細な工程固有 UI は各契約・UI 文書が所有し、本書はアプリ全体の shell と共通 interaction を所有する。

## 2. 主画面

基本レイアウト:

```text
┌───────────────────────┬──────────────────────────────┐
│ Batch Studio          │ Grok Web                     │
│ Local UI              │ user-operated               │
│                       │                              │
│ Project               │ grok.com                     │
│ Story                 │                              │
│ Models                │                              │
│ Prompt Plan           │                              │
│ Workflow              │                              │
│ R2 / Models           │                              │
│ Preflight             │                              │
└───────────────────────┴──────────────────────────────┘
```

初期比率は 45:55 を目安とし、divider resize を許可する。

Local UI を一時最大化して長い Artifact / validation result を確認できるようにする。

## 3. Global Navigation

主要工程:

```text
Overview
Project
Story
Models
Prompt Plan
Workflow
R2 / Models
Preflight
```

`Prompt Tree` の独立 navigation は設けない。人間向けの Prompt Tree / Branch / Leaf 表示と編集は `Prompt Plan` 画面へ統合する。

## 4. Project List / Overview

既存・新規 project を一覧表示する。

最低表示:

- Project name / id。
- Project path。
- Story status。
- Models status。
- Prompt Plan status。
- Workflow status。
- Model availability / Preflight status。

例:

```text
Project A
  Story       CONFIRMED
  Models      CONFIRMED
  Prompt Plan DRAFT
  Workflow    OUTDATED
  Preflight   BLOCKED
```

Artifact dependency が更新された場合、下流 Artifact を stale として表示できる構造にする。

## 5. Grok Work Card

Story / Models / Prompt Plan の各工程では共通の Grok Work Card を表示する。

内容:

1. 今回の task。
2. 使用する確定入力 Artifact。
3. Grok へ添付すべき file。
4. Batch Studio が組み立てた prompt preview。
5. `Copy Prompt`。
6. `Open Folder`。
7. 手動作業 checklist。

Workflow 工程には Grok Work Card を置かない。Workflow は Compiler 工程である。

## 6. Artifact Editor / Import

Grok から貼り戻す工程では次を提供する。

- code block / raw text paste。
- parse preview。
- Draft save。
- validation result。
- current confirmed artifact との差分。
- explicit Confirm。

Grok の回答を paste した瞬間に final file を更新しない。

Web UI 上で Artifact を編集する場合も同じ lifecycle を使い、確定済み Artifact を無確認で直接上書きしない。

## 7. Status Model

UI 表示上、少なくとも次を区別する。

```text
MISSING
DRAFT
INVALID
WARNING
CONFIRMED
STALE
GENERATED
BLOCKED
READY
UNAVAILABLE
```

Status の詳細な遷移は implementation 時に state model として固定する。

## 8. Story Screen

主な構成:

- Current Brief summary。
- Current `story.md` status。
- Grok Work Card。
- Story editor / import。
- Validation。
- Confirm / history。

## 9. Models Screen

モデル画面は「カタログからユーザーが手動選定する画面」ではなく、Grok selection の確認・検証を中心とする。

表示例:

```text
Checkpoint
  model / version / file
  Catalog: FOUND

Character LoRA
  model / version / file
  trigger words
  proposed weight
  Catalog: FOUND

Pose LoRA
  ...

Missing requirements
  ...
```

操作:

- model catalog status / generation 表示。
- Grok Model Selection prompt を準備。
- `models.json` import。
- catalog validation。
- 選定理由表示。
- 再検討用 prompt 作成。
- confirm。

## 10. Prompt Plan Screen

`prompt_plan.json` を人間向けに確認・編集する正規 UI とする。

Raw JSON をそのまま主画面として見せるのではなく、意味構造を Tree / grouped view として表現する。

表示:

- common positive / negative。
- Root LoRA list と実適用強度。
- Branch list。
- Branch ごとの LoRA list と実適用強度。
- leaf count。
- leaf name / positive / negative。
- model reference validation。
- Draft / Confirmed / validation status。

操作:

- Branch の展開 / 折りたたみ。
- common prompt の編集。
- Root / Branch LoRA の実適用強度編集。
- leaf prompt の編集。
- Branch / leaf の順序編集。
- validation result の該当箇所表示。
- Draft save / explicit Confirm。

UI の編集対象は `prompt_plan.json` の意味データであり、`prompt_tree.md` 等の別 Markdown Artifact を生成・編集しない。

Grok の JSON を ComfyUI 内部 JSON として見せない。

### 10.1 Legacy prompt_tree.md

既存プロジェクトで `prompt_tree.md` を検出した場合は Legacy Artifact として扱う。

- 独立した通常 navigation を作らない。
- Workflow Compiler の入力にしない。
- 新規プロジェクトでは生成しない。
- 移行機能を実装する場合は `prompt_plan.json` への Import / conversion candidate として扱い、validation と user approval を必須にする。

## 11. Workflow Screen

Grok 操作ではなく Compiler 操作。

表示:

- Template version。
- Manifest version。
- Prompt Plan status。
- Models status。
- planned branch count。
- Compile action。
- generated branch count。
- node / link validation summary。
- generated Workflow diff / metadata。
- output file path。

最終成果物に unused branch が0件であることを明示できる。

## 12. R2 / Models Screen

`models.json` に対して Local / R2 の所在を一覧化する。

Batch Studio から destructive R2 operation を独自実装せず、必要操作を R2 File Manager へ引き渡す。

## 13. Preflight Screen

最終工程では subsystem ごとの状態を集約する。

```text
Artifacts
References
Workflow structure
Model availability
External dependencies
```

Blocking と Warning を分離し、READY 条件を明示する。

## 14. Grok Pane Controls

Local UI から Grok DOM を操作しない範囲で、shell control を提供できる。

候補:

- show / hide Grok pane。
- reload Grok pane。
- open Grok in external browser。
- resize divider。

Grok text injection、automatic send、file picker automation は含めない。

## 15. File Attachment UX

工程ごとに添付候補を allowlist 表示する。

各 file について:

- file name。
- absolute path。
- size。
- purpose。

`Open Folder` は Explorer を開く補助であり、Grok の file upload を代行しない。

`prompt_tree.md` は新規フローの標準添付候補に含めない。
