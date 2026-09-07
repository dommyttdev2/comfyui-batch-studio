# Prompt Plan Contract

Status: Draft schema / Decided semantics

## 1. 目的

`prompt_plan.json` は Grok が返す「意味的な生成計画」と Workflow Compiler の入力をつなぐ契約である。

このファイルは ComfyUI Workflow JSON ではない。ComfyUI 固有の Node / Link / Widget 構造を持たず、作品全体の共通 prompt、使用 LoRA、枝、葉 prompt を表す。

## 2. 決定済みの意味構造

Grok から最低限次を受け取る。

1. 共通 prompt。
2. 全枝共通で使用する LoRA。
3. Branch 一覧。
4. Branch ごとの LoRA。
5. Branch ごとの SceneMatrix 用 leaf prompt 群。

## 3. Draft JSON shape

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

## 4. common

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

## 5. rootLoras

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

## 6. Model reference

Prompt Plan に `.safetensors` の実ファイル名を何度も複製して書かせず、`models.json` 内の確定選定を一意に参照する方式を採る方向とする。

Draft field:

```json
"modelRef": "lora.pose.cowgirl"
```

Compiler はこの参照を `models.json` から実ファイル名へ解決する。

正式な reference field name と `models.json` schema はまだ Draft。

### 6.1 Invalid reference

`modelRef` を解決できない場合:

```text
Prompt Plan validation error
  -> Workflow Compile BLOCKED
```

自動的に似た名前の model へ置換しない。

## 7. branches

`branches` は意味的に異なる LoRA Stack / SceneMatrix 系列を表す。

```json
{
  "id": "b01",
  "label": "POV Cowgirl",
  "loras": [],
  "leaves": []
}
```

### 7.1 id

Compiler / UI / metadata が扱える安定識別子。

要件:

- Project 内で一意。
- 空でない。
- Branch 並べ替え後も可能な限り同一の意味に同じ id を維持する。

命名規約の厳密 schema は Draft。

### 7.2 label

人間向けの短い意味名。

Compiler は label を Node / Group title の生成材料に使えるが、ComfyUI title 全文を Grok に作らせない。

### 7.3 loras

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

## 8. leaves

`leaves` は当該 Branch の Main SceneMatrix に入る行を意味する。

```json
{
  "id": "s1-01-c1",
  "name": "S1-01_C1_sitting_desk",
  "positive": "sitting, desk, looking at viewer",
  "negative": "standing"
}
```

### 8.1 id

Compiler が `row_id` に変換できる一意識別子。

### 8.2 name

人間向け識別名と `path_label` 等の派生元。

### 8.3 positive / negative

その leaf 固有の prompt 差分。

原則として common prompt の全文を各 leaf に再掲しない。

概念上:

```text
final positive = template common + plan common positive + leaf positive
final negative = template common + plan common negative + leaf negative
```

実際の連結は ScenePrompter / SceneMatrix custom node の Workflow 構造に従う。

## 9. Grok が返さないフィールド

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

## 10. SceneMatrix mapping

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

## 11. Ordering

`branches` 配列順を Workflow 上の枝順とする。

`leaves` 配列順を SceneMatrix の行順とする。

別途 `order` を重複保持しないことを基本とする。

## 12. Validation

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

## 13. 将来拡張候補

意味的な要件が発生した場合のみ追加を検討する。

- leaf image count。
- generation phase / chapter metadata。
- output folder hint。
- seed policy。
- dimensions / aspect preset。
- per-branch generation settings。
- Prompt category 構造。

これらを ComfyUI Workflow 内部事情だけを理由に Prompt Plan へ追加しない。

## 14. prompt_tree.md との関係

未決。

`prompt_plan.json` は Workflow Compiler の入力として必須方向である。

`prompt_tree.md` は次のどちらかを今後決める。

- Grok が別途作る独立 Artifact。
- Prompt Plan から Batch Studio が生成する人間可読 view。

詳細は `project-artifacts.md` と Decision Log を参照する。
