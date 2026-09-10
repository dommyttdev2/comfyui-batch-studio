# Workflow Compiler Architecture

Status: Active / Manifest Schema v1 / Naming and Count Policy v1

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

実際の Template でどのノードを Branch Prototype に含めるかは Node type や Group membership の推測ではなく Manifest で宣言する。

Branch 専用 Reroute 等が視覚 Group 外に存在していても、Manifest の `branchPrototype.nodeIds` に含まれていれば Branch 所有要素として扱う。

## 4. Compiler Inputs

必須入力:

1. Workflow Template JSON
2. Workflow Template Manifest
3. `models.json`
4. `prompt_plan.json`
5. Project metadata

任意入力:

- compiler configuration
- compatibility/migration policy

v1 の naming / save path / image count rule は Compiler contract として固定し、Grok の自由文や任意 naming policy input で上書きしない。

## 5. Workflow Template Manifest Schema v1

Node ID を Compiler code に散在させない。

機械可読な正式 JSON Schema:

```text
schemas/workflow-template-manifest.schema.json
```

Manifest root fields:

```text
schemaVersion
manifestVersion
template
common
branchPrototype
```

概念例:

```json
{
  "schemaVersion": 1,
  "manifestVersion": "1.0.0",
  "template": {
    "id": "default-scene-batch",
    "version": "1.0.0",
    "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  },
  "common": {
    "roles": {
      "checkpoint": {"nodeId": 1},
      "rootLoraStack": {"nodeId": 2},
      "planCommonPrompt": {"nodeId": 140},
      "promptOutput": {"nodeId": 142}
    }
  },
  "branchPrototype": {
    "nodeIds": [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 143],
    "groupIds": [2],
    "roles": {
      "loraStack": {"nodeId": 3},
      "promptIngress": {"nodeId": 143},
      "mainMatrix": {"nodeId": 4},
      "fixedMatrix": {"nodeId": 5},
      "prompter": {"nodeId": 6},
      "counter": {"nodeId": 7},
      "latent": {"nodeId": 8},
      "expand": {"nodeId": 9},
      "positiveEncode": {"nodeId": 10},
      "negativeEncode": {"nodeId": 11},
      "sampler": {"nodeId": 12},
      "vaeDecode": {"nodeId": 13},
      "save": {"nodeId": 14}
    },
    "boundaries": [
      {
        "id": "model",
        "source": {"role": "rootLoraStack", "slot": 0},
        "target": {"role": "loraStack", "slot": 0}
      },
      {
        "id": "clip",
        "source": {"role": "rootLoraStack", "slot": 1},
        "target": {"role": "loraStack", "slot": 1}
      }
    ],
    "layout": {
      "offset": {"x": 0, "y": 460}
    }
  }
}
```

Node / Group ID と slot 番号は Template 固有値であり、この例の数値を Compiler code に固定しない。

Schema v1 では各 object に未知 field を許可せず、汎用 `metadata` / `extensions` / `extra` 領域を設けない。

```text
additionalProperties: false
```

## 6. Manifest Role Contract

Compiler が知るのは Node ID ではなく role 名である。

```text
Compiler
   -> semantic role
Manifest
   -> nodeId / slot
Template
```

Template 内の Node ID が変更されても、role の意味が維持される限り Manifest を更新して Compiler 本体を変更しないことを目標とする。

### 6.1 Common roles

Schema v1 の必須 Common roles:

```text
checkpoint
rootLoraStack
planCommonPrompt
promptOutput
```

意味:

- `checkpoint`: `models.json.checkpoint` を反映する Node。
- `rootLoraStack`: `prompt_plan.rootLoras` を反映する全 Branch 共通 LoRA Stack。
- `planCommonPrompt`: `prompt_plan.common` を反映する plan-owned prompt Node。
- `promptOutput`: Common prompt trunk から Branch へ fan-out する出力 Node。

Role は同一 Node ID を共有してよい。例えば Template 構造上 `planCommonPrompt` と `promptOutput` が同じ Node なら、両 role に同じ `nodeId` を指定できる。

### 6.2 Branch roles

Schema v1 の必須 Branch roles:

```text
loraStack
promptIngress
mainMatrix
prompter
counter
latent
expand
positiveEncode
negativeEncode
sampler
vaeDecode
save
```

任意 role:

```text
fixedMatrix
```

`fixedMatrix` が存在する場合は Template-owned default として保持する。存在しない Template も Schema v1 で有効とする。

`promptIngress` は Common prompt 境界の Branch 側入口を表す。Reroute が存在する Template ではその Reroute を指定でき、Reroute を使用しない Template では別 role と同じ Node ID を指定できる。

Branch role が指す Node はすべて `branchPrototype.nodeIds` に含まれなければならない。

## 7. Prototype Ownership

### 7.1 Node ownership

Branch と一緒に複製する Node の正本は次とする。

```text
branchPrototype.nodeIds[]
```

視覚 Group に含まれているかどうかで ownership を推測しない。

したがって、Branch 専用 Reroute や補助 Node が Group 外に存在する場合でも `nodeIds` に含められる。

### 7.2 Group ownership

複製する Group の正本:

```text
branchPrototype.groupIds[]
```

Group は視覚配置情報であり、Node ownership の正本ではない。

```text
node ownership = nodeIds
group cloning  = groupIds
```

`groupIds` は0件でもよい。

### 7.3 Internal links

Prototype 内部 Link ID は Manifest に列挙しない。

Template の root `links` table から、origin / target の両 Node が Prototype 所属なら内部 Link と決定論的に導出する。

```text
originNodeId in branchPrototype.nodeIds
AND
targetNodeId in branchPrototype.nodeIds

=> internal prototype link
=> Branch clone 対象
```

これにより Manifest を第二の Workflow JSON にしない。

## 8. Common / Branch Boundary

Schema v1 の Boundary は **Common -> Branch** を表す。

```json
{
  "id": "model",
  "source": {
    "role": "rootLoraStack",
    "slot": 0
  },
  "target": {
    "role": "loraStack",
    "slot": 0
  }
}
```

`slot` は Template 固有の ComfyUI slot index であり、Compiler code に Model / CLIP / VAE 等の slot 番号をハードコードしない。

Compile 前 validation では次を要求する。

- Boundary `id` が Manifest 内で一意。
- source role は Common role として存在する。
- target role は Branch role として存在する。
- 宣言された Boundary に一致する Template Link がちょうど1本存在する。
- Prototype ownership 境界を跨ぐすべての Link が Manifest `boundaries[]` にちょうど1回宣言される。
- Manifest に未宣言の cross-boundary Link が存在しない。

Branch 2 以降では Common source から cloned Branch target へ新しい Link ID を割り当てて接続する。

```text
Common source
  +--> Branch 1 target
  +--> Branch 2 target
  +--> ...
  `--> Branch N target
```

v1 が表現できない逆向きまたは特殊な boundary topology が必要になった場合は、Compiler が暗黙対応せず Manifest schema evolution として扱う。

## 9. Template Binding / Versioning

Manifest は Workflow Template 実体へ厳密に bind する。

```json
{
  "template": {
    "id": "default-scene-batch",
    "version": "1.0.0",
    "sha256": "..."
  }
}
```

意味:

```text
template.id
  = Template 系列の stable ID

template.version
  = Template の人間向け release version

template.sha256
  = Template ファイル実体との exact binding
```

`template.sha256` は Workflow Template JSON の **UTF-8 file bytes そのもの**に対して SHA-256 を計算する。

Compile 時に実ファイル hash が一致しない場合:

```text
Template SHA-256 mismatch
  -> Compile BLOCKED
```

Template を変更した場合は Template version と Manifest を明示的に更新する。

### 9.1 Manifest version

Manifest 自身は次を持つ。

```text
schemaVersion
manifestVersion
```

責務:

```text
schemaVersion
  = Manifest JSON 構造仕様の version

manifestVersion
  = 当該 Manifest 実体の release version
```

v1 の `manifestVersion` / `template.version` は `major.minor.patch` 形式とする。

## 10. Branch Prototype Clone

### 10.1 Branch 1

Template の Prototype 自体を Branch 1 として再利用する。

### 10.2 Branch 2 以降

Manifest ownership に基づき次を deep clone する。

- `branchPrototype.nodeIds` の Nodes。
- 両端が Prototype Node の内部 Links。
- `branchPrototype.groupIds` の Groups。

### 10.3 ID remap

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

## 11. Layout

Branch配置は `branchPrototype.layout.offset` を正本とする。

```json
{
  "layout": {
    "offset": {
      "x": 0,
      "y": 460
    }
  }
}
```

Branch index を0始まりとすると:

```text
branchOffsetX(index) = offset.x * index
branchOffsetY(index) = offset.y * index
```

Branch 1 は index 0 なので Template 位置をそのまま使用する。

Node の `pos` と複製対象 Group の bounding へ同じ offset を適用する。

枝間隔を Compiler code の magic number にしない。

`offset.x == 0 && offset.y == 0` 等、複数 Branch が重なる設定は semantic validation で検出して blocking error にできる。

## 12. Branch Configuration / Naming / Count Policy v1

各 `prompt_plan.branches[]` について次を設定する。

### 12.1 Branch LoRA Stack

当該 Branch だけで必要な LoRA を設定する。

例:

- Pose LoRA
- Situation LoRA
- 特定衣装 LoRA
- 特定カメラ / 構図用 LoRA

LoRA が0件でも Branch 自体に有効な leaf が存在するなら、その Branch は有効な生成枝である。Root LoRA と Prompt だけで生成できるためである。

### 12.2 Main SceneMatrix / Leaf identity

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
  "path_label": "s1-01-c1",
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

正式 mapping:

```text
leaf.id   -> row_id
leaf.id   -> path_label
leaf.name -> name
```

`leaf.id` は Project-wide unique かつ filesystem-safe stable ID なので、出力identityにも使用する。`leaf.name` は人間向け名称であり、filesystem identityには使用しない。

内部形式は Template/custom node version に依存するため Compiler adapter が所有する。

### 12.3 Fixed Matrix / Prompter cardinality

Template が固定 camera matrix、追加 trigger node 等を含む場合、Template-owned default を維持する。

ただし v1 Template は **1 Prompt Plan leaf を複数generationへ暗黙増幅してはならない**。

```text
1 Prompt Plan leaf
  -> 1 ScenePromptCounter item
  -> 1 generation
```

`fixedMatrix` 等の Template-owned node が Cartesian product 等によりleafを2倍・4倍へ増幅する構成は v1 Template として無効とする。

Prompt Plan がその役割を明示的に所有するよう将来schema拡張されるまで、Grok に内部設定を返させない。

### 12.4 Counter / image count

v1 は次を固定する。

```text
imagesPerLeaf = 1
```

Compiler は各 Branch の `counter` role Nodeを **1 image per leaf** となるようpatchし、`count = 1` を設定する。Grok / Prompt Plan / Template default から別値を指定しない。

したがって:

```text
branchImageCount(branch)
  = branch.leaves.length

projectImageCount
  = sum(branch.leaves.length)
```

`project_brief.json.generation.target_image_count` は Prompt Planning の目標値であり、実枚数の正本ではない。

```text
targetImageCount = 500
actualImageCount = 504
Delta            = +4
```

この差分は UI / Preflight で warning / informational status として表示できるが、差分だけでは Compile をBlockしない。

Latent / Sampler 等のその他generation defaultは原則 Template-owned とする。将来可変化する場合は Prompt Planへ安易に追加せず、「プロジェクト生成設定」と「意味的 Prompt Plan」のどちらが所有するかを先に決める。

### 12.5 Human-readable titles

`branch.label` は人間向け表示にのみ使用する。filesystem identityには使用しない。

Compiler が動的に設定するtitleは次を標準とする。

```text
Group:
Gen - {branch.id} - {displayLabel} ({branchImageCount})

Branch LoRA Stack:
LoRA - {branch.id} - {displayLabel}

Main SceneMatrix:
Prompt - {branch.id} - {displayLabel} ({branchImageCount})

ScenePromptCounter:
1 image per leaf

SceneSaveImage:
Save - {branch.id} - {displayLabel} ({branchImageCount})
```

`displayLabel` は表示時だけ次の正規化を行う。

- 前後空白を除去。
- CR/LFを空白へ置換。
- 連続空白を1個へ圧縮。
- UI / Workflow title用には最大80文字でtruncate可能。

この正規化で `prompt_plan.json` の元 `branch.label` を変更しない。

Sampler / Encode / VAE Decode / Prompter 等、上記以外の内部Node titleは原則 Template titleを維持する。

### 12.6 Workflow filename / save path

新規確定Workflow filename:

```text
LoRA_{project.id}.json
```

例:

```text
project.id = 15_office_boss
-> LoRA_15_office_boss.json
```

BranchのSceneSaveImage保存先はCompilerが次から派生する。

```text
BatchStudio/{project.id}/{branch.id}
```

例:

```text
BatchStudio/15_office_boss/b01
BatchStudio/15_office_boss/b02
```

原則:

- `project.title` をfilesystem pathに使用しない。
- `branch.label` をfilesystem pathに使用しない。
- Grokに保存先を生成させない。
- Templateに残った旧Projectの保存先をそのまま継承しない。

`project.id` の形式はProject contractで次を要求する。

```regex
^[a-z0-9][a-z0-9._-]{0,63}$
```

### 12.7 Physical output filename boundary

Batch Studio / Compiler が所有するのは次までとする。

```text
save directory
+ leaf path_label / output identity
+ filename_enabled = true
```

実ファイルの以下は `SceneSaveImage` custom node の保存実装に委ね、Batch Studioで重複実装しない。

- extension
- numeric sequence / collision suffix
- timestamp suffix
- seed等のcustom-node固有suffix

```text
Batch Studio
  -> directory + path_label

SceneSaveImage
  -> final physical filename
```

## 13. Branch Count

Template 上の予約本数による上限は設けない。

最低条件:

```text
branches.length >= 1
```

異常値防止の safety cap が必要な場合は、Template 制約ではなくアプリ設定として別途決定する。

## 14. No Unused Branch Invariant

最終 Workflow の invariant:

> `Final branch count == prompt_plan.branches.length`

次を禁止する。

- `UNUSED` branch title
- 空 Matrix の予約 Branch
- 「将来用」の bypass Branch chain
- Template 上の余剰 Prototype clone

## 15. Build Provenance / Determinism

同じ以下の入力からは意味的に同じ Workflow を生成できることを目標とする。

```text
Template version/hash
+ Manifest schema/version/hash
+ models.json
+ prompt_plan.json
+ project.id
+ compiler version/config
```

Compiler version は Manifest 自身には書かない。Compiler version は「そのManifestをどの実行エンジンで処理したか」という build provenance だからである。

Compile時に Manifestファイルの SHA-256 も計算し、生成結果の provenance として `project_meta.json` の Workflow build metadata に保存する。

概念例:

```json
{
  "workflowBuild": {
    "compilerVersion": "1.0.0",
    "manifest": {
      "schemaVersion": 1,
      "version": "1.0.0",
      "sha256": "..."
    },
    "template": {
      "id": "default-scene-batch",
      "version": "1.0.0",
      "sha256": "..."
    }
  }
}
```

Manifest hash は Manifest 自身へ埋め込まず、Compile時の外部 provenance として記録する。

`project_meta.json` 全体の正式 schema は別責務だが、Workflow build provenance として上記情報を保持する方針は確定とする。

## 16. Compiler Validation

### 16.1 Compile前

- Manifest が `schemas/workflow-template-manifest.schema.json` に適合する。
- Template JSON が読み込める。
- `template.sha256` が Template実ファイルの SHA-256 と一致する。
- Common role node が Template に存在する。
- Common role node が Prototype ownership に誤って含まれていない。
- Branch role node が Template に存在し、`branchPrototype.nodeIds` に含まれる。
- `branchPrototype.nodeIds` / `groupIds` の参照先が実在する。
- Boundary ID が一意。
- 各 Boundary が Template 上のLinkとちょうど1件一致する。
- ownership境界を跨ぐLinkがすべてBoundaryとして宣言される。
- 未宣言 cross-boundary Link がない。
- Prototype内部Linkを両端Node membershipから一意に導出できる。
- 複数Branch時に layout offset が重複配置を発生させない。
- `models.json` ref が解決可能。
- Prompt Plan の枝・葉が有効。
- `project.id` がfilesystem-safe ID規則を満たす。
- Template-owned prompt transformが `1 leaf = 1 generation` cardinalityを破らない。

### 16.2 Compile後

- JSON 構文。
- Node ID 重複なし。
- Link ID 重複なし。
- dangling link なし。
- Group ID 重複なし。
- Branch count 一致。
- 全 Branch の main Matrix が非空。
- 全 Branch の `counter` が `count = 1`。
- 各BranchのMain SceneMatrix row数が `branch.leaves.length` と一致。
- Project予定枚数がPrompt Plan全leaf総数と一致。
- `row_id` / `path_label` が対応する `leaf.id` と一致。
- Save path が `BatchStudio/{project.id}/{branch.id}` と一致。
- LoRA file が `models.json` に存在。
- `filename_enabled` 等 Compiler-owned invariant が成立。
- `last_node_id` / `last_link_id` 整合。

`generation.target_image_count` とProject予定枚数の差分はblocking invariantではない。

### 16.3 Current implementation boundary

現在の `src/main/compiler.ts` は、Model Family別Template/ManifestからComfyUI **UI Workflow JSON** を決定論的に生成し、上記のNode/Link/Group/Matrix/Save path invariantを検証するところまで実装済みである。

Execution用のComfyUI API-format graph生成・paired contract解決・UI Workflowとのhash/identity整合確認はまだ実装されていない。これらはExecution実装前に追加する必要があり、現時点でUI Workflow生成成功をAPI graph準備完了とは扱わない。

## 17. Manifest Schema Evolution

Schema v1 が表現できない Template topology が必要になった場合は Compiler の暗黙推測や ad-hoc field を追加せず、正式な Manifest schema evolution として扱う。

例:

- Branch -> Common の逆方向 boundary。
- 複数 Prototype type。
- Branchごとに異なる Prototype class。
- Node / Group以外の新しい clone ownership対象。

新しい意味が必要な場合は `schemaVersion` 更新と migration / compatibility policy を先に定義する。

Naming / count ruleについても、将来 `imagesPerLeaf != 1`、Branch単位の個別枚数、別保存tree等が必要になった場合はGrok自由文や隠れTemplate設定で変更せず、正式Requirement / Decisionとしてversioned policyへ拡張する。

## 18. 確定済み v1 Compiler policy

v1では次の主要境界を確定済みとする。

- Manifest Schema v1 / role naming。
- Prototype Node / Group ownership。
- Prototype内部Link自動導出。
- Common -> Branch boundary。
- layout policy。
- Template version/hash binding。
- Compiler build provenance。
- `1 leaf = 1 image`。
- Branch / Project image count derivation。
- Branch / Group /主要Node title naming。
- Workflow filename。
- SceneSaveImage save path。
- Leaf output identity / `path_label`。
- Physical filename suffixをSceneSaveImageへ委譲する境界。

これらをGrok outputやTemplateのコピー残りで上書きしない。