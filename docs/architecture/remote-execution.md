# Local / Remote Execution Architecture

Status: Active design / implementation in progress

## 1. 目的

ComfyUI Batch Studio に `実行前チェック` の後段として `実行` 工程を持たせ、Project の `executionTarget` に応じて Local / Remote の生成実行を行うための設計を定義する。

対象:

- Local ComfyUI での Workflow 実行。
- Scene Prompt Tools の `ScenePrompterExpand` による連続生成の API 再現。
- Cloud Instance Provider から Remote 実行先を解決する処理。
- Remote ComfyUI 環境への必要モデル配置。
- Remote 生成結果の Cloudflare R2 への保存。
- R2 から Local Project への成果物回収。
- 長時間 Run の進捗、停止、再接続、Resume。

この文書を Execution / Remote Execution の詳細設計の正本とする。

Vast.ai API Key、Instance Manager、Cloud Provider abstraction、サービス連携 UI は `../integrations/service-integrations.md` を正本とする。

---

## 2. Scope

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

1. Cloud Instance / Remote environment準備（aria2 / GitHub CLI、GitHub認証、ComfyUI latest release、workflow依存 custom_nodes）。
2. 必要モデル配置。
3. Scene Prompt Expand連続生成。
4. 成果物収集とpackage化。
5. RemoteからR2へのupload。
6. R2からLocalへのdownload。
7. Local側での完全性検証。

> **ComfyUI の生成完了と Remote Run の完了は同義ではない。**

---

## 3. Execution Target

Project の `executionTarget` を実行方式の正本とする。

```text
executionTarget = local | remote
```

Local:

```text
required models on Local = required
required models on R2    = optional
```

Remote:

```text
required models on Local = optional
required models on R2    = required
```

RemoteではProjectがさらにstable targetを保持する。

```text
remoteProvider   = vastai
remoteInstanceId = <positive integer>
```

SSH Host / Port、public IP、current GPU status等のmutable provider stateはProjectへ固定保存しない。

---

## 4. Remote Provider Resolution

Remote ExecutionはSSH Host / Portの手入力値を正本にしない。

初期providerはVast.ai。

```text
Project
  executionTarget = remote
  remoteProvider   = vastai
  remoteInstanceId
        |
        v
CloudInstanceService
        |
        v
Vast.ai API
        |
        +-- current instance status
        +-- current public SSH host / port
        +-- GPU / status metadata
        |
        v
SshService
```

Vast.ai資格情報とInstance管理は `../integrations/service-integrations.md` が所有する。

Providerが将来追加されてもRemote Executionはnormalized Cloud Instance / SSH endpointだけを見る。

---

## 5. SSH Tunnelは使用しない

Remote実行ではSSH Tunnelを採用しない。

前提:

- SSH endpoint は外部から到達可能。
- SSH は秘密鍵認証を必須とする。
- Password認証へfallbackしない。
- ComfyUI portをInternetへ公開する必要はない。

Remote WorkerがRemote host内からComfyUI localhost APIを呼ぶ。

```text
Batch Studio
    |
    | Vast.ai APIで選択Instanceを再取得
    |   22/tcp.HostPort -> SSH接続先Port
    |   18188/tcp または 8188/tcp -> Remote ComfyUI内部Port
    v
public SSH endpoint
    |
    | private-key authentication
    v
Remote Worker
    |
    | HTTP localhost
    v
ComfyUI 127.0.0.1:<instance-resolved-port>
```

SSH Userの既定値は `root` とするが、SSH Port / ComfyUI Portは固定設定として保持しない。SSH Portは選択Instanceの `22/tcp` mappingの `HostPort` を毎回使用する。Remote ComfyUI Portは同Instanceの `ports` から解決し、現在のVast.ai template互換として `18188/tcp` を優先し、存在しなければ `8188/tcp` を使用する。どちらも解決できなければPreflight/Remote接続を失敗させる。

Remote ComfyUI install path は provider設定ではなく app-wide の「環境設定」を正本とする。Remote実行時は未設定を許可せず、POSIX絶対パス（例: `/workspace/ComfyUI`）を指定する。

---

## 6. Control Plane / Data Plane

SSHはControl Planeとする。

SSHで扱うもの:

- Remote疎通確認。
- filesystem / disk確認。
- 小さいRemote Workerの配置・更新。
- structured control request / response。
- R2短命URLの受け渡し。
- progress / result event。
- cleanup / stop command。

SSH/SCPで扱わないもの:

- checkpoint / diffusion model。
- text encoder。
- VAE。
- LoRA binary。
- 生成画像一式。
- 成果物ZIP。

大容量fileはR2をData Planeとして転送する。

```text
Model:
R2 -> HTTPS GET -> Remote

Artifact:
Remote -> HTTPS PUT -> R2 -> HTTPS GET -> Local
```

R2 credentialはElectron Main Process内に留め、Remoteへ渡さない。

---

## 7. Main Process Architecture

```text
ExecutionService
|
+-- LocalExecutionService
|
+-- RemoteExecutionService
    |
    +-- CloudInstanceService
    |   `-- VastAiProvider
    |
    +-- SshService
    +-- RemoteWorkerClient
    +-- RemoteModelStager
    +-- ScenePromptExecutionCoordinator
    +-- RemoteArtifactService
    +-- R2TransferService
    `-- ExecutionStateStore
```

Service Integration側:

```text
ServiceIntegrations
|
+-- R2ConfigStore / R2Manager
+-- CivitaiConfigStore
`-- CloudInstanceService
    `-- VastAiConfigStore / VastAiClient
```

Rendererはcredential本体・SSH private key contents・R2 secretへ直接アクセスしない。

---

## 8. Local Execution

```text
Preflight PASS
    |
    v
Local ComfyUI API endpoint解決
    |
    v
ComfyUI / Scene Prompt Tools capability確認
    |
    v
API-format prompt graph準備
    |
    v
Scene Prompt Expand branches実行
    |
    v
prompt completion監視
    |
    v
Local output確認
    |
    v
COMPLETED
```

Local ComfyUI install pathはfilesystem pathでありAPI endpointと同一視しない。

Local execution用に明示的なAPI URLを持つ。

例:

```text
http://127.0.0.1:8188
```

---

## 9. Vast.ai Instance Lifecycle in Remote Run

Run開始時に選択済みInstanceをVast.ai APIから再取得する。

```text
selected instance
      |
      v
get current status
      |
      +-- running -> SSH endpoint確認
      |
      +-- stopped -> start request
      |               |
      |               v
      |            running待機
      |               |
      +---------------+
      |
      v
public SSH endpoint解決
```

Start APIのHTTP successだけでRUNNING完了としない。current stateとSSH endpointが利用可能になるまでstatusを確認する。

`scheduling`、`offline`、`error`等は`running`と同一視しない。

### Initial-state preservation

既定思想:

```text
Run開始前からrunning
  -> Run終了後もrunningを維持

Batch Studioがstoppedから起動
  -> Run終了後にstoppedへ戻す
```

将来は成功時/失敗時それぞれ `preserve-initial | stop | keep` をユーザー設定可能にできる。

### Instance replacement before generation

Remote Runがgeneration開始前にScheduling等で待機しており、Project側で別のVast.ai Instanceを選択した場合、既存Runの `remoteInstanceId` を書き換えない。

```text
old Run / Instance A
  -> REMOTE_INSTANCE_REPLACED (FAILED, history preserved)
  -> old Instance lifecycle finalize / disconnect

Project selects Instance B
  -> new Run ID
  -> snapshot Instance B
  -> normal Remote lifecycle from CLOUD_INSTANCE_RESOLVING
```

UIでは通常の `Resume` と区別して「別Instanceで新しく実行」を提供する。置換はgeneration開始前のphaseに限定し、生成開始後のRunを暗黙に捨てない。

---

## 10. SSH Authentication / Host Identity

Authentication:

```text
Password authentication: unsupported
Private-key authentication: required
```

app-wide Vast.ai Remote設定:

```text
sshPrivateKeyPath
sshPublicKeyPath
sshUser
```

Remote ComfyUI install path は環境設定の `remoteComfyUiInstallPath` / `BATCH_STUDIO_REMOTE_COMFYUI_INSTALL_PATH` が所有する。

Providerから選択Instanceごとに実行時解決:

```text
sshHost
sshPort        # 22/tcp のHostPort
comfyUiPort    # portsから解決したRemote内部Port
```

`sshPort` / `comfyUiPort` をProject artifactやVast.ai設定へ固定保存しない。Instanceの停止・再作成・mapping変更後も、Run開始時のVast.ai API応答を正本とする。

秘密鍵本文をProject artifactやapp configへコピーしない。保存するのはLocal pathだけとする。

Host identity verificationを無効化しない。

```text
known host + key match     -> allow
unknown host               -> explicit first-use registration / accept-new
known host + key mismatch  -> BLOCK
```

`StrictHostKeyChecking=no`相当を既定動作にしない。

---

## 11. SSH Session Lifecycle

1 Execution Run中は可能な限り1本のSSH connectionを維持する。

```text
Run start
  -> provider resolution
  -> SSH connect
  -> environment/model preparation
  -> generation
  -> artifact upload
  -> cleanup
  -> SSH close
  -> provider final-state policy
```

一時的なSSH disconnectだけでRemote generationが停止したと決めつけない。

Run IDとRemote stateから再接続後にreconcileできる設計とする。

---

## 12. Remote Worker

ad-hoc shell commandの集合ではなく、小さくversionedなRemote WorkerをSSHで配置する。

Workerのみは小さいcontrol artifactのためSSH転送を許可する。

推奨temp path:

```text
<remote-comfy-root>/temp/batch-studio/<run-id>/remote_worker.py
```

責務:

```text
system.health
system.disk
model.stat
model.download
model.hash
comfy.health
comfy.object_info
comfy.queue
comfy.prompt
comfy.history
comfy.interrupt
scene_prompt.prepare
scene_prompt.claim
scene_prompt.execute_sequence
scene_prompt.finalize
scene_prompt.release
artifact.manifest
artifact.package
artifact.hash
artifact.upload
artifact.cleanup
```

Request / Response / progress eventはJSONを正本とする。

Worker配置後はLocal/RemoteのSHA-256を比較し、不一致なら実行しない。

---

## 12.1 Remote Environment Bootstrap

Remote workflow実行では、Remote Worker配置後かつモデルstaging前に環境をidempotentに整備する。

順序:

```text
SSH / Remote Worker ready
  -> aria2 / gh existence check
  -> missing packages only install
  -> GitHub PAT validation via ephemeral GH_TOKEN
  -> ComfyUI official latest release tag lookup
  -> tracked local changes check
  -> latest release commit checkout
  -> requirements.txt / manager_requirements.txt sync
  -> Environment Settingsで指定した custom_nodes clone/update
  -> custom_node requirements sync
  -> supervisorctl restart comfyui
  -> Remote model staging (aria2)
```

GitHub PATは `BATCH_STUDIO_GITHUB_PAT` または `GH_TOKEN` を優先し、Environment Settingsから保存する場合はOSのsafeStorageで暗号化する。RendererへPAT本体を返さず、Execution Runへも永続化しない。Remote hostではWorker requestの一時payloadからsubprocessの `GH_TOKEN` に渡し、`gh auth login` によるcredential file保存は行わない。

ComfyUI releaseは `comfyanonymous/ComfyUI` の `releases/latest` から実行時にtagを取得し、tag名をhard-codeしない。Remote ComfyUIまたは管理対象custom_nodeにtracked local changesがある場合は自動破棄せずbootstrapを停止する。

workflow依存 custom_nodes はEnvironment Settingsのapp-wide listを正本とする。各entryはGitHub `owner/repo` と任意の `ref` を持つ。未導入ならclone、導入済みならorigin一致を確認してfetch/checkoutする。空listはcustom_node同期をskipする。

model downloadはRemote側の `aria2c` を使用する。presigned URLはprocess argvへ載せずstdinのinput-fileとして渡し、size/SHA-256検証後にatomic renameする。

---

## 13. Remote Model Staging

Remote executionの必要モデルはR2をsourceとする。

```text
models.json
   |
   v
resolved R2 object
   |
   v
Batch Studio R2 Manager
   |
   v
public / presigned GET URL
   |
   | URL only over SSH
   v
Remote Worker
   |
   | HTTPS GET
   v
Remote model directory
```

モデルbinaryをLocal PC経由のSCPで送らない。

### Existing file reuse

Download前にRemote pathを確認する。

1. destinationをresolve。
2. stat。
3. 無ければdownload。
4. 存在すれば最低限size比較。
5. 信頼できるSHA-256 metadataがあればhash比較。
6. validならreuse。

### Atomic download

```text
model.safetensors.part
       |
       v
download complete
       |
       v
size/hash validation
       |
       v
atomic rename
       |
       v
model.safetensors
```

### Destination mapping

1箇所でmodel kind -> ComfyUI pathを管理する。

```text
Illustrious
checkpoint       -> models/checkpoints/
LoRA             -> models/loras/

Anima
diffusion model  -> models/diffusion_models/
text encoder      -> models/text_encoders/
VAE               -> models/vae/
LoRA              -> models/loras/
```

Execution用GET URLはmulti-GB downloadを考慮しcaller-specified expiryを許可する。

---

## 14. Workflow / API Prompt

Workflow JSON fileをRemote diskへSCPすることを主経路にしない。

Executionに必要なのはComfyUI API-format prompt graphである。

```text
node-id:
  class_type
  inputs
```

Workflow Compiler / Template systemはUI WorkflowとdeterministicなAPI graphを対応付けて生成できる必要がある。

推奨:

1. paired UI/API templates。
2. 明示contractに基づくcompiler-native API graph generation。

任意のGUI Workflowを汎用変換するconverterを主アーキテクチャにしない。Custom nodeのhidden input / widget mappingが壊れやすいためである。

`/scene_prompt/runs/prepare`等がUI Workflow metadataを必要とする場合はHTTP control payloadとして渡す。Remote filesystemへのWorkflow file配置を必須にしない。

---

## 15. Scene Prompt Expand Continuous Execution

`ScenePrompterExpand`の「連続生成」はComfyUI frontend JavaScript上の操作であり、button click用server endpointではない。

Batch Studioは標準ComfyUI APIとScene Prompt Tools custom run-context APIで同等sequenceを再現する。

```text
prepare
  -> current_index=0 submit
  -> wait terminal
  -> reconcile / claim
  -> current_index=1 submit
  -> wait terminal
  -> ...
  -> finalize
  -> release
```

全indexを無条件に一括queueしない。前promptがterminalになったことを確認してから次をsubmitする。

Remote executionではRemote Workerがlocalhostから次を呼ぶ。

```text
/scene_prompt/runs/prepare
/prompt
/history/{prompt_id}
/queue
/scene_prompt/runs/claim
/scene_prompt/runs/finalize
/scene_prompt/runs/release
/interrupt when explicitly requested
```

Workflow内に複数`ScenePrompterExpand`がある場合、実行対象branchを決定論的順序で列挙してFIFO実行する。

---

## 16. Remote Execution State Flow

推奨phase:

```text
CLOUD_INSTANCE_RESOLVING
  -> CLOUD_INSTANCE_STARTING       optional
  -> CLOUD_INSTANCE_READY
  -> SSH_CONNECTING
  -> SSH_CONNECTED
  -> REMOTE_WORKER_PREPARING
  -> REMOTE_ENVIRONMENT_CHECKING
  -> REMOTE_DEPENDENCIES_INSTALLING
  -> REMOTE_GITHUB_AUTHENTICATING
  -> REMOTE_COMFYUI_UPDATING
  -> REMOTE_CUSTOM_NODES_SYNCING
  -> REMOTE_COMFYUI_RESTARTING
  -> REMOTE_ENVIRONMENT_READY
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
  -> REMOTE_CLEANUP
  -> CLOUD_INSTANCE_FINALIZING
  -> COMPLETED
```

各phaseはUI表示可能かつRun Stateへ永続化可能とする。

---

## 17. Artifact Collection

生成開始前にbaseline manifestを記録するか、可能ならRun固有output prefixを使用する。

Run固有prefixを利用できる場合はbaseline diffより優先する。

manifest最低項目:

```text
path
size
sha256
```

用途:

- expected output count確認。
- package内容確認。
- Local完全性検証。
- Resume判断。

RemoteからR2へ1 image=1 uploadとせず、原則1 Run=1 packageとする。

```text
Remote outputs
  -> artifact manifest作成
  -> 成果物だけをZIP化
  -> ZIP SHA-256
  -> R2一時転送
```

ZIP内には `manifest.json` を含めない。ZIP entryはユーザー向け成果物構造に正規化し、Remote ComfyUI側の内部階層を露出させない。

```text
{yyyymmdd_hhmmss}.zip
├─ b01/
│  └─ s1-01-c100001.png
└─ b02/
   └─ s2-01-c100001.png
```

`artifacts/` prefixや `{runId}_b01/` のようなRemote内部用の重複階層はpackageから除去する。

---

## 18. Remote -> R2 Upload

Integrated R2 ManagerがExecution用upload authorizationを発行する。

単一PUTで扱えるサイズの場合:

```text
presigned PUT
```

転送:

```text
Batch Studio Main
  -> presigned PUT URL
  -> URL only over SSH
  -> Remote Worker
  -> HTTPS PUT
  -> R2
```

RemoteへR2 credentialを渡さない。

### Large package boundary

成果物ZIPがS3互換single PutObjectの実用上限を超える可能性があるため、最大想定package sizeをimplementationで検証する。

必要な場合はRemote Worker向けmultipart-presigned upload protocolを追加し、巨大packageをsingle PUTへ無理に押し込まない。

---

## 19. R2 -> Local Download

Remote upload完了後、Batch Studio Main ProcessがR2 objectをLocalへstream downloadする。

```text
R2 object
  -> public / signed GET
  -> Local <destination>.part
  -> size / SHA-256 verification
  -> atomic rename
```

Remote成果物の最終Local配置は、Projectの `artifactOutputPath` があればそのProject成果物ディレクトリを基準とし、未設定時はProject rootを基準とする。

```text
<artifact-project-root>/
└─ remote_output/
   └─ {runId}/
      ├─ {yyyymmdd_hhmmss}.zip
      └─ manifest.json
```

ZIP名のtimestampはOS timezoneに依存させず、明示的に日本標準時（JST / UTC+9）で生成する。timestampはpackage evidenceへ保存し、Resumeでも同じfilenameを再利用する。

`manifest.json` はZIP外へatomicに保存し、Remote Workerが算出したmanifest SHA-256とLocal bytesを照合する。Local ZIPとmanifestの検証完了後、R2上のExecution一時objectとRemote側一時成果物をcleanupする。

外部`wget` / `curl`を必須依存にしない。

---

## 20. Success Criteria

Remote Runは次を全て満たした場合のみ`COMPLETED`とする。

```text
selected cloud instance resolved
AND remote execution environment valid
AND all Scene Prompt jobs complete
AND expected artifacts exist
AND package creation succeeds
AND remote package SHA-256 is known
AND R2 upload succeeds
AND Local download succeeds
AND Local SHA-256 == Remote SHA-256
```

`ComfyUI generation completed != Remote Run completed`をUIでも維持する。

---

## 21. Execution Run State / Resume

Executionは一時IPC callではなくpersistent Runとして扱う。

推奨保存先例:

```text
<project>/execution_runs/<run-id>.json
```

保持候補:

```text
runId
executionTarget
remoteProvider / remoteInstanceId
provider initial state
resolved SSH identity snapshot
workflow identity/hash
API graph hash
model placement snapshot
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

```text
Vast.ai API Key
SSH private key contents
R2 secrets
Cloudflare API Token
expired/active presigned URL
```

Resumeはphase名だけでなくpersisted evidenceを確認して判断する。

```text
models verified       -> skip model download
execution completed   -> do not regenerate
package verified      -> do not repackage
R2 object verified    -> do not re-upload
local file verified   -> completed
```

Provider stateも再取得し、古いSSH Host / Port snapshotを接続先の正本にしない。

---

## 22. Cancellation

Cancellationは意味を分離する。

### Stop Scheduling

次のScene Prompt itemをsubmitしない。

### Force Interrupt

明示的な強制停止時のみcurrent promptへComfyUI `/interrupt` を使用する。

### Pending Queue

current Runが所有するpending promptだけを削除し、他Runのqueueを変更しない。

### Cloud Instance

CancelしただけでVast.ai Instanceを無条件destroyしない。

Stop/keepはinitial-state policyとRunのcleanup状態に従う。

---

## 23. Preflight

### Local

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

### Remote / Vast.ai

段階的Gate:

```text
Project
  remoteProvider = vastai
  remoteInstanceId valid

Service Integration
  VASTAI_API_KEY resolved
  Vast.ai API reachable
  selected Instance exists
  SSH private key path exists
  Remote ComfyUI install path configured in Environment Settings
  GitHub PAT resolved from safeStorage / BATCH_STUDIO_GITHUB_PAT / GH_TOKEN
  workflow依存 custom_nodes list valid

Execution environment
  Instance can become running
  current public SSH endpoint resolves
  private-key SSH authentication succeeds
  Host Key verification succeeds
  remote ComfyUI directory exists
  worker runtime available
  remote disk capacity sufficient
  remote localhost ComfyUI API reachable
  ScenePrompterExpand registered
  Scene Prompt Tools APIs available
  required custom nodes available
  required R2 model objects exist
```

未実装の検証を成功扱いにしない。capability実装に合わせてPreflight Gateを強化する。

---

## 24. R2 Manager Extension

既存Integrated R2 ManagerをExecutionでも唯一のR2 entry pointとする。

Executionで必要な追加capability:

```text
GET signing with caller-specified expiry
presigned PUT generation
multipart upload authorization if required
HEAD / metadata lookup
stream download-to-local-file
```

Execution専用の別credential storeを作らない。

---

## 25. Security

Local Main Processに留めるもの:

- Vast.ai API Key。
- SSH private key contents。
- R2 Access Key / Secret Access Key。
- Cloudflare API Token。

presigned URLはbearer credentialとして扱う。

- 必要直前に生成。
- object / operationを限定。
- full query stringをlogへ出さない。
- Project artifactへ保存しない。
- retry時は必要なら再発行。

Remote Workerはallowed rootを強制する。

```text
model operation    -> configured ComfyUI models root
artifact operation -> configured output root
worker temp        -> Batch Studio run temp root
```

path traversal / symlink escapeを拒否する。

---

## 26. Reference: anima-vast-workflow-runner

`dommyttdev2/anima-vast-workflow-runner`はinfrastructure patternの参考実装として扱う。

採用・適用する考え方:

- `VASTAI_API_KEY` contract。
- Vast.ai Instance normalization。
- start/stop lifecycle。
- public SSH endpoint resolution。
- private-key SSH。
- 小さいRemote Worker。
- Worker SHA-256 verification。
- filesystem path containment。
- artifact manifest/package/hash。
- Localで発行するpresigned PUT。
- RemoteからR2へのdirect HTTP transfer。
- phase-based Run State。
- Resume-aware processing。
- explicit cancel / interrupt。
- structured progress event。

適用しないもの:

- SSH Tunnel。
- reference runner processそのものをBatch Studioから起動する方式。
- reference runnerにmodel transfer実装が存在するという前提。
- reference runner固有のPrompt Library / scheduler contract。

---

## 27. Responsibility Matrix

| Responsibility | Batch Studio Main | Vast.ai | SSH | Remote Worker | ComfyUI | R2 |
| --- | --- | --- | --- | --- | --- | --- |
| Project target選択 | Yes | - | - | - | - | - |
| Instance lifecycle | coordinate | Yes | - | - | - | - |
| current SSH endpoint | consume | source | - | - | - | - |
| private-key auth | coordinate | endpoint | Yes | - | - | - |
| R2 credential | Yes | No | No | No | No | No |
| model GET URL発行 | Yes | - | URL transport | receives | - | serves |
| model bytes transfer | No | - | No | downloads | - | serves |
| Workflow execution | coordinate | - | control | orchestrates | executes | - |
| Scene Prompt continuous run | monitor | - | events | orchestrates | executes | - |
| remote output package | coordinate | - | control | Yes | produces | - |
| artifact upload authorization | Yes | - | URL transport | receives | - | accepts |
| R2 -> Local download | Yes | - | No | No | - | serves |
| final integrity check | Yes | - | - | source hash | - | transport/storage |

---

## 28. Failure Policy

異なるtransport / providerへsilent fallbackしない。

```text
Vast.ai API failure
  -> cached/manual SSH Hostへsilent fallbackしない

selected Instance missing
  -> 別Instanceを自動選択しない

SSH auth failure
  -> password authへfallbackしない

R2 model GET failure
  -> SCP model transferへfallbackしない

hash mismatch
  -> successにしない
```

Retryはidempotency / retry safetyが確認できるoperationだけに限定する。

```text
provider status fetch
SSH reconnect
remote stat
R2 GET with new URL
controlled R2 upload retry
history / queue polling
```

prompt submitは重複投入を防ぐevidenceがある場合のみretryする。

---

## 29. Execution UI

最低表示:

```text
Execution target
Cloud provider / Instance
Current Run ID
Current phase
Cloud Instance status
SSH connection status
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
Open local output
```

RemoteではInstance起動中、SSH準備中、生成中、成果物転送中を別phaseとして表示する。

---

## 30. Current Implementation Boundary

Service Integration / Vast.ai providerとして現在実装する範囲:

```text
Vast.ai API Key safeStorage / environment fallback
Instance list
status normalization
start / stop
public SSH endpoint resolution
Project remoteProvider / remoteInstanceId selection
Project-level Preflight Gate（provider設定 / key path / instance state / endpoint範囲）
Integrated R2 Managerのpresigned GET / temporary presigned PUT primitive
```

Execution foundationとして現在実装する範囲:

```text
Project-local persistent Execution Run
start / status / get / stop scheduling / force interrupt / resume IPC
Preflight + Workflow/API graph identity + Prompt Plan identity snapshot
Local / Remote phase model
Run-scoped progress / current branch / current prompt / error state
evidence fingerprint validation
stale Workflow/API graph / Prompt Plan resume rejection
secret / private-key contents / credential / presigned URL persistence guard
```

現在実装済みのRemote Execution基盤:

```text
SSH client / Host Key policy
Remote Worker
Remote ComfyUI install path validation
Remote environment bootstrap（aria2 / gh / PAT / ComfyUI latest release / custom_nodes）
R2 -> Remote model staging via aria2
per-model progress / evidence / Resume skip
size / SHA-256 validation + .part + atomic rename
signed URL non-persistence + expiry retry
```

今後のExecution実装範囲:

```text
ComfyUI API graph submission
Scene Prompt continuous runner
Execution連携としてのartifact package/upload/download
provider lifecycle automatic start/wait/finalize
```

未実装部分をUI上で成功済みとして扱わない。

Standalone R2 File Managerの一時PUT URL生成は実装済みだが、Remote Runのartifact package/hash生成、Execution専用Object Key管理、Remote WorkerへのURL受け渡し、upload evidence、R2からLocalへのstream回収とhash検証は未実装である。
