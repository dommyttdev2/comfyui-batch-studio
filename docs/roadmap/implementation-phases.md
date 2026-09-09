# Implementation Phases

Status: Active implementation record

この文書は実装順序を管理する。要件の正本ではない。要件変更時は `requirements/requirements.md` を先に更新し、この文書は依存関係に合わせて調整する。

## Phase 0: Documentation / Contract Freeze

Goal: 実装前に境界と schema の未決事項を減らす。

- Artifact status state model。

`models.json` Schema v1 は解決済みであり、機械可読正本は `schemas/models.schema.json` とする。

`prompt_plan.json` Schema v1 も解決済みであり、機械可読正本は `schemas/prompt-plan.schema.json` とする。

Workflow Template Manifest Schema v1 も解決済みであり、機械可読正本は `schemas/workflow-template-manifest.schema.json` とする。

Workflow naming / save path / image count policy v1 も解決済みであり、`architecture/workflow-compiler.md` を正本とする。

Civitai LoRA strength evidenceの取得・集計・Prompt Plan初期展開policyも解決済みであり、`integrations/external-tools.md`、`contracts/project-artifacts.md`、`contracts/prompt-plan.md` を正本とする。

`prompt_tree.md` の正本関係も解決済みであり、標準 Artifact から外す。人間向け Prompt 表示・編集は Prompt Plan Web UI が担当する。

Local / Remote Executionの設計境界も解決済みであり、`architecture/remote-execution.md` と `DEC-022` を正本とする。

Exit criteria:

- Open decision のうち実装を block する項目が Accepted。
- Template prototype の実ファイルが確定。

## Phase 1: Electron Read-only Shell

Goal: 既存 Project を壊さずに閲覧し、Grok Web と並べて利用できる。

- Electron main / renderer / preload。
- Local UI + Grok `WebContentsView`。
- Grok persistent session isolation。
- Project root scan。
- 既存 Artifact status 表示。
- Legacy `prompt_tree.md` が存在する場合は Legacy として識別。
- `Open Folder` / `Copy Prompt`。
- Grok DOM 自動操作なし。

Exit criteria:

- 既存 Project を変更せず一覧化できる。
- Grok に手動ログインし、Local UI と同時利用できる。

## Phase 2: Project / Story Lifecycle

Goal: 新規 Project と Story の Draft -> Confirm lifecycle を実装する。

- Project initialization UI。
- `project.id` stable ID generation / validation。
- `generation.target_image_count` target semantics。
- `project_brief.json`。
- `project_meta.json`。
- Draft / history。
- Story Grok Work Card。
- `story.md` import / editor / validation / confirm。
- Artifact status model。

Exit criteria:

- 新規 Project 作成から `story.md` 確定まで完結する。
- `project.id` が filesystem-safe stable ID rule を満たす。
- display name変更だけで既存 `project.id` を自動変更しない。
- final overwrite 前に history が残る。

## Phase 3: Integrated Model Catalog / Grok Model Selection

Goal: Batch Studio内蔵のCivitai Catalogを使った Grok 選定と検証を実装する。

Batch Studio Main Process:

- Civitai Public / Private Model Collection同期。
- exact `modelVersionId` のImages API metadata取得。
- `sort=Newest` / `limit=200` / `withMeta=true` sampling。
- `meta.civitaiResources` から exact LoRA version weight抽出。
- 1 `postId` = 1 observation のper-post median。
- minimum 5 distinct posts。
- median of per-post medians。
- `method = median-of-post-medians:newest-200` / distinct-post `sampleCount` provenance。
- optional version-level `strengthBaseline` を `model_catalog.json` へexport。
- evidence不足時はbaseline absentのままSYNC成功。
- 429は待機後に同じrequestから自動再開。
- app-wide catalog / selection template persistence。

Batch Studio:

- integrated catalog path association。
- `model_catalog.json` reader/index。
- generation / generatedAt display。
- Collection / Model / Version browsing / search / template UX。
- Grok Model Selection prompt preparation。
- Models Draft / import。
- `schemas/models.schema.json` を使った Schema v1 validation。
- Checkpoint `checkpoint.main` / LoRA `lora.*` ref validation。
- Project-wide model `ref` uniqueness の semantic validation。
- Model / Version / File identity validation。
- Civitai 由来 `strengthBaseline` / provenance 表示。
- `observed-usage-derived` を作者推奨値として表示しない。
- expected `method` / `sampleCount` semantic validation。
- `missingRequirements` を Draft / UI state として表示。
- unresolved `missingRequirements` がある場合の Confirm blocking。
- catalog generation mismatch 時の selected identity revalidation。
- Confirm 後に確定版 `models.json` 保存。

Exit criteria:

- Grok が catalog から選んだ file を Batch Studio が再照合できる。
- Schema v1 に準拠し semantic validation を通過した `models.json` だけを確定できる。
- `ref` 重複や架空 Model / Version / File identity を確定できない。
- 未解決 `missingRequirements` がある状態で `models.json` を Confirm できない。
- catalog generation が変化しても、それだけで `models.json` を invalid にしない。
- strength evidenceが不足しているLoRAに経験則baselineを捏造しない。

旧 `civit-model-viewer` はStandalone/Legacyとして維持するが、新規フローの外部依存にはしない。

## Phase 4: Prompt Plan

Goal: Grok の意味的 Prompt JSON を正規 Artifact として取り込み、同じデータを人間向け Web UI で確認・編集できるようにする。

- Prompt Plan Grok Work Card。
- `schemas/prompt-plan.schema.json` を使った Schema v1 validation。
- Project-wide Branch ID / Leaf ID uniqueness の semantic validation。
- `models.json` に対する `modelRef` semantic validation。
- common prompt display / editor。
- Root LoRA refs / applied strength editor。
- Branch / Branch LoRA / leaf tree view。
- Branch / leaf ordering editor。
- leaf prompt editor。
- `models.json.strengthBaseline.value = w` を初期値に使う場合の `strengthModel=w` / `strengthClip=w` 同値展開。
- baseline absent時はBatch Studioによる暗黙strength defaultなし。
- baseline初期値と現在のproject実適用値を区別して表示。
- target image count とactual leaf総数の差分表示。
- validation result の該当箇所表示。
- Draft / confirm。
- `prompt_tree.md` を新規生成しない。

Exit criteria:

- Schema v1 に準拠し semantic validation を通過した Prompt Plan が Workflow Compiler へ入力できる。
- 未知 field、必須 field 欠落、不正 stable ID を確定できない。
- Branch ID / Leaf ID の Project-wide 重複を確定できない。
- 解決不能 `modelRef` を持つ Prompt Plan を確定 Workflow 入力にできない。
- baseline absent時にBatch Studioが1.0/1.0等を黙って補完しない。
- baselineを初期展開した後もModel/CLIP値を独立編集でき、`models.json` baselineを変更しない。
- target image countとの差分だけでは確定をBlockしない。
- 人間向けの Prompt 構造確認・編集が `prompt_plan.json` を正本として Web UI 内で完結する。
- ComfyUI 内部 JSON を Grok output に要求しない。
- `prompt_tree.md` を Workflow Compiler の入力にしない。

Legacy `prompt_tree.md` から `prompt_plan.json` への migration は、既存プロジェクトで必要性が確認された場合に別要件として追加できる。Phase 4 の必須条件にはしない。

## Phase 5: Workflow Template / Manifest

Goal: 1本の Branch Prototype を正式な Compiler input にする。

- Common Area + Branch Prototype 1本の Template 実体を確定。
- Template stable ID / release version を決定。
- Template UTF-8 file bytes の SHA-256 を計算。
- `schemas/workflow-template-manifest.schema.json` に準拠する Manifest を作成。
- Common roles `checkpoint` / `rootLoraStack` / `planCommonPrompt` / `promptOutput` を割当。
- Branch roles と `nodeIds` / `groupIds` ownership を割当。
- Common -> Branch boundaries を role + slot で宣言。
- Branch layout offset を設定。
- Template SHA-256 binding validation。
- Manifest role / ownership / boundary semantic validation。
- Prototype内部LinkをNode ownershipから自動導出するvalidation。
- 未宣言cross-boundary Linkのblocking validation。
- Template-owned prompt transformが `1 leaf = 1 generation` cardinalityを維持することを確認。

Exit criteria:

- Manifestだけで可変NodeとPrototype ownership/boundaryを解決できる。
- Compiler code に project-specific Node ID / slot magic number を散在させない。
- ManifestにPrototype内部Link ID一覧を重複保持しない。
- Template hash不一致をCompile前に検出できる。
- Branch専用Reroute等がGroup外でも `nodeIds` で明示所有できる。
- Template-owned nodeがleaf数を暗黙増幅しない。

## Phase 6: Workflow Compiler

Goal: Prompt Plan branch 数と一致し、leaf総数と一致する予定画像数を持つ最終 Workflow を決定論的に生成する。

- Common checkpoint patch。
- Root LoRA Stack patch。
- plan-owned common prompt patch。
- Prototype -> Branch 1 reuse。
- Branch 2..N clone。
- Prototype内部Link derivation / clone。
- Common -> cloned Branch boundary link生成。
- Node / Link / Group ID remap。
- Manifest layout offset適用。
- Branch LoRA Stack patch。
- leaf -> SceneMatrix conversion。
- `leaf.id -> row_id / path_label`、`leaf.name -> name` mapping。
- 全Branch `ScenePromptCounter.count = 1` patch。
- Branch / Project image count derivation。
- Branch human-readable title derivation from `branch.id` / `branch.label`。
- Workflow filename `LoRA_{project-destination-folder}.json`。
- Save path `BatchStudio/{project.id}/{branch.id}`。
- SceneSaveImageのphysical filename suffix/indexはcustom nodeへ委譲。
- `last_node_id` / `last_link_id` update。
- compiled workflow validation。
- Execution用API-format graphのdeterministic生成またはpaired template contract解決。
- UI WorkflowとAPI graphのidentity/hash整合確認。
- Compiler version / Manifest hash / Template identity+hash を Workflow build provenance として `project_meta.json` に記録。

Exit criteria:

```text
finalBranchCount == promptPlan.branches.length
unusedBranchCount == 0
nodeIdCollision == 0
linkIdCollision == 0
danglingLink == 0
undeclaredBoundaryLink == 0
templateHashMismatch == 0
allBranchCounterCount == 1
actualImageCount == totalPromptPlanLeafCount
savePathMismatch == 0
leafPathLabelMismatch == 0
apiGraphValidationError == 0
```

`generation.target_image_count` とactualImageCountの差分はinformational / warningであり、それだけではCompile failureにしない。

## Phase 7: Model Availability / Integrated R2 Manager

Goal: `executionTarget` に応じた必要モデルの配置条件を確認し、同じ工程からR2を管理する。

- `models.json` required model list。
- Local ComfyUI models lookup。
- Project指定R2 bucket / prefixの直接lookup。
- Local target: Local配置必須 / R2任意。
- Remote target: R2配置必須 / Local任意。
- target-specific availability state。
- R2 connection settings / safe secret storage。
- bucket list / create / empty-bucket delete。
- folder browsing / paging / bucket-wide search。
- multipart upload / pause / resume / cancel / restart-resume state。
- object move / rename / multi-delete。
- public / presigned GET URL generation。
- caller-specified GET expiry。
- URL / curl / wget / aria2c output。
- batch download popup with independent selection, cross-folder persistence, max 500 items and named templates。
- optional storage metrics。

Exit criteria:

- Local targetのLocal-missing modelはBLOCKED。
- Remote targetのR2-missing modelはBLOCKED。
- R2未設定/接続失敗を「R2に存在しない」と誤判定しない。
- credential / API tokenをProject artifactやGrokへ渡さない。
- 数GB fileをRendererへ全読込せずMain Processでstream uploadできる。
- upload interruption後にstateを再読込し再開/キャンセルできる。
- batch download selectionはmain delete selectionと独立する。

旧 `r2-file-manager` はStandalone/Legacyとして維持するが、新規フローの外部依存にはしない。

## Phase 8: Preflight

Goal: Project を `READY` / `BLOCKED` に判定し、Execution開始前のoperational capabilityを確認する。

Common:

- Artifact confirmed state。
- catalog refs。
- Prompt Plan refs。
- Workflow / API graph refs / structure。
- planned image count / target delta。
- target-specific model availability。
- Blocking / Warning summary。

Local target:

- Local ComfyUI API reachable。
- `ScenePrompterExpand` registered。
- Scene Prompt Tools custom APIs available。
- required custom nodes available。
- Local output path writable。

Remote target:

- SSH configuration / private key path。
- private-key authentication。
- Host Key verification。
- Remote ComfyUI directory / temp / output writeability。
- Remote Worker runtime。
- Remote disk capacity。
- Remote host内からComfyUI localhost API reachable。
- `ScenePrompterExpand` / Scene Prompt Tools APIs / required custom nodes。
- required R2 model objects / bucket configuration。
- remote model destination mapping。

Exit criteria:

- READY の理由と BLOCKED の理由をユーザーが追跡できる。
- Local / Remote targetの配置条件を取り違えない。
- operational check failureをavailability missingとして偽装しない。

## Phase 9: Execution Domain / Local Execution

Goal: `実行` 工程とpersistent Execution Runを導入し、Local ComfyUIでScene Prompt連続生成できる。

- `実行` stage / navigation。
- Execution Run types / phase / persisted state。
- IPC start / status / stop / force interrupt / resume。
- explicit Local ComfyUI API URL setting。
- ComfyUI API client。
- Scene Prompt Tools run-context client。
- `ScenePrompterExpand` non-zero branches enumeration。
- prepare / submit / wait / claim/reconcile / finalize / release sequence。
- overall / branch progress。
- normal Stop scheduling。
- Force Interrupt。
- unrelated queue保護。
- Local output confirmation。

Exit criteria:

- frontendの「連続生成」buttonを手動操作せずLocal生成できる。
- all active branchesをdeterministic順序で実行できる。
- generation progressを追跡できる。
- Stop / Force Interruptが意味上分離される。
- Local output確認後のみRunを`COMPLETED`にできる。

## Phase 10: SSH / Remote Worker Foundation

Goal: 公開SSH + private-key authenticationでRemote control planeを構築する。

- SSH Host / Port / User / private key path settings。
- password authを標準経路にしない。
- Host Key verification / first-use policy。
- long-lived SSH session / reconnect。
- SSH Tunnelを実装しない。
- small Remote Worker deployment。
- Local / Remote Worker SHA-256 verification。
- JSON request / response protocol。
- structured progress events。
- allowed-root path containment / symlink escape rejection。
- Run IDに紐づくRemote temp state。

Exit criteria:

- ComfyUI portを外部公開せず、Remote Workerがlocalhost APIへ到達できる。
- SSH disconnect後にRun stateを照会・復元できる基礎がある。
- private key contentsをProject / Renderer / Remoteへコピーしない。

## Phase 11: Remote Model Staging

Goal: R2をsourceとして必要モデルをRemote ComfyUI models rootへ安全に配置する。

- required model -> R2 object key resolution。
- existing R2 GET signing logic再利用。
- execution-specific expiry。
- remote model destination resolver。
- remote stat / expected size check。
- reliable hash metadataがある場合のSHA-256 check。
- `.part` download。
- size/hash verification。
- atomic rename。
- valid existing model reuse。
- model staging progress / Run State。

Exit criteria:

- model binaryをSSH/SCPで転送しない。
- R2 credentialをRemoteへ渡さない。
- partial downloadをvalid model filenameとして残さない。
- verified existing modelを不要に再downloadしない。

## Phase 12: Remote Scene Prompt Execution

Goal: Remote WorkerがRemote localhost ComfyUI APIを使ってScene Prompt連続生成を完了する。

- Remote Worker ComfyUI health / object_info / queue / history / interrupt。
- Scene Prompt Tools prepare / claim / finalize / release。
- API-format graph transfer/control。
- multiple Expand branch FIFO orchestration。
- Remote progress event -> Main -> Renderer。
- reconnect / status recovery。
- safe stop scheduling / force interrupt。
- artifact baseline capture。

Exit criteria:

- LocalからpromptごとにSSH commandを発行せずRemote内でsequenceが進む。
- SSH Tunnelを必要としない。
- unrelated ComfyUI queueを破壊しない。
- reconnect後にcurrent branch / prompt stateを復元できる。

## Phase 13: Remote Artifact Delivery

Goal: Remote生成成果物をR2経由でLocalへ確実に回収し、hash検証後にRunを完了する。

- before / after artifact manifest差分。
- current Run artifact count validation。
- Remote ZIP packaging。
- manifest embed。
- Remote package SHA-256。
- Integrated R2 Manager presigned PUT generation。
- signed URL full queryのlog redaction。
- Remote Worker direct HTTP PUT。
- R2 object metadata persistence。
- Main Process R2 streaming GET -> Local `.part`。
- Local size / SHA-256 verification。
- atomic rename。
- cleanup / retention policy。
- package済み / upload済み / download済み evidenceによるResume。

Exit criteria:

```text
allGenerationJobsComplete == true
expectedArtifactsConfirmed == true
remotePackageVerified == true
r2UploadComplete == true
localDownloadComplete == true
localSha256 == remotePackageSha256
```

上記を満たした場合のみRemote Runを`COMPLETED`とする。

## Post-Execution Extensions

Execution core完了後に必要性を確認して追加する候補:

- Vast.ai instance discovery / start / stop integration。
- 複数Remote profile管理。
- artifact package以外の個別同期mode。
- execution history横断検索 /統計。

これらをRemote Execution coreの前提にしない。
