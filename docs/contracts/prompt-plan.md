# Prompt Plan Contract

Status: Draft schema / Decided semantics

## 1. 目的

`prompt_plan.json` は Grok が返す「意味的な生成計画」と Workflow Compiler の入力をつなぐ契約である。

このファイルは ComfyUI Workflow JSON ではない。ComfyUI 固有の Node / Link / Widget 構造を持たず、作品全体の共通 prompt、使用 LoRA、枝、葉 prompt を表す。

`prompt_plan.json` はプロジェクト内の確定済み Prompt Plan を表す標準ファイル名とする。Grok の回答をそのまま即時保存するのではなく、Batch Studio の検証とユーザー承認を経た内容だけをこのファイルへ確定する。

## 2. 決定済みの意味構造

Grok から最低限次を受け取る。

1. 共通 prompt。
2. 全枝共通で使用する LoRA。
3. Root LoRA の実適用強度。
4. Branch 一覧。
5. Branch ごとの LoRA。
6. Branch LoRA の実適用強度。
7. Branch ごとの SceneMatrix 用 leaf prompt 群。

## 3. Artifact lifecycle

標準ファイル名:

```text
prompt_plan.json
```

プロジェクトごとに、現在の確定版は1ファイルだけを持つ。

```text
Grok response
   |
   v
Draft
   |
   v
Batch Studio validation
   |
   v
User approval
   |
   v
prompt_plan.json
   |
   v
Workflow Compiler
```

原則:

- Workflow Compiler はプロジェクト直下の確定済み `prompt_plan.json` を Prompt Plan の機械可読入力として使用する。
- Grok の貼り戻し直後の内容は Draft であり、検証・承認前に `prompt_plan.json` を上書きしない。
- 確定前の候補は `._batch_studio/drafts/` で管理する。
- 確定版を更新する場合、更新前の版は `._batch_studio/history/` へ退避する。
- `prompt_plan_v2.json`、`prompt_plan_final.json`、`prompt_plan_final2.json` のように版管理をファイル名へ埋め込まない。
- 正式 field name と JSON Schema は別途確定する。ファイル名と lifecycle の確定は schema の未決事項に依存しない。

`prompt_tree.md` が独立正本か派生成果物かは別要件であり、本節では決めない。

## 4. Draft JSON shape

```json
{
  "schemaVersion": 1,
  "common": {
    "positive": "project common positive prompt",
    "negative": "project common negative prompt"
  },
  "rootLoras": [
    {
      "modelRef": "lora.character",
      "strengthModel": 0.7,
      "strengthClip": 0.7
    }
  ],
  "branches": [
    {
      "id": "b01",
      "label": "Daily / no pose LoRA",
      "loras": [
        {
          "modelRef": "lora.body",
          "strengthModel": 0.55,
          "strengthClip": 0.55
        }
      ],
      "leaves": [
        {
          "id": "s1-01-c1",
          "name": "S1-01_C1_sitting_desk",
          "positive": "sitting, desk, looking at viewer, cowboy shot",
          "negative": "standing, outdoor"
        }
      ]
    }
  ]
}
```

フィールド名は実装前に JSON Schema として固定するため Draft。意味は本書の記述を基準とする。

## 5. common

`common` は全 Branch / leaf に共通するプロジェクト固有 prompt を表す。

```json
{
  "positive": "...",
  "negative": "..."
}
```

対象例:

- キャラクターの不変視覚特徴。
- 作品全体で維持する POV / 構図前提。
- プロジェクト共通の画風指定。
- プロジェクト共通の除外事項。

Template 自体が所有する品質 preset 等は `common` へ重複させない。Template-owned prompt と Plan-owned prompt の境界は Workflow Compiler が Manifest で管理する。

## 6. rootLoras

全 Branch に共通適用する LoRA。

主用途:

- Character LoRA。
- 全シーン共通 Style LoRA。
- 全シーン共通 Concept LoRA。

Root LoRA が不要な場合:

```json
"rootLoras": []
```

を許容する。

## 7. Model reference

Prompt Plan に `.safetensors` の実ファイル名を何度も複製して書かせず、`models.json` 内の確定選定を一意に参照する方式を採る方向とする。

Draft field:

```json
"modelRef": "lora.pose.cowgirl"
```

Compiler はこの参照を `models.json` から実ファイル名へ解決する。

正式な reference field name と `models.json` schema はまだ Draft。

### 7.1 Invalid reference

`modelRef` を解決できない場合:

```text
Prompt Plan validation error
  -> Workflow Compile BLOCKED
```

自動的に似た名前の model へ置換しない。

## 8. branches

`branches` は意味的に異なる LoRA Stack / SceneMatrix 系列を表す。

```json
{
  "id": "b01",
  "label": "POV Cowgirl",
  "loras": [],
  "leaves": []
}
```

### 8.1 id

Compiler / UI / metadata が扱える安定識別子。

要件:

- Project 内で一意。
- 空でない。
- Branch 並べ替え後も可能な限り同一の意味に同じ id を維持する。

命名規約の厳密 schema は Draft。

### 8.2 label

人間向けの短い意味名。

Compiler は label を Node / Group title の生成材料に使えるが、ComfyUI title 全文を Grok に作らせない。

### 8.3 loras

当該 Branch だけに適用する LoRA。

```json
"loras": [
  {
    "modelRef": "lora.pose.cowgirl",
    "strengthModel": 0.65,
    "strengthClip": 0.65
  }
]
```

0件を許容する。

Branch LoRA が0件でも、Root LoRA + common prompt + leaf prompt で生成する有効 Branch であり得る。

### 8.4 LoRA strength ownership

`prompt_plan.json` に保存する strength は、そのプロジェクトで **実際に Workflow へ適用する値** である。

`models.json` に保存する Civitai 由来の推奨・基準強度とは責務が異なる。

```text
models.json
  = model/version に紐づく Civitai 由来の基準情報

prompt_plan.json
  = Root / Branch ごとに実際に使用する可変値
```

要件:

- Root LoRA と Branch LoRA はそれぞれ実適用強度を持てる。
- Batch Studio の Web UI から `prompt_plan.json` 側の強度を調整できる。
- UI で実適用強度を変更しても `models.json` の推奨・基準値は変更しない。
- Compiler は `prompt_plan.json` の実適用強度を最終 Workflow の LoRA Stack へ反映する。

Civitai 由来の基準値を `prompt_plan.json` の初期値へどう反映するかは別途決める。特に Civitai 側で得られる weight が単一値である場合、それを `strengthModel` / `strengthClip` へどのように展開するかは未決である。

## 9. leaves

`leaves` は当該 Branch の Main SceneMatrix に入る行を意味する。

```json
{
  "id": "s1-01-c1",
  "name": "S1-01_C1_sitting_desk",
  "positive": "sitting, desk, looking at viewer",
  "negative": "standing"
}
```

### 9.1 id

Compiler が `row_id` に変換できる一意識別子。

### 9.2 name

人間向け識別名と `path_label` 等の派生元。

### 9.3 positive / negative

その leaf 固有の prompt 差分。

原則として common prompt の全文を各 leaf に再掲しない。

概念上:

```text
final positive = template common + plan common positive + leaf positive
final negative = template common + plan common negative + leaf negative
```

実際の連結は ScenePrompter / SceneMatrix custom node の Workflow 構造に従う。

## 10. Grok が返さないフィールド

次は Prompt Plan の責務外。

```text
node_id
link_id
group_id
position
mode
filename_enabled
positive_json
negative_json
positive_parts
negative_parts
category_order
display_labels
widgets_values
widgets_values_named
scene_matrix_json
```

これらは Workflow Compiler が生成する。

## 11. SceneMatrix mapping

1 leaf から Compiler は Main SceneMatrix の1行を作る。

概念 mapping:

| Prompt Plan | SceneMatrix |
| --- | --- |
| `leaf.id` | `row_id` |
| `leaf.name` | `name`, `path_label` |
| `leaf.positive` | `positive_base` |
| `leaf.negative` | `negative_base` |
| - | `enabled: true` |
| - | `filename_enabled: true` |
| - | empty category JSON / parts 等 |

Custom node schema が変化した場合は Prompt Plan schema を変えず、Compiler adapter だけを更新できることを目標とする。

## 12. Ordering

`branches` 配列順を Workflow 上の枝順とする。

`leaves` 配列順を SceneMatrix の行順とする。

別途 `order` を重複保持しないことを基本とする。

## 13. Validation

最低限:

### Root

- `schemaVersion` が対応版。
- `branches` が配列。
- Branch が1件以上。

### LoRA

- model reference が `models.json` で解決可能。
- strength が有限数。
- 同じ Branch 内の明らかな重複参照を警告。

LoRA strength の許容範囲は現時点で固定しない。モデルによって 0..1 に限定できない可能性があるため、範囲は別要件として判断する。

### Branch

- `id` 一意。
- `label` 空でない。
- `leaves` 1件以上。

### Leaf

- `id` が Project 内で一意、または少なくとも Branch 内で一意とする正式範囲を実装前に確定。
- `name` 空でない。
- positive / negative は string。

## 14. 将来拡張候補

意味的な要件が発生した場合のみ追加を検討する。

- leaf image count。
- generation phase / chapter metadata。
- output folder hint。
- seed policy。
- dimensions / aspect preset。
- per-branch generation settings。
- Prompt category 構造。

これらを ComfyUI Workflow 内部事情だけを理由に Prompt Plan へ追加しない。

## 15. prompt_tree.md との関係

未決。

`prompt_plan.json` は Workflow Compiler の確定済み機械可読入力である。

`prompt_tree.md` は次のどちらかを今後決める。

- Grok が別途作る独立 Artifact。
- Prompt Plan から Batch Studio が生成する人間可読 view。

詳細は `project-artifacts.md` と Decision Log を参照する。
