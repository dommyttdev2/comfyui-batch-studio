# Validation and Security

Status: Active

## 1. 方針

Batch Studio は Grok の意味判断を自動修正しない。一方、形式・参照・構造・所在・実行環境 capability のように機械判定できるものは積極的に検証する。

検証結果は次の二段階を基本とする。

- `WARNING`: ユーザー確認で継続可能。
- `BLOCKING`: 次工程または READY への遷移不可。

Execution / Remote Execution の運用詳細は `../architecture/remote-execution.md` を正本とする。

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

Civitai identityを持つユーザー選択基盤モデルとGrok選定LoRAをcurrent catalogと照合する。Anima Text Encoder / VAEはCatalog identityではなく用途別Local/R2 file inventoryで検証する。

確認:

- modelId が存在。
- versionId が当該 model に存在。
- fileId / fileName が当該 version に存在。
- 選定対象が実ファイル候補として識別可能。

存在しない identity は blocking。

### 5.2 Catalog freshness

選定時 catalog generation と current generation が違うだけなら WARNING。

current catalog から選定 identity が消えた場合は BLOCKING とする。

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

## 8. Compiled Workflow / API Graph

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
- Workflow が `models.json` にない Model を参照。
- Execution用API-format graphが生成不能またはUI Workflowと整合しない。

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
executionTarget
```

Local target:

| Local | R2 | State |
| --- | --- | --- |
| yes | any | ready |
| no | yes | local-transfer-required / BLOCKING |
| no | no | missing / BLOCKING |

Remote target:

| Local | R2 | State |
| --- | --- | --- |
| any | yes | remote-stage-ready |
| yes | no | r2-transfer-required / BLOCKING |
| no | no | missing / BLOCKING |

Local targetではR2-onlyをREADYにしない。Remote targetではLocal-onlyをREADYにしない。

Remote targetでREADYとなっても、Remote host上に実体が既にあることを要求する意味ではない。Execution開始時にR2からRemoteへ直接stagingできる状態であることを意味する。

## 10. Preflight

READY 判定前に次をまとめて表示する。

### Artifact

- Story confirmed。
- Models confirmed。
- Prompt Plan confirmed。
- Workflow compiled / validated。
- API-format execution graph valid。

### References

- model selections -> catalog。
- Prompt Plan LoRA refs -> models。
- Workflow file names -> models。
- API graph model refs -> models。

### Availability

- required model availability。
- `executionTarget` に応じたLocal / R2 placement requirement。

### Structure

- branch count。
- leaf count。
- unused branch = 0。
- dangling links = 0。

### Local operational checks

`executionTarget=local` では最低限:

- Local ComfyUI API reachable。
- `ScenePrompterExpand` registered。
- Scene Prompt Tools custom APIs available。
- required custom nodes available。
- Local output path writable。

### Remote operational checks

`executionTarget=remote` では最低限:

- SSH Host / Port / User / private key path configured。
- private key path readable。
- private-key authentication succeeds。
- Host Key verification succeeds。
- Remote ComfyUI directory exists。
- Remote temp / output directory writable。
- Remote Worker runtime available。
- Remote disk capacity sufficient。
- Remote host内からComfyUI localhost API reachable。
- `ScenePrompterExpand` registered。
- Scene Prompt Tools custom APIs available。
- required custom nodes available。
- required R2 model objects exist。
- R2 connection / bucket valid。
- Remote model destination mapping valid。

Blocking が1件でもあれば `BLOCKED`。

### 10.1 Current implementation boundary

現行 `src/main/preflight.ts` で実装済みのGateは次の範囲である。

- `story.md` / `models.json` / `prompt_plan.json` / Workflow存在とstale状態。
- Modelsのcurrent catalog identity再検証。
- Prompt Plan modelRef validation。
- `executionTarget` に応じたLocal/R2 model availability。
- Remote時のVast.ai provider / instance選択。
- Vast.ai API Key設定、SSH private key path存在。
- selected Instanceのcurrent provider statusとrunning時のpublic SSH endpoint有無。

一方、UI Workflowに対応するAPI-format graph、Local ComfyUI API、Scene Prompt Tools、required custom nodes、実SSH authentication、Host Key、Remote Worker、remote filesystem/disk等のoperational checkは未実装である。

したがって現在の `READY` は実装済みGate範囲の結果であり、本章で定義する最終的な「Execution開始可能」のoperational READYより弱い。Execution capability追加時にPreflightを同時に強化し、未検証項目を成功扱いしない。

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
- SSH private key
- browser profile
- secret/token
- `.safetensors`
- executable / arbitrary app data

添付前に full path と file size をユーザーへ表示する。

## 12. Secret ownership

Secretの正本はMain Processまたは専用Web sessionに限定する。

- Civitai API key -> Batch Studio Main Process / environment。
- R2 credential -> Batch Studio Main Process / `safeStorage`。
- SSH private key contents -> Local filesystem。Batch Studioは認証時のみ読み、Projectへコピーしない。
- SSH private key path -> app-wide settingsに保存可能。
- Grok auth -> Grok Web persistent session。

Remote hostへR2 credentialを渡さない。Remoteへ渡せるのは、対象object / operation / lifetimeを限定したsigned URLのみとする。

Signed URLは bearer credential として扱う。

- full query stringを通常logへ保存しない。
- Project artifactへ保存しない。
- retry時は必要に応じて再発行する。

Project metadata / log に secret を保存しない。

## 13. Remote Path Safety

Remote Workerは操作可能rootを固定し、path traversalとsymlink escapeを拒否する。

```text
model operation    -> configured ComfyUI models root
artifact operation -> configured ComfyUI output root
worker temp        -> Batch Studio run temp root
```

model downloadはfinal filenameへ直接書かず `.part` へ保存し、size/hash verification成功後にatomic renameする。

## 14. Destructive Operations

Project artifact の確定更新以外の破壊操作は明示操作とする。

- final artifact overwrite 前に history 作成。
- R2 delete / move はIntegrated R2 Managerの確認フローを使う。
- catalog は read-only。
- Executionの通常StopとForce Interruptを分離する。
- current Run以外のComfyUI pending queueを削除しない。
- cancelled Runのpartial artifactをCompleted成果物として扱わない。

## 15. Error transparency

外部 tool failure、parse failure、validation failure、transport failure を「代替データで成功」に見せない。

ユーザーへ次を区別して表示する。

```text
Unavailable
Invalid
Stale
Warning
Blocked
Ready
Running
Failed
Completed
```

Silent fallback禁止例:

- SSH failure -> public ComfyUI endpointへfallbackしない。
- R2 model GET failure -> SCP model transferへfallbackしない。
- hash mismatch -> successにしない。
- R2 lookup failure -> object missingとみなさない。

これにより fallback が正本を曖昧にすることを防ぐ。
