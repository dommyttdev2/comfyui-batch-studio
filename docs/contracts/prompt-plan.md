# Prompt Plan Contract

Status: Active / Schema v1

## 1. 目的

`prompt_plan.json` は Grok が返す「意味的な生成計画」と Workflow Compiler の入力をつなぐ契約である。

このファイルは ComfyUI Workflow JSON ではない。ComfyUI 固有の Node / Link / Widget 構造を持たず、作品全体の共通 prompt、使用 LoRA、枝、葉 prompt を表す。

`prompt_plan.json` はプロジェクト内の確定済み Prompt Plan を表す標準ファイル名とする。Grok の回答をそのまま即時保存するのではなく、Batch Studio の検証とユーザー承認を経た内容だけをこのファイルへ確定する。

人間向けの確認・編集は `prompt_plan.json` を基に Batch Studio の Prompt Plan Web UI で提供する。新規方式では同内容を別の Markdown 正本として並行管理しない。

機械可読な正式 JSON Schema は次を正本とする。

```text
schemas/prompt-plan.schema.json
```

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
   +--> Prompt Plan Web UI
   |
   v
Workflow Compiler
```

原則:

- Workflow Compiler はプロジェクト直下の確定済み `prompt_plan.json` を Prompt Plan の機械可読入力として使用する。
- Prompt Plan Web UI も同じ `prompt_plan.json` を表示・編集対象とする。
- Grok の貼り戻し直後の内容は Draft であり、検証・承認前に `prompt_plan.json` を上書きしない。
- 確定前の候補は `._batch_studio/drafts/` で管理する。
- 確定版を更新する場合、更新前の版は `._batch_studio/history/` へ退避する。
- `prompt_plan_v2.json`、`prompt_plan_final.json`、`prompt_plan_final2.json` のように版管理をファイル名へ埋め込まない。
- 新規プロジェクトでは `prompt_tree.md` を生成・維持せず、Workflow Compiler の入力にも使用しない。

## 4. Schema v1

正式な field name は次とする。

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

### 4.1 Root fields

| Field | Requirement |
| --- | --- |
| `schemaVersion` | 必須。v1 は `1` |
| `common` | 必須 object |
| `rootLoras` | 必須 array。0件可 |
| `branches` | 必須 array。1件以上 |

Schema v1 では root を含む各 object に未知 field を許可しない。

```text
additionalProperties: false
```

汎用的な `metadata`、`extensions`、`extra` 等の自由記述領域は v1 に設けない。

### 4.2 Stable ID

Branch ID と Leaf ID の形式は次とする。

```regex
^[a-z][a-z0-9._-]{0,63}$
```

要件:

- 1〜64文字。
- 先頭は小文字英字。
- 以降は小文字英数字、`.`、`_`、`-` を許可する。
- Branch ID は Project 内の全 Branch で一意。
- Leaf ID は全 Branch を横断して Project 内で一意。
- 並べ替え後も同一の意味要素には可能な限り同じ ID を維持する。

JSON Schema 単体では object property を基準とした Project-wide uniqueness を十分に表現できないため、一意性は Batch Studio semantic validator でも必ず検証する。

## 5. common

`common` は全 Branch / leaf に共通するプロジェクト固有 prompt を表す。

```json
{
  "positive": "...",
  "negative": "..."
}
```

`positive` / `negative` はともに必須 string とし、空文字を許容する。

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

LoRA usage の正式 shape:

```json
{
  "modelRef": "lora.character",
  "strengthModel": 0.7,
  "strengthClip": 0.7
}
```

3 field はすべて必須とする。暗黙 default は持たない。

## 7. Model reference

Prompt Plan に `.safetensors` の実ファイル名を何度も複製して書かせず、`models.json` 内の確定選定を `modelRef` で一意に参照する。

```json
"modelRef": "lora.pose.cowgirl"
```

`modelRef` は必須の非空文字列とする。

`modelRef` という field name は Prompt Plan Schema v1 で正式採用する。一方、`lora.character` 等の **参照値そのものの命名規則と target identity** は `models.json` contract が所有する。

Compiler は `modelRef` を `models.json` から実ファイル名へ解決する。

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

ただし Schema v1 では `leaves` は1件以上を必須とする。

### 8.1 id

Compiler / UI / metadata が扱う stable ID。

形式と一意性は 4.2 に従う。

### 8.2 label

人間向けの短い意味名。

- 必須 string。
- 空文字不可。
- stable ID の文字制約は適用しない。

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

- `strengthModel` と `strengthClip` はともに必須 number。
- 暗黙 default を持たない。
- 0..1 等の固定範囲を Schema v1 では設けない。
- Root LoRA と Branch LoRA はそれぞれ実適用強度を持てる。
- Batch Studio の Web UI から `prompt_plan.json` 側の強度を調整できる。
- UI で実適用強度を変更しても `models.json` の推奨・基準値は変更しない。
- Compiler は `prompt_plan.json` の実適用強度を最終 Workflow の LoRA Stack へ反映する。

Civitai 由来の基準値を `prompt_plan.json` の初期値へどう反映するかは別途決める。特に Civitai 側で得られる weight が単一値である場合、それを `strengthModel` / `strengthClip` へどのように展開するかは `OPEN-006` の責務とする。

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

Branch ごとに1件以上を必須とする。

### 9.1 id

Compiler が `row_id` に変換できる stable ID。

形式と Project-wide uniqueness は 4.2 に従う。

### 9.2 name

人間向け識別名と `path_label` 等の派生元。

- 必須 string。
- 空文字不可。
- stable ID の文字制約は適用しない。

### 9.3 positive / negative

その leaf 固有の prompt 差分。

- ともに必須 string。
- 空文字を許容する。

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

未知 field を Schema v1 で許可しないため、Grok がこれらを追加した場合は schema validation で検出可能とする。

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

別途 `order` field を重複保持しない。

Prompt Plan Web UI で並べ替えた場合は、対応する配列自体の順序を変更する。

## 13. Validation

Validation は次の2層で行う。

```text
JSON Schema validation
  +
Batch Studio semantic validation
```

### 13.1 JSON Schema validation

`schemas/prompt-plan.schema.json` により少なくとも次を検証する。

- `schemaVersion == 1`。
- 必須 field の存在。
- field type。
- Branch 1件以上。
- Branch ごとの Leaf 1件以上。
- stable ID pattern / length。
- label / name が非空。
- LoRA usage の `modelRef` / `strengthModel` / `strengthClip` が必須。
- 未知 field が存在しない。

### 13.2 Semantic validation

JSON Schemaだけでは表現しにくい次を Batch Studio が検証する。

- Branch ID の Project-wide uniqueness。
- Leaf ID の Project-wide uniqueness。
- `modelRef` が `models.json` で解決可能。
- 同じ Root / Branch 内の明らかな重複 LoRA reference を warning。
- 必要に応じた cross-artifact validation。

解決不能 `modelRef` は Workflow Compile を BLOCKED とする。

## 14. Schema evolution / 将来拡張

Schema v1 には汎用 `metadata` / `extensions` / `extra` field を設けない。

意味的な要件が発生した場合のみ正式 schema 変更を検討する。

候補:

- leaf image count。
- generation phase / chapter metadata。
- output folder hint。
- seed policy。
- dimensions / aspect preset。
- per-branch generation settings。
- Prompt category 構造。

これらを ComfyUI Workflow 内部事情だけを理由に Prompt Plan へ追加しない。

既存 v1 が受理しない新 field を追加する場合は、後方互換性を評価し、必要なら `schemaVersion` を更新して migration policy を定義する。

## 15. Human-readable view / Legacy prompt_tree.md

人間向けの Prompt 構造は Batch Studio の Prompt Plan Web UI で表示・編集する。

```text
prompt_plan.json
   |
   +--> Prompt Plan Web UI
   |
   `--> Workflow Compiler
```

Web UI は少なくとも common、Root LoRA、Branch、Branch LoRA、leaf prompt、validation state を人間が追跡できる形で表示する。

UI の変更は `prompt_plan.json` の編集として扱う。表示用 Markdown を別の正本として生成・維持しない。

`prompt_tree.md` は Legacy Artifact とする。

- 新規プロジェクトでは生成しない。
- Workflow Compiler の入力にしない。
- Grok への Workflow 生成用添付として使用しない。
- 既存プロジェクトに存在する場合は Legacy import / migration 候補として扱える。
- Legacy 内容を新方式へ移行する場合は、Batch Studio の検証とユーザー承認を経て `prompt_plan.json` として確定する。

詳細は `project-artifacts.md` と Decision Log を参照する。
