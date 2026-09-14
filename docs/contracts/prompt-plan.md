# Prompt Plan Contract

Status: Active / Schema v2, Schema v1 compatibility

## 1. 目的

`prompt_plan.json` は Grok が返す「意味的な生成計画」と Workflow Compiler の入力をつなぐ契約である。

このファイルは ComfyUI Workflow JSON ではない。Node / Link / Widget 構造を持たず、作品全体の Prompt scope、使用 LoRA、Branch、Leaf を表す。

新規 Prompt Plan は **Schema v2** を使用する。既存 Project の Schema v1 は読み取り・編集・Compile 互換を維持する。

機械可読な正式 JSON Schema は次を正本とする。

```text
schemas/prompt-plan.schema.json
```

## 2. 責務境界

### Grok

Grok は次を決める。

- Common / Branch / Leaf の意味 scope。
- Danbooru tag の意味 category。
- Root / Branch LoRA の適用先と実適用強度。
- Branch / Leaf の意味的な分割。
- Story に対する Prompt fallback tag の配置先。

Grok は最終 Prompt 文字列を組み立てない。

### Batch Studio

Batch Studio は次を所有する。

- Model Family 別 quality preset。
- Prompt category の compile order。
- `models.json` からの Base Model / LoRA `trainedWords` 注入。
- exact duplicate 除去。
- Prompt semantic validation。
- Illustrious / Anima の tag dialect validation。
- 最終 positive / negative 文字列化。
- ScenePrompter / SceneMatrix への mapping。

### User

ユーザーは Grok の Draft と Batch Studio validation を確認し、Prompt Plan を確定する。

## 3. Artifact lifecycle

標準ファイル名:

```text
prompt_plan.json
```

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

- Project ごとに現在の確定版は1ファイルだけを持つ。
- `prompt_plan_v2.json` 等のversion付き別ファイルを正本として作らない。
- Schema version は `schemaVersion` field で管理する。
- 確定前 Draft は `._batch_studio/drafts/`、旧確定版は `._batch_studio/history/` で管理する。
- `prompt_tree.md` は Legacy only とする。

## 4. Schema v2

代表例:

```json
{
  "schemaVersion": 2,
  "common": {
    "positive": {
      "subject": ["1girl"],
      "identity": ["kitagawa_marin"],
      "appearance": ["long_hair", "pink_eyes"]
    },
    "negative": {}
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
      "label": "Clothed intro",
      "loras": [],
      "prompt": {
        "positive": {
          "outfit": ["crop_top", "miniskirt"],
          "environment": ["indoors", "living_room"]
        },
        "negative": {}
      },
      "leaves": [
        {
          "id": "s1-01-c1",
          "name": "S1-01_C1_intro",
          "prompt": {
            "positive": {
              "expression": ["smile"],
              "pose": ["standing"],
              "camera": {
                "angle": ["from_below"],
                "framing": ["cowboy_shot"],
                "gaze": ["looking_at_viewer"]
              }
            },
            "negative": {}
          }
        }
      ]
    }
  ]
}
```

Root object の未知 field は許可しない。

## 5. Prompt scope

Schema v2 は3段階の Prompt scope を持つ。

```text
common
  ↓
branch.prompt
  ↓
leaf.prompt
```

### 5.1 common

全 Branch / 全 Leaf で不変の意味だけを持つ。

例:

- 主体構成。
- Character identity。
- 全編で変わらない髪・目・肌・体型。
- 全編共通 Style。

途中で変化する衣装、状態、場所を `common` へ置かない。

### 5.2 branch.prompt

その Branch 配下の全 Leaf で不変の意味だけを持つ。

例:

- 章単位で固定される衣装。
- 同一場所で続く Scene の背景。
- Branch 全体の状態。

Branch 共通 Prompt が無い場合は `prompt` field を省略できる。

### 5.3 leaf.prompt

1画像固有の差分を持つ。

例:

- 表情。
- Action / Pose。
- Camera。
- その画像だけの背景差分。
- Lighting / Effects。

親 scope に存在する tag を子 scope へ再掲しない。

## 6. Positive categories

正式 category:

```text
subject
identity
appearance
style
outfit
expression
action
pose
camera
environment
lighting
effects
```

意味:

| Category | Meaning |
| --- | --- |
| `subject` | 人数、主体、関係性 |
| `identity` | Character / Series identity |
| `appearance` | 髪、目、肌、体型等 |
| `style` | 作風・Artist系 tag |
| `outfit` | 衣服、下着、Accessory |
| `expression` | 表情 |
| `action` | 行為・Interaction |
| `pose` | Standing / Sitting 等 |
| `camera` | POV / Angle / Framing / Gaze / Focus |
| `environment` | 場所、背景、小物 |
| `lighting` | 光、時間帯 |
| `effects` | 画面的 Effect |

### 6.1 Camera

Camera はさらに分離する。

```text
pov
angle
framing
gaze
focus
```

例:

```json
{
  "camera": {
    "pov": ["pov"],
    "angle": ["from_below"],
    "framing": ["cowboy_shot"],
    "gaze": ["looking_at_viewer"]
  }
}
```

`angle` / `framing` / `gaze` は最終画像につき原則1 tag とする。

## 7. Negative categories

正式 category:

```text
anatomy
identity
appearance
subject
outfit
action
camera
environment
artifacts
content
```

Schema v2 の negative は Project 固有 exclusion を中心に保持する。

Model Family 共通の quality / anatomy preset は Batch Studio Prompt Policy が所有する。

## 8. Tag representation

各 category は string array とする。

```json
"appearance": [
  "long_hair",
  "pink_eyes"
]
```

要件:

- 1 array element = 1 tag。
- tag 内にカンマ・改行を含めない。
- 同一 array 内で exact duplicate を持たない。
- Positive / Negative の同一 final Prompt に同一 tag を持たない。
- Illustrious の通常 tag は underscore form。
- Anima の通常 tag は space form。
- `trainedWords` は Prompt Plan に保存しないため、この通常 tag validation の対象外。

## 9. trainedWords ownership

Schema v1 では Grok が `models.json.trainedWords` を Prompt string へ転記していた。

Schema v2 では転記しない。

```text
models.json
   |
   +--> Base Model trainedWords
   +--> Root LoRA trainedWords
   +--> Branch LoRA trainedWords
   |
   v
Batch Studio Prompt Compiler
```

注入 rule:

- Base Model trainedWords -> Common compiled positive。
- Root LoRA trainedWords -> Common compiled positive。
- Branch LoRA trainedWords -> 当該 Branch の各 Leaf compiled positive。
- trainedWords は文字列を変更・翻訳・正規化しない。
- exact duplicate は最終 merge 時に1回へまとめる。

この rule により Grok による trigger word の typo / dialect変換 / 重複転記を防ぐ。

## 10. Model Family Prompt Policy

Prompt Plan v2 自体には `compileOrder` や quality preset を保存しない。

これらは作品の意味データではなく Batch Studio の実装policyだからである。

Current compile order:

```text
quality preset
base/root trainedWords
subject
identity
appearance
style
outfit
expression
action
pose
camera.pov
camera.angle
camera.framing
camera.gaze
camera.focus
environment
lighting
effects
```

Negative も Batch Studio policy prefix の後に category order で連結する。

Policy変更時に各 Project の `prompt_plan.json` を書き換える必要がない設計とする。

## 11. Prompt fallback

LoRA選定工程で Promptだけで十分に代替可能と判断した場合、internal sidecarへ tag array を保存する。

```json
{
  "schemaVersion": 2,
  "promptFallbacks": [
    {
      "requirement": "specific camera angle",
      "positiveTags": ["from_below"],
      "negativeTags": [],
      "reason": "Prompt tags are sufficient"
    }
  ]
}
```

Prompt Planning の Grok は Story と requirement を照合し、これら tag を適切な Common / Branch / Leaf category へ配置する。

Fallback側で category を決めない。Category ownership は Prompt Planning にある。

Legacy `positive` / `negative` string fallback は読み取り時に tag array へ normalize できる。

## 12. LoRA usage

Schema v1 と同じ shape を維持する。

```json
{
  "modelRef": "lora.character",
  "strengthModel": 0.7,
  "strengthClip": 0.7
}
```

要件:

- `modelRef` は `models.json` で解決可能であること。
- `strengthModel` / `strengthClip` は必須。
- Prompt Plan が Project実適用値を所有する。
- `models.json.strengthBaseline` は model由来baselineであり別責務。
- baselineがある場合、Grok作成時の初期値として両strengthへ展開できる。

## 13. Stable ID / Ordering

Branch / Leaf ID:

```regex
^[a-z][a-z0-9._-]{0,63}$
```

- Branch ID は Project 全体で一意。
- Leaf ID は全 Branch を横断して一意。
- Array order が生成順。
- `order` field は持たない。
- Leaf ID を SceneMatrix `row_id` / `path_label` / `name` へ使用する。
- `leaf.name` はUI用の人間可読名。

## 14. Compile mapping

Schema v2 の最終文字列は Compiler が決定論的に生成する。

```text
common structured prompt
 + quality policy
 + Base/Root trainedWords
      ↓
ScenePrompter common positive / negative

branch structured prompt
 + leaf structured prompt
 + Branch trainedWords
      ↓
SceneMatrix positive_base / negative_base
```

Commonに存在する exact same tag は Leaf側compiled Promptから除外する。

ComfyUI SceneMatrix内部fieldはPrompt Planへ保存しない。

## 15. Validation

Validationは2層で行う。

```text
JSON Schema validation
+
Batch Studio semantic validation
```

Semantic validationは少なくとも次を確認する。

- Branch / Leaf ID uniqueness。
- `modelRef` 解決。
- Model Family tag dialect。
- 1 element = 1 tag。
- Positive / Negative exact conflict。
- 親子scope exact duplicate warning。
- Camera angle conflict。
- Camera framing conflict。
- Camera gaze conflict。
- Expression over-definition warning。
- `solo` と複数subjectの明白な conflict。
- `nude`系と outfit category の併用 warning。

## 16. Schema v1 compatibility

Schema v1:

```json
{
  "schemaVersion": 1,
  "common": {
    "positive": "...",
    "negative": "..."
  },
  "rootLoras": [],
  "branches": [
    {
      "id": "b01",
      "label": "...",
      "loras": [],
      "leaves": [
        {
          "id": "s1-01-c1",
          "name": "...",
          "positive": "...",
          "negative": "..."
        }
      ]
    }
  ]
}
```

Compatibility policy:

- 既存v1は読み取り可能。
- v1は従来通り編集可能。
- v1は従来文字列を変更せずCompileする。
- v1へv2 quality/trainedWords policyを後付けしない。
- 新規Grok Prompt Planはv2を生成する。
- 旧Projectを開いただけで自動migrationしない。
- v1をv2へ移行する場合はGrok再構造化 + Batch Studio validation + User approvalを経る。

これにより既存 Workflow の再生成結果を意図せず変更しない。

## 17. Human-readable view

Prompt Plan Web UI はv2でcategory単位の編集を提供する。

- Common structured editor。
- Branch common prompt editor。
- Leaf structured editor。
- 1行1tag入力。
- Compiled Prompt Preview。
- Validation issue表示。
- Root / Branch LoRA strength編集。

Compiled Preview は保存Artifactではなく、現在の `prompt_plan.json` と `models.json` から都度生成する。

## 18. Grokが返さないfield

次は引き続き Workflow Compiler の責務である。

```text
node_id
link_id
group_id
position
mode
filename_enabled
positive_base
negative_base
positive_json
negative_json
positive_parts
negative_parts
category_order
display_labels
widgets_values
widgets_values_named
scene_matrix_json
compile_order
quality_preset
```

