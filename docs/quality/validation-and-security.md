# Validation and Security

Status: Active

## 1. 方針

Batch Studio は Grok の意味判断を自動修正しない。一方、形式・参照・構造・所在のように機械判定できるものは積極的に検証する。

検証結果は次の二段階を基本とする。

- `WARNING`: ユーザー確認で継続可能。
- `BLOCKING`: 次工程または READY への遷移不可。

## 2. project_brief.json

Blocking:

- project title が空。
- 版権キャラ状態が未確定。
- 版権キャラ ON かつ character name が空。
- audience traits が空。
- 成人・合意確認が未チェック。

その他の未入力は Grok に `unspecified` として渡せる。

## 3. story.md

最低検証:

- UTF-8 として読める。
- 空ファイルでない。
- Markdown 本文が存在する。

内容チェックは原則 WARNING:

- Brief の対象キャラクターが見当たらない。
- 固定前提の記述が不足。
- 目標画像枚数へ展開する場面粒度が弱い。

Batch Studio が Story を機械的に書き換えない。

## 4. model_catalog.json

Blocking:

- JSON parse error。
- 対応外 schemaVersion。
- `collections` が取得できない。

State:

- `generation`
- `generatedAt`

を読み、`models.json` の選定元情報と比較可能にする。

## 5. models.json

### 5.1 Identity validation

Grok が選定した各項目を current catalog と照合する。

確認:

- modelId が存在。
- versionId が当該 model に存在。
- fileId / fileName が当該 version に存在。
- 選定対象が実ファイル候補として識別可能。

存在しない identity は blocking。

### 5.2 Catalog freshness

選定時 catalog generation と current generation が違うだけなら WARNING。

current catalog から選定 identity が消えた場合は強い WARNING または BLOCKING とし、正式 severity は schema 確定時に決める。

### 5.3 Missing requirements

`missingRequirements` に必須用途が残る場合、モデル工程を確定 READY にしない。

## 6. prompt_plan.json

Blocking:

- JSON parse error。
- unsupported schemaVersion。
- branch が0件。
- branch id duplicate。
- branch leaf が0件。
- model reference unresolved。
- 必須 string field の型不正。

Warning:

- 同じ LoRA の重複指定。
- 空 positive / negative が不自然な場合。
- 極端に多い branch / leaf。

LoRA weight の数値範囲は別仕様として決めるまで恣意的に 0..1 へ clamp しない。

## 7. Workflow Template / Manifest

Compile 前 Blocking:

- Template JSON parse error。
- Manifest parse / schema error。
- Manifest が指す node / group が Template に存在しない。
- role が重複・不足。
- Branch Prototype の boundary が解決できない。

Template が壊れている場合、過去 Workflow から推測して fallback compile しない。

## 8. Compiled Workflow

Blocking:

- JSON structure 不正。
- `nodes` / `links` / `groups` の必要構造欠落。
- node id duplicate。
- link id duplicate。
- dangling link。
- group id collision。
- `last_node_id` / `last_link_id` 不整合。
- final branch count と Prompt Plan branch count の不一致。
- main SceneMatrix が空の branch。
- Workflow が `models.json` にない LoRA / Checkpoint を参照。

Invariant:

- 全 leaf 由来の Matrix row は有効。
- Compiler-owned filename setting は有効。
- 最終 Workflow に予約 UNUSED branch がない。

## 9. Model Availability

Preflight では少なくとも `models.json` の必須実ファイルについて状態を集約する。

```text
Selected
Local ComfyUI
R2
```

例:

| File | Local | R2 | State |
| --- | --- | --- | --- |
| checkpoint A | yes | yes | ready |
| LoRA B | no | yes | transfer needed |
| LoRA C | no | no | blocking |

R2 に存在するだけで Local ComfyUI が利用できない場合、自動的に READY としない。実行環境への配置条件は今後の generation environment 要件と合わせて確定する。

## 10. Preflight

READY 判定前に次をまとめて表示する。

### Artifact

- Story confirmed。
- Models confirmed。
- Prompt Plan confirmed。
- Workflow compiled / validated。

### References

- model selections -> catalog。
- Prompt Plan LoRA refs -> models。
- Workflow file names -> models。

### Availability

- Checkpoint availability。
- LoRA availability。

### Structure

- branch count。
- leaf count。
- unused branch = 0。
- dangling links = 0。

Blocking が1件でもあれば `BLOCKED`。

## 11. Grok Security

### 11.1 WebContents isolation

- Grok Web を Local Renderer と別 WebContents にする。
- Node integration off。
- Grok preload なし。
- Local IPC 非公開。
- local filesystem capability 非公開。

### 11.2 Attachment filtering

Grok へ添付できる候補は明示 allowlist 方式を基本とする。

許可候補例:

- `story.md`
- `models.json`
- `model_catalog.json`
- `prompt_plan.json` のレビュー時
- ユーザー指定の参考資料

禁止候補:

- `.env`
- credential file
- R2 config
- browser profile
- secret/token
- `.safetensors`
- executable / arbitrary app data

添付前に full path と file size をユーザーへ表示する。

## 12. Secret ownership

Batch Studio は既存ツールの secret をコピーしない。

- Civitai key -> civit-model-viewer。
- R2 secret -> R2 File Manager。
- Grok auth -> Grok Web session。

Project metadata / log に secret を保存しない。

## 13. Destructive Operations

初期設計では Project artifact の確定更新以外の破壊操作を最小限にする。

- final artifact overwrite 前に history 作成。
- R2 delete / move は R2 File Manager の既存確認フローへ委譲。
- catalog は read-only。

## 14. Error transparency

外部 tool failure、parse failure、validation failure を「代替データで成功」に見せない。

ユーザーへ次を区別して表示する。

```text
Unavailable
Invalid
Stale
Warning
Blocked
Ready
```

これにより fallback が正本を曖昧にすることを防ぐ。
