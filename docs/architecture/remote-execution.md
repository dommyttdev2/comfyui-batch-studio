# Local / Remote Execution Architecture

Status: Active design / implementation pending

## 1. 目的

ComfyUI Batch Studio に `実行前チェック` の後段として `実行` 工程を追加し、Project の `executionTarget` に応じて Local / Remote の生成実行を行うための設計を定義する。

対象:

- Local ComfyUI での Workflow 実行。
- Scene Prompt Tools の `ScenePrompterExpand` による連続生成の API 再現。
- Remote ComfyUI 環境への必要モデル配置。
- Remote 生成結果の Cloudflare R2 への保存。
- R2 から Local Project への成果物回収。
- 長時間 Run の進捗、停止、再接続、Resume。

この文書を Execution / Remote Execution の詳細設計の正本とする。

---

## 2. Scope 変更

従来は Preflight 完了を Batch Studio の責務終端としていたが、今後は生成実行と成果物回収までを製品フローに含める。

工程順:

```text
概要
基本設定
ストーリー
モデルカタログ
モデル選定
プロンプト設計
ワークフロー
モデル配置
実行前チェック
実行
```

Local Run は Workflow 実行と Local 成果物確認まで完了した時点で成功とする。

Remote Run は次の全工程が成功した時点でのみ完了とする。

1. Remote 環境準備。
2. 必要モデル配置。
3. Scene Prompt Expand 連続生成。
4. 成果物収集と package 化。
5. Remote から R2 への upload。
6. R2 から Local への download。
7. Local 側での完全性検証。

> **ComfyUI の生成完了と Remote Run の完了は同義ではない。**

---

## 3. 最上位設計原則

### 3.1 Execution Target

Project の `executionTarget` を正本とする。

```text
executionTarget = local | remote
```

- `local`: Local ComfyUI で実行する。必要モデルの Local 配置は必須、R2 配置は任意。
- `remote`: Remote ComfyUI で実行する。必要モデルの R2 配置は必須、Local 配置は任意。

### 3.2 SSH Tunnel は使用しない

Remote 実行では SSH Tunnel を採用しない。

前提:

- SSH endpoint は外部から到達可能。
- SSH は秘密鍵認証を必須とする。
- ComfyUI の `8188` port を外部公開する必要はない。

Remote Worker が Remote host 内から ComfyUI localhost API を呼ぶ。

```text
Batch Studio
    |
    | SSH / private-key authentication
    v
Remote Worker
    |
    | HTTP localhost
    v
ComfyUI 127.0.0.1:8188
```

### 3.3 SSH は Control Plane

SSH は次だけに使用する。

- 疎通確認。
- Remote filesystem / disk 確認。
- Remote Worker の配置・更新。
- JSON control message の送受信。
- R2 の短命 URL の受け渡し。
- progress / result event の受信。
- cleanup / stop command。

SSH / SCP を次の大容量 transfer path として使用しない。

- checkpoint / diffusion model。
- text encoder。
- VAE。
- LoRA binary。
- 生成画像一式。
- 成果物 ZIP。

### 3.4 R2 は Bulk Data Plane

大容量 file は R2 を介して転送する。

```text
Model:
R2 -> HTTPS GET -> Remote

Artifact:
Remote -> HTTPS PUT -> R2 -> HTTPS GET -> Local
```

R2 credential は Electron Main Process 内に留め、Remote へ渡さない。

### 3.5 Remote Worker が Remote ComfyUI orchestration を所有する

Remote の Scene Prompt Expand 連続生成では、各 prompt ごとに Local から SSH command を発行しない。

Remote Worker が `127.0.0.1:<comfy-port>` に対して ComfyUI / Scene Prompt Tools API を呼び、Run sequence を Remote 内で進行させる。

---

## 4. Architecture

```text
                       ComfyUI Batch Studio
                      Electron Main Process
                               |
              +----------------+----------------+
              |                                 |
          R2 Manager                        SSH Service
              |                                 |
      signed GET / PUT                private-key auth
              |                                 |
              |                                 v
              |                         Remote Worker
              |                         /         \
              |                        /           \
              |               localhost HTTP      filesystem
              |                      |                 |
              |                      v                 |
              |                   ComfyUI              |
              |                127.0.0.1:8188          |
              |                                        |
              +------------- HTTPS --------------------+
                              |
                              v
                        Cloudflare R2
                              |
                              | signed/public GET
                              v
                         Local artifacts
```

Main Process の責務境界:

```text
ExecutionService
|
+-- LocalExecutionService
|
+-- RemoteExecutionService
    |
    +-- SshService
    +-- RemoteWorkerClient
    +-- RemoteModelStager
    +-- ScenePromptExecutionCoordinator
    +-- RemoteArtifactService
    +-- R2TransferService
    +-- ExecutionStateStore
```

Remote Worker の責務:

```text
BatchStudioRemoteWorker
|
+-- system
|   +-- health
|   +-- disk
|   +-- filesystem
|
+-- comfy
|   +-- health
|   +-- object_info
|   +-- queue
|   +-- prompt
|   +-- history
|   +-- interrupt
|
+-- scene_prompt
|   +-- prepare
|   +-- claim
|   +-- execute_sequence
|   +-- finalize
|   +-- release
|
+-- model
|   +-- stat
|   +-- download
|   +-- hash
|
+-- artifact
    +-- manifest
    +-- package
    +-- hash
    +-- upload
    +-- cleanup
```

---

## 5. Local Execution

Local execution は R2 を必須としない。

```text
Preflight PASS
    |
    v
Local ComfyUI API endpoint 解決
    |
    v
ComfyUI / Scene Prompt Tools capability 確認
    |
    v
API-format prompt graph 準備
    |
    v
Scene Prompt Expand branches 実行
    |
    v
prompt completion 監視
    |
    v
Local output 確認
    |
    v
COMPLETED
```

Local ComfyUI install path は filesystem path であり API endpoint と同一視しない。Local execution 用に明示的な API URL 設定を持つ。

例:

```text
localComfyUiUrl = http://127.0.0.1:8188
```

---

## 6. Remote Execution State Flow

推奨 phase:

```text
SSH_CONNECTING
  -> SSH_CONNECTED
  -> REMOTE_WORKER_PREPARING
  -> REMOTE_ENVIRONMENT_CHECKING
  -> REMOTE_MODELS_CHECKING
  -> REMOTE_MODELS_DOWNLOADING
  -> REMOTE_MODELS_READY
  -> WORKFLOW_PREPARING
  -> EXECUTING
  -> EXECUTION_COMPLETED
  -> ARTIFACTS_COLLECTING
  -> ARTIFACTS_PACKAGING
  -> R2_UPLOAD_URL_ISSUED
  -> R2_UPLOADING
  -> R2_UPLOADED
  -> LOCAL_DOWNLOADING
  -> LOCAL_VERIFYING
  -> COMPLETED
```

各 phase は UI 表示可能かつ Run State へ永続化可能とする。

---

## 7. SSH

### 7.1 Authentication

Remote execution の SSH 認証は次を固定する。

```text
Password authentication: unsupported
Private-key authentication: required
```

推奨 app-wide 設定:

```text
remoteSshHost
remoteSshPort
remoteSshUser
remoteSshPrivateKeyPath
remoteComfyUiDirectory
remoteComfyUiPort
```

秘密鍵本文を Project artifact に保存しない。保存可能なのは Local の秘密鍵 path だけとする。

### 7.2 Host Key Verification

Host identity verification を無効化しない。

```text
known host + key match     -> allow
unknown host               -> explicit first-use registration / accept-new
known host + key mismatch  -> BLOCK
```

`StrictHostKeyChecking=no` 相当を既定動作にしない。

### 7.3 Session Lifecycle

1 Execution Run 中は可能な限り 1 本の SSH connection を維持する。

```text
Run start
  -> SSH connect
  -> environment/model preparation
  -> generation
  -> artifact upload
  -> cleanup
  -> SSH close
```

一時的な SSH disconnect が Remote generation の即時失敗を意味しないよう、Run ID に紐づく Remote state から再接続後に状態復元できる設計とする。

---

## 8. Remote Worker

### 8.1 役割

ad-hoc shell command の集合ではなく、小さく versioned な Remote Worker を SSH で配置する。

Worker のみは小さい control artifact のため SSH 転送を許可する。

推奨 temp path:

```text
<remote-comfy-root>/temp/batch-studio/<run-id>/remote_worker.py
```

### 8.2 Protocol

Request / Response は JSON を正本とする。

例:

```json
{
  "version": 1,
  "operation": "model.download",
  "runId": "...",
  "url": "<short-lived R2 GET URL>",
  "destination": "/workspace/ComfyUI/models/loras/example.safetensors",
  "expectedSize": 123456789
}
```

progress も可能な限り structured event とする。

### 8.3 Worker Verification

Worker 配置後は Local / Remote の SHA-256 を比較し、不一致なら実行しない。

---

## 9. Remote Model Staging

### 9.1 Source

Remote execution の必要モデルは R2 を source とする。

```text
models.json / resolved placement
        |
        v
R2 object key
        |
        v
Batch Studio R2 Manager
        |
        v
public URL or presigned GET URL
        |
        | URL only over SSH
        v
Remote Worker
        |
        | HTTPS GET
        v
Cloudflare R2
        |
        v
Remote ComfyUI models directory
```

モデル binary を Local PC 経由で Remote へ upload しない。

### 9.2 Existing File Reuse

Download 前に Remote path を確認する。

1. expected remote path を resolve。
2. `stat`。
3. 無ければ download。
4. 存在する場合は最低限 expected size を比較。
5. 信頼できる SHA-256 metadata がある場合は hash も比較。
6. valid な既存 file は再利用。

### 9.3 Atomic Download

final filename へ直接 download しない。

```text
model.safetensors.part
       |
       | download complete
       v
size/hash verification
       |
       v
atomic rename
       |
       v
model.safetensors
```

partial file を ComfyUI が valid model として認識しない状態を維持する。

### 9.4 Destination Mapping

model kind と remote directory の対応は 1 箇所で管理し、UI / Preflight / Execution に重複実装しない。

例:

```text
Illustrious
checkpoint       -> models/checkpoints/
LoRA             -> models/loras/

Anima
diffusion model  -> models/diffusion_models/
text encoder      -> template-compatible text encoder directory
VAE               -> models/vae/
LoRA              -> models/loras/
```

### 9.5 Signed GET Lifetime

既存 R2 Manager の download URL 生成ロジックを再利用する。

multi-GB model では UI 用既定 expiry より長い時間が必要になり得るため、Execution 用 GET は caller-specified expiry を許可する。

URL expiry による retry は Execution Service が新しい URL を明示発行して行い、shell 内で秘密裏に refresh しない。

---

## 10. Workflow / API Prompt

### 10.1 Workflow File Transfer を主経路にしない

Workflow は大容量 binary ではなく control data であり、通常経路で SCP する必要はない。

Execution に必要なのは ComfyUI UI Workflow JSON そのものではなく API-format prompt graph である。

```text
node-id:
  class_type
  inputs
```

### 10.2 Compiler Output

Workflow Compiler / Template system は UI Workflow と deterministic な API-format graph を対応付けて出力できる必要がある。

推奨:

1. paired UI/API templates。
2. 明示 contract に基づく compiler-native API graph generation。

任意の ComfyUI UI Workflow を汎用変換する converter を主アーキテクチャにしない。Custom node の hidden input / widget mapping が壊れやすいためである。

---

## 11. Scene Prompt Expand Continuous Execution

### 11.1 Button ではなく API Orchestration

`ScenePrompterExpand` の「連続生成」は ComfyUI frontend JavaScript の操作であり、server-side の button endpoint ではない。

Batch Studio は標準 ComfyUI API と Scene Prompt Tools custom run-context API を組み合わせて同等の sequence を再現する。

概念 sequence:

```text
prepare run context
    |
submit current_index = 0
    |
wait terminal
    |
claim / reconcile
    |
current_index = 1
    |
submit
    |
wait terminal
    |
...
    |
finalize
    |
release
```

全 index を無条件に一括 queue せず、前 prompt の terminal 確認後に次を submit する。

### 11.2 Remote Ownership

Remote execution では Remote Worker が localhost から次を呼ぶ。

```text
/scene_prompt/runs/prepare
/prompt
/history/{prompt_id}
/queue
/scene_prompt/runs/claim
/scene_prompt/runs/finalize
/scene_prompt/runs/release
```

必要に応じて `/interrupt` を使用する。

### 11.3 Multiple Expand Branches

Workflow 内に複数の `ScenePrompterExpand` がある場合、実行対象の non-zero branch を決定論的順序で列挙して実行する。

UI では少なくとも次を分けて表示する。

```text
overall progress
current branch progress
```

---

## 12. Artifact Collection

### 12.1 Baseline

生成開始前に対象 output directory の manifest を記録し、終了後との差分だけを current Run の成果物とする。

既存 output を誤って package しない。

### 12.2 Manifest

最低限:

```json
{
  "files": [
    {
      "path": "...",
      "size": 123456,
      "sha256": "..."
    }
  ]
}
```

用途:

- expected output count 検証。
- package 内容検証。
- Local 完全性検証。
- Resume 判断。

### 12.3 Packaging

Remote から R2 へ 1 image = 1 upload とせず、原則として 1 Run = 1 ZIP とする。

```text
Remote outputs
     |
     v
manifest
     |
     v
ZIP
     |
     v
SHA-256
```

ZIP 内にも manifest を含める。

---

## 13. Remote -> R2 Upload

Batch Studio の Integrated R2 Manager に Execution 用 presigned PUT 発行を追加する。

概念 API:

```text
presignUpload(bucket, key, contentType, expiresIn)
```

転送経路:

```text
Batch Studio Main Process
       |
       | R2 credentials
       v
presigned PUT URL
       |
       | URL only over SSH
       v
Remote Worker
       |
       | HTTP PUT
       v
Cloudflare R2
```

Remote host へ R2 credential を渡さない。

Upload 後は HTTP success だけでなく expected byte size と package metadata を保存する。

---

## 14. R2 -> Local Download

Remote upload 完了後、Batch Studio Main Process が R2 object を Local Project へ streaming download する。

```text
R2 object
   |
   v
public or signed GET URL
   |
   v
Electron Main Process streaming download
   |
   v
<destination>.part
   |
   v
size / SHA-256 verification
   |
   v
atomic rename
```

外部 `wget` / `curl` を必須にしない。

Local output root の正確な Project contract は implementation 時に Project Artifact owner 文書で固定する。

---

## 15. Success Criteria

Remote Run は次を全て満たした場合のみ `COMPLETED` とする。

```text
all Scene Prompt Expand jobs complete
        +
expected artifacts exist
        +
package creation succeeds
        +
remote package SHA-256 is known
        +
R2 upload succeeds
        +
Local download succeeds
        +
Local SHA-256 == Remote SHA-256
```

Local download を R2 persistence verification と最終 delivery の両方として使用する。

---

## 16. Execution Run State / Resume

Execution は一時的な IPC call ではなく persistent Run として扱う。

推奨保存先例:

```text
<project>/execution_runs/<run-id>.json
```

保持候補:

```text
run id
execution target
workflow identity/hash
API graph hash
model placement snapshot
remote SSH identity
remote worker version/hash
remote paths
current phase
Scene Prompt branch state
prompt ids
artifact baseline
artifact manifest
package metadata
R2 object key
remote package SHA-256
local download path
error/retry history
startedAt / updatedAt / completedAt
```

保存禁止:

- SSH private key contents。
- R2 secrets。
- Cloudflare API Token。
- 不要になった signed URL。

Resume は phase 名だけでなく persisted evidence を確認して判断する。

例:

```text
models verified        -> skip model download
execution completed    -> do not regenerate
package verified       -> do not repackage
R2 object verified     -> do not re-upload
local file verified    -> mark completed
```

---

## 17. Cancellation

Cancellation は意味を分離する。

### 17.1 Stop Scheduling

通常の停止はまず Scene Prompt continuous scheduler が次 prompt を submit しないようにする。

### 17.2 Force Interrupt

明示的な強制停止では current prompt に対して ComfyUI `/interrupt` を使用できる。

### 17.3 Pending Queue

current Run が所有する pending prompt だけを削除し、他 Run / 他ユーザーの queue を変更しない。

### 17.4 Partial Artifacts

cancelled Run の partial output を completed artifact set とみなさない。Cleanup / retention policy は Run State へ記録する。

---

## 18. Preflight Extension

### 18.1 Local

最低限:

```text
Local ComfyUI API reachable
ScenePrompterExpand registered
Scene Prompt Tools custom APIs available
required custom nodes available
workflow/API graph valid
required Local models available
output path writable
```

### 18.2 Remote

最低限:

```text
SSH configuration present
private key path exists and readable
SSH authentication succeeds
host key verification succeeds
remote ComfyUI directory exists
remote temp/output directories writable
remote Worker runtime available
remote disk capacity sufficient
remote localhost ComfyUI API reachable
ScenePrompterExpand registered
Scene Prompt Tools custom APIs available
required custom nodes available
required R2 model objects exist
R2 credentials/bucket valid
remote model destination mapping valid
```

Blocking item がある状態で generation を開始しない。

---

## 19. R2 Manager Extension

Execution でも既存 Integrated R2 Manager を唯一の R2 entry point とする。

追加が必要な capability:

```text
GET signing with caller-specified expiry
presigned PUT generation
HEAD / metadata lookup when needed
stream download-to-local-file
```

Execution 専用の別 credential store / R2 client を作らない。

---

## 20. Security

### 20.1 Secret Boundary

Local に留めるもの:

- SSH private key contents。
- R2 Access Key / Secret Access Key。
- Cloudflare API Token。

### 20.2 Signed URL

presigned URL は bearer credential として扱う。

- 必要直前に生成。
- 1 object / 1 operation に限定。
- full query string を log に残さない。
- Project artifact に保存しない。
- retry 時は expiry を確認して再発行。

### 20.3 Remote Path Safety

Remote Worker は allowed root を強制する。

```text
model operation    -> configured ComfyUI models root
artifact operation -> configured ComfyUI output root
worker temp        -> Batch Studio run temp root
```

path traversal / symlink escape を拒否する。

---

## 21. Reference: anima-vast-workflow-runner

`dommyttdev2/anima-vast-workflow-runner` は infrastructure pattern の参考実装として扱う。

### 21.1 採用・適用する考え方

- private-key SSH connection。
- SSH reconnect / retry。
- 小さい Remote Worker の配置。
- Worker SHA-256 verification。
- filesystem path containment。
- artifact baseline / manifest。
- ZIP packaging。
- SHA-256 verification。
- Local で生成した presigned PUT URL。
- Remote から R2 への direct HTTP PUT。
- phase-based persistent Run State。
- Resume-aware processing。
- explicit cancel / interrupt。
- structured progress event。

### 21.2 採用しないもの

- SSH Tunnel。
- 同 reference runner に model transfer 機能があるという前提。
- Vast.ai instance start / stop を Batch Studio の必須責務とすること。
- reference runner 固有の Anima scheduler / prompt-library contract。

---

## 22. Responsibility Matrix

| Responsibility | Batch Studio Main | SSH | Remote Worker | ComfyUI | R2 |
| --- | --- | --- | --- | --- | --- |
| execution target 選択 | Yes | - | - | - | - |
| SSH settings 管理 | Yes | - | - | - | - |
| private-key authentication | coordinate | Yes | - | - | - |
| R2 credential | Yes | No | No | No | No |
| model GET URL 発行 | Yes | URL transport | receives | - | serves |
| model bytes transfer | No | No | downloads | - | serves |
| remote model check | coordinate | control | Yes | - | metadata source |
| remote Workflow execution | coordinate | control | Yes | executes | - |
| Scene Prompt continuous run | monitor | events | orchestrates | executes | - |
| remote output package | coordinate | control | Yes | produces | - |
| artifact PUT URL 発行 | Yes | URL transport | receives | - | accepts |
| ZIP -> R2 transfer | No | No | Yes | - | Yes |
| R2 -> Local download | Yes | No | No | - | serves |
| final integrity check | Yes | - | source hash | - | transport/storage |

---

## 23. Failure Policy

異なる transport へ silent fallback しない。

例:

- SSH failure -> public ComfyUI access へ fallback しない。
- R2 model GET failure -> SCP model transfer へ fallback しない。
- hash mismatch -> success にしない。

Retry は idempotency / retry safety が確認できる operation のみに限定する。

retry-safe の代表例:

```text
SSH reconnect
remote stat
R2 GET with newly issued URL
controlled R2 PUT retry
history / queue / status polling
```

prompt submit の retry は重複投入を防ぐ evidence がある場合のみ行う。

---

## 24. Execution UI

最低限表示する情報:

```text
Execution target: Local / Remote
Current phase
Connection status
Model preparation status
Overall generation progress
Current Scene Prompt branch
Branch progress
Current prompt ID
Artifact packaging status
R2 upload status
Local download status
Final verification status
```

操作:

```text
Start
Stop scheduling
Force interrupt
Resume
Open local output directory
```

Remote では `generation completed` と `artifact delivery completed` を別状態として見せる。

---

## 25. Acceptance Criteria

### 25.1 Local

- `executionTarget=local` が Local ComfyUI API を使用する。
- Scene Prompt Expand branches を手動 button 操作なしで連続実行できる。
- progress を表示できる。
- current Run 以外を巻き込まず cancel できる。
- Local output 確認後に Run 完了となる。

### 25.2 Remote

- SSH は private key 必須。
- SSH Tunnel を作成しない。
- ComfyUI public API port を要求しない。
- Remote Worker が localhost から ComfyUI API を呼ぶ。
- generation 前に必要モデルを確認する。
- missing model は R2 GET URL で Remote が直接取得する。
- model binary を SSH / SCP で転送しない。
- R2 credential は Main Process 外へ出さない。
- Scene Prompt Expand continuous run を Remote 内で実行する。
- current Run の output のみ収集する。
- Remote で package / hash する。
- Main Process が presigned PUT を発行する。
- Remote が R2 へ直接 upload する。
- Main Process が R2 から Local へ download する。
- Local hash と Remote package hash が一致する。
- その後にのみ `COMPLETED` とする。
- interrupted Run は completed work を無条件にやり直さず Resume できる。

---

## 26. Implementation Order

### Phase 1 - Execution domain / Local

1. `実行` stage 追加。
2. Execution Run state / types / IPC。
3. Local ComfyUI API setting。
4. deterministic API-format graph output。
5. Local Scene Prompt continuous execution。
6. progress / cancellation。

### Phase 2 - SSH / Remote Worker

1. SSH settings / private-key auth。
2. host key validation。
3. Remote Worker deploy / version / hash verify。
4. structured worker protocol。
5. Remote operational Preflight。

### Phase 3 - Remote Model Staging

1. R2 GET signing 再利用。
2. remote model-path resolver。
3. remote stat / size / hash check。
4. `.part` download + atomic rename。
5. model preparation state persistence。

### Phase 4 - Remote Execution

1. Scene Prompt orchestration を Remote Worker に実装。
2. progress event。
3. reconnect / recovery。
4. safe cancel / interrupt。

### Phase 5 - Artifact Delivery

1. baseline / manifest。
2. Remote ZIP / package hash。
3. R2 presigned PUT。
4. Remote direct PUT。
5. Local R2 streaming download。
6. Local SHA-256 verification。
7. cleanup / Resume policy。

---

## 27. 最終構成

```text
                 Batch Studio Main Process
                           |
               SSH / Private Key Auth
                           |
                           v
                    Remote Worker
                   /             \
                  /               \
       localhost ComfyUI        filesystem
                  |               |
                  +-------+-------+
                          |
             short-lived R2 URLs
                          |
                          v
                    Cloudflare R2
                          |
                          | signed/public GET
                          v
                    Local artifacts
```

確定原則:

1. SSH は公開されている前提とし、秘密鍵認証を必須とする。
2. SSH Tunnel は使用しない。
3. ComfyUI API を外部公開する必要はない。
4. SSH は control data のみを運ぶ。
5. R2 が large binary の transfer plane を担当する。
6. R2 credential は Local Main Process に留める。
7. Remote Worker が localhost ComfyUI API を操作する。
8. Scene Prompt Expand は frontend button click ではなく API orchestration で再現する。
9. Remote artifact は R2 upload -> Local download -> hash verify まで成功して Run 完了とする。
10. Execution は persistent / resumable Run として扱う。
