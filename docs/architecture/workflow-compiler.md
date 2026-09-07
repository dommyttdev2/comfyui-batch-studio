# Workflow Compiler Architecture

Status: Active / schema details partially Draft

## 1. 目的

最終 ComfyUI Workflow は Grok に生成させず、Batch Studio が既存形式をもとに機械生成する。

Workflow Compiler の目的は、意味情報だけを持つ `prompt_plan.json` と、選定済みモデル情報を持つ `models.json` を、既存 ComfyUI Workflow の固定構造へ安全かつ決定論的に落とし込むことである。

## 2. 基本方針

### 2.1 Template は最小構成

基本 Workflow Template は次だけを持つ。

```text
Common Area
  +
Branch Prototype x 1
```

複数枝をあらかじめ予約しない。

### 2.2 必要数だけ枝を生成

`prompt_plan.json` の `branches.length` が N の場合、最終 Workflow には N 枝だけ存在させる。

```text
Template
  Common
  Branch Prototype x1
       |
       v
Compiler
       |
       +--> Branch 1
       +--> Branch 2
       +--> ...
       `--> Branch N
```

未使用枝、空の予約枝、未使用枝用 bypass chain は最終成果物に残さない。

### 2.3 Grok から ComfyUI 内部形式を受け取らない

Compiler が生成するため、Grok は次を知らない。

- Node ID
- Link ID
- Group ID / bounding
- node position
- `mode`
- `widgets_values`
- `widgets_values_named`
- `scene_matrix_json`
- `SCENE_MATRIX_LINE` 内部フィールド
- Save node path の内部 widget 配置

## 3. 既存 Workflow から確認できる構造

提供された既存 Workflow 群では、共通 Root と複数の同型 Branch が存在する。

代表的な Branch は概ね次の生成 chain を持つ。

```text
Branch LoRA Stack
   |
Main SceneMatrix
   |
Optional/Fixed Matrix
   |
ScenePrompter
   |
ScenePromptCounter
   |
SceneEmptyLatent
   |
ScenePrompterExpand
   +--> Positive CLIPTextEncode
   +--> Negative CLIPTextEncode
   +--> metadata / seed / latent
           |
        KSampler
           |
        VAEDecode
           |
        SceneSaveImage
```

実際の Template でどのノードを Branch Prototype に含めるかは Node type の推測ではなく Manifest で宣言する。

## 4. Compiler Inputs

必須入力:

1. Workflow Template JSON
2. Workflow Template Manifest
3. `models.json`
4. `prompt_plan.json`
5. Project metadata

任意入力:

- output naming policy
- compiler configuration
- compatibility/migration policy

## 5. Template Manifest

Node ID を Compiler code に散在させない。

Manifest は少なくとも次の概念を持つ。

```json
{
  "schemaVersion": 1,
  "templateVersion": "...",
  "commonRoles": {
    "checkpoint": 1,
    "rootLoraStack": 2,
    "planCommonPrompt": 135
  },
  "branchPrototype": {
    "groupId": 2,
    "nodeIds": [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
    "roles": {
      "loraStack": 3,
      "mainMatrix": 4,
      "fixedMatrix": 5,
      "prompter": 6,
      "counter": 7,
      "latent": 8,
      "expand": 9,
      "positiveEncode": 10,
      "negativeEncode": 11,
      "sampler": 12,
      "vaeDecode": 13,
      "save": 14
    },
    "layout": {
      "verticalGap": 460
    }
  }
}
```

上記は概念例であり、正式 schema は Draft。実装前に Template 実体と合わせて固定する。

Manifest が持つべき情報:

- Common 可変ノードの role。
- Branch Prototype の node 集合。
- Branch Prototype の Group。
- Branch 内 role と node の対応。
- Common と Branch の接続境界。
- 複製時の layout policy。
- Template version。

## 6. Common Area

Common Area は全枝で共有する。

### 6.1 Checkpoint

`models.json` の選定済み Checkpoint を Template の Checkpoint node に設定する。

### 6.2 Root LoRA Stack

全枝に共通する LoRA を設定する。

主用途:

- Character LoRA
- 全シーン共通 Style / Concept LoRA

Root LoRA が不要な場合は Stack を空にできる。

### 6.3 Common Prompt

共通 Prompt には二種類ある。

1. **Template-owned static prompt**
   - 品質 preset 等、Workflow Template 自体が所有する固定設定。
2. **Plan-owned common prompt**
   - Grok が `prompt_plan.json` で返すプロジェクト固有の共通 positive / negative。

両者を同じ責務に混ぜない。Compiler は Manifest で指定された plan-owned slot だけを Grok 出力で更新する。

## 7. Branch Prototype Clone

### 7.1 Branch 1

Template の Prototype 自体を Branch 1 として再利用する。

### 7.2 Branch 2 以降

Prototype の以下を deep clone する。

- Nodes
- Branch 内 Links
- Group
- Branch 固有 Reroute 等、Manifest が Prototype 所属と定義した要素

### 7.3 ID remap

Clone ごとに次の map を作る。

```text
oldNodeId -> newNodeId
oldLinkId -> newLinkId
oldGroupId -> newGroupId
```

再採番対象:

- `node.id`
- `inputs[].link`
- `outputs[].links[]`
- root `links` table 内の link id / origin / target
- Group id
- その他 ID 参照を持つ Template 固有 metadata

最終的に `last_node_id`、`last_link_id` を更新する。

### 7.4 Common boundary

Prototype 内部 link は clone する。

Root LoRA 等の Common 出力から Branch entry への接続は、新しい Branch ごとに新規 Link を生成する。

```text
Root Model/Clip
  +--> Branch 1
  +--> Branch 2
  +--> Branch 3
  `--> Branch N
```

## 8. Layout

枝は Template の Prototype 座標を基準に機械配置する。

概念式:

```text
branchY(index) = prototypeY + index * verticalGap
```

Node 個別座標だけでなく Group bounding も同じ offset で移動する。

`verticalGap` は Compiler code の magic number ではなく Manifest / Template policy とする。

## 9. Branch Configuration

各 `prompt_plan.branches[]` について次を設定する。

### 9.1 Branch LoRA Stack

当該 Branch だけで必要な LoRA を設定する。

例:

- Pose LoRA
- Situation LoRA
- 特定衣装 LoRA
- 特定カメラ /構図用 LoRA

LoRA が0件でも Branch 自体に有効な leaf が存在するなら、その Branch は有効な生成枝である。Root LoRA と Prompt だけで生成できるためである。

### 9.2 Main SceneMatrix

Grok の leaf を `SCENE_MATRIX_LINE` へ変換する。

Grok 側:

```json
{
  "id": "s1-01-c1",
  "name": "S1-01_C1_sitting_desk",
  "positive": "sitting, desk, looking at viewer",
  "negative": "standing"
}
```

Compiler 側の概念出力:

```json
{
  "type": "SCENE_MATRIX_LINE",
  "version": 1,
  "row_id": "s1-01-c1",
  "node_id": "",
  "category": "",
  "name": "S1-01_C1_sitting_desk",
  "path_label": "S1-01_C1_sitting_desk",
  "enabled": true,
  "filename_enabled": true,
  "positive_base": "sitting, desk, looking at viewer",
  "positive_json": "{\"version\":1,\"categories\":{}}",
  "negative_base": "standing",
  "negative_json": "{\"version\":1,\"categories\":{}}",
  "category_order": "",
  "positive_parts": [],
  "negative_parts": [],
  "display_labels": [],
  "display_label_groups": []
}
```

内部形式は Template/custom node version に依存するため Compiler adapter が所有する。

### 9.3 固定 Matrix / Prompter

Template が固定 camera matrix、追加 trigger node 等を含む場合、Template-owned default を維持する。

Prompt Plan がその役割を明示的に所有するよう schema 拡張されるまで、Grok に内部設定を返させない。

### 9.4 Counter / Latent / Sampler

原則 Template-owned generation defaults とする。

将来ユーザー要件により可変化する場合は Prompt Plan へ安易に追加せず、「プロジェクト生成設定」と「意味的 Prompt Plan」のどちらが所有するかを先に決める。

### 9.5 Title / Save Path

Node title、Group title、Save path は Grok の自由文ではなく Compiler の naming policy から生成する。

Branch `id` / `label` を入力として派生させる。

## 10. Branch Count

Template 上の予約本数による上限は設けない。

最低条件:

```text
branches.length >= 1
```

異常値防止の safety cap が必要な場合は、Template 制約ではなくアプリ設定として別途決定する。

## 11. No Unused Branch Invariant

最終 Workflow の invariant:

> `Final branch count == prompt_plan.branches.length`

次を禁止する。

- `UNUSED` branch title
- 空 Matrix の予約 Branch
- 「将来用」の bypass Branch chain
- Template 上の余剰 Prototype clone

## 12. Determinism

同じ以下の入力からは意味的に同じ Workflow を生成できることを目標とする。

```text
Template version
+ Manifest version
+ models.json
+ prompt_plan.json
+ compiler version/config
```

将来、再現性を厳密化する場合は上記 hash を project metadata に保存する。

## 13. Compiler Validation

Compile 前:

- Template / Manifest の schema。
- Manifest role node が Template に存在する。
- Prototype boundary が一意。
- `models.json` ref が解決可能。
- Prompt Plan の枝・葉が有効。

Compile 後:

- JSON 構文。
- Node ID 重複なし。
- Link ID 重複なし。
- dangling link なし。
- Group ID 重複なし。
- Branch count 一致。
- 全 Branch の main Matrix が非空。
- LoRA file が `models.json` に存在。
- `filename_enabled` 等 Compiler-owned invariant が成立。
- `last_node_id` / `last_link_id` 整合。

## 14. 今後確定する項目

- Manifest 正式 JSON Schema。
- Template-owned common prompt node と plan-owned node の正式 role。
- branch Prototype に含める Reroute / Group / metadata の境界。
- Branch naming policy。
- Save path policy。
- image count の所有元。
- Compiler version / Template hash の project metadata 保存形式。
