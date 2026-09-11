# Service Integrations / Cloud Instance Providers

Status: Active

## 1. 目的

ComfyUI Batch Studio が外部サービスの資格情報・接続状態・クラウドリソースを、Project Artifact から分離した app-wide capability として管理するための設計を定義する。

この文書を次の詳細仕様の正本とする。

- ホーム画面から開く「サービス連携」。
- Cloudflare R2 / Civitai の接続設定 UI。
- クラウドインスタンス provider の選択。
- Vast.ai API Key と Instance 管理。
- Vast.ai Instance と Remote Execution の handoff。

生成そのもの、SSH control plane、Remote Worker、R2 経由の model/artifact transfer は `../architecture/remote-execution.md` を正本とする。

---

## 2. 最上位原則

### 2.1 環境設定とサービス連携を分離する

`環境設定` は Batch Studio 自身の app-wide runtime / path 設定を所有する。

例:

```text
Local ComfyUI install path
Remote ComfyUI install path
legacy external model_catalog.json path
legacy R2 index path
Workflow Template override
Manifest override
```

`サービス連携` は外部サービスとの connection / credential / resource management を所有する。

```text
Cloudflare R2
Civitai
Cloud Instance Provider
```

API Key / Secret を環境設定とサービス連携の両方で編集できる二重 UI にしない。

### 2.2 Project へ Secret を保存しない

Project Artifact / `project_meta.json` に次を保存しない。

- R2 Secret Access Key。
- Cloudflare API Token。
- Civitai API Key。
- Vast.ai API Key。
- SSH private key contents。
- presigned URL。

Secret は Electron Main Process が所有する。

### 2.3 Renderer は Secret の保存状態だけを見る

保存済み Secret を Renderer へ復号して返さない。

Renderer が受け取れる例:

```text
configured
source = saved | environment | none
secretConfigured
sshPrivateKeyPath
sshPrivateKeyExists
```

SSH private key は Secret 本文ではなく Local filesystem path のみ app-wide 設定として扱う。

---

## 3. Home / Navigation

Project を開いていない Home の主要入口は次とする。

```text
ホーム
├─ プロジェクトを新規作成
├─ プロジェクトを開く
├─ 最近使ったプロジェクト
└─ サービス連携
```

R2 File Manager / Civit Explorer を Home中央の最上位actionとして並べない。サービス連携から開くほか、連携済みの場合はHome左navigationの「連携済みサービス」から直接開ける。

Project を開いていない side navigation:

```text
ホーム
サービス連携
連携済みサービス（条件付き）
  Cloudflare R2
  Civitai
  Vast.ai
```

左navigationの連携済みサービスから開いた場合は該当serviceをactive表示する。未連携serviceはこのグループへ表示しない。

---

## 4. サービス連携トップ

初期 provider card:

```text
サービス連携
├─ Cloudflare R2
├─ Civitai
└─ クラウドインスタンス
```

各 card は connection status を表示する。

標準 status vocabulary:

```text
未設定
環境変数を使用
設定済み
接続エラー
```

接続テストを行った画面では、その操作結果をユーザーへ明示する。

---

## 5. Cloudflare R2

R2 の実体操作と Secret ownership は既存 Integrated R2 Manager を維持する。

サービス連携画面で編集するもの:

```text
connection name
Account ID
Access Key ID
Secret Access Key
Public URL optional
Cloudflare API Token optional
デフォルト model bucket
model prefix
```

操作:

```text
接続テスト
保存
R2 File Managerを開く
```

既存 `R2ConfigStore` / `R2Manager` を再利用し、Service Integration 専用の R2 credential store を作らない。

既存 app settings の `r2Bucket` / `r2ModelPrefix` は互換性を維持しながらサービス連携 UI から編集する。将来 schema migration で R2-owned defaults へ移す場合も、Project / runtime contract を壊さない migration とする。

---

## 6. Civitai

サービス連携画面で編集するもの:

```text
Civitai API Key
```

環境変数:

```text
CIVIT_API_KEY
```

操作:

```text
保存
Civit Explorerを開く
```

既存 `CivitaiConfigStore` と Integrated Civitai Catalog Service を再利用する。

保存済み API Key は `safeStorage` で暗号化し、Renderer へ復号値を返さない。

---

## 7. Cloud Instance Provider abstraction

Remote Execution が特定クラウド API へ直接依存しないよう、cloud provider を Main Process service boundary として分離する。

概念構造:

```text
CloudInstanceService
|
+-- Provider Registry
    |
    +-- VastAiProvider
        +-- VastAiConfigStore
        +-- VastAiApiClient
        +-- Instance normalization
```

概念 capability:

```text
testConnection
listInstances
getInstance
startInstance
stopInstance
resolveSshEndpoint
```

Remote Execution は provider-specific raw response を直接処理せず、normalized Instance / SSH endpoint を利用する。

初期実装で登録する provider は `vastai` のみ。

---

## 8. クラウドインスタンス選択 UI

```text
サービス連携
  > クラウドインスタンス

利用するサービスを選択

[Vast.ai]
```

Provider を追加する場合、この階層に card を追加する。R2 / Civitai と Cloud Instance Provider を同じ flat credential form へ混在させない。

---

## 9. Vast.ai credential

### 9.1 Environment variable

Batch Studio における Vast.ai API Key の正式 environment variable は次とする。

```text
VASTAI_API_KEY
```

これは `dommyttdev2/anima-vast-workflow-runner` の既存 contract と互換にするための判断である。

Vast.ai client library / API の別 environment variable naming に暗黙依存せず、Batch Studio が解決した API Key を API client へ明示的に渡す。

### 9.2 Resolution order

```text
safeStorage に保存した API Key
        |
        | absent
        v
VASTAI_API_KEY
        |
        | absent
        v
未設定
```

### 9.3 Storage

推奨 app-wide 保存先:

```text
userData/
  vastai/
    config.json
```

保存内容:

```text
schemaVersion
encryptedApiKey?
sshPrivateKeyPath
sshPublicKeyPath
sshUser
comfyUiPort
```

API Key は `safeStorage` で暗号化する。暗号化不能時の plaintext fallback を禁止する。

---

## 10. Vast.ai Remote defaults

provider固有の初期 default は既存 `anima-vast-workflow-runner` と互換にする。

```text
SSH User            root
Remote ComfyUI Port 18188
```

SSH private/public key path はユーザーが file picker から選択する。SSH private key contents を Batch Studio 独自 config へコピーしない。

Remote ComfyUI install path は Vast.ai config では管理せず、環境設定の `Remote ComfyUI インストール先ディレクトリ` を正本とする。Remote実行では `BATCH_STUDIO_REMOTE_COMFYUI_INSTALL_PATH` 相当のPOSIX絶対パス設定を必須とする。

Remote ComfyUI Port は設定可能とし、`8188` を Vast.ai 用に hard-codeしない。

---

## 11. Vast.ai API boundary

Batch Studio Electron Main Process から Vast.ai REST API を直接呼ぶ。

Python subprocess、Vast.ai CLI、reference runner process を必須依存にしない。

認証:

```text
Authorization: Bearer <API Key>
```

初期利用 endpoint:

```text
GET /api/v1/instances/
GET /api/v0/instances/{id}/
PUT /api/v0/instances/{id}/   state=running
PUT /api/v0/instances/{id}/   state=stopped
```

Instance list は keyset pagination を実装し、`next_token` がある限り取得を継続する。1 page の最大件数は Vast.ai API contract に従う。

HTTP success だけで最終 Instance lifecycle が完了したとは扱わない。Remote Execution では必要に応じて subsequent status fetch で target state と SSH endpoint を確認する。

---

## 12. Normalized Instance

Vast.ai raw payload を Renderer / Remote Execution へそのまま漏らさず、最低限次へ正規化する。

```text
provider = vastai
id
label
status
rawStatus
intendedStatus
curState
statusMessage
gpuName
gpuCount
gpuRamMb
hourlyCost
sshHost
sshPort
```

Normalized status:

```text
running
stopped
starting
scheduling
stopping
offline
error
unknown
```

`exited + intended_status=stopped + cur_state=stopped` は stopped として扱える。

---

## 13. Public SSH endpoint resolution

SSH Tunnel は使用しない。

Vast.ai Instance が `running` の場合、公開 SSH endpoint は current API response から毎回解決する。

優先:

```text
ports["22/tcp"] public mapping + public_ipaddr
        |
        | unavailable
        v
ssh_host + ssh_port
```

`0.0.0.0` / `::` を接続先 host として採用しない。

Project へ SSH Host / Port を固定保存しない。

---

## 14. Instance Manager

Vast.ai service page では既存 Instance を一覧表示する。

最低表示:

```text
Instance ID
Label
GPU name
GPU count / VRAM
Normalized status
status message
hourly cost
current public SSH endpoint
```

初期操作:

```text
refresh
start
stop
```

初期 scope 外:

```text
new instance / offer search
destroy
reboot
bid modification
label editing
volume management
billing
```

特に `destroy` は destructive operation であり、Remote Execution の成立に不要なため初期 UI へ置かない。

---

## 15. Instance lifecycle

Start:

```text
User / Remote Execution
  -> start request
  -> status refresh
  -> running
  -> public SSH endpoint available
```

Stop:

```text
User / Remote Execution
  -> stop request
  -> status refresh
  -> stopped
```

Remote Execution は start/stop request の HTTP response だけで `RUNNING` / `STOPPED` 完了を確定しない。

`scheduling` は通常の `running` と同一視しない。実行開始時の policy は Remote Execution owner が定義する。

---

## 16. Project contract

Remote Project は provider-specific mutable connection data ではなく stable selection を保存する。

```text
project_meta.json.settings
  executionTarget = remote
  remoteProvider   = vastai
  remoteInstanceId = <positive integer>
```

保存しない:

```text
sshHost
sshPort
public IP
current GPU status
current hourly price
API Key
private key contents
```

Vast.aiの current state は実行直前に API から取得する。

---

## 17. Model Availability UI handoff

Project の `モデル配置` 工程で `executionTarget=remote` を選んだ場合、Cloud Instance selection を表示する。

初期 provider:

```text
Vast.ai
```

サービス連携済み Instance 一覧から選択し、Project には `remoteProvider + remoteInstanceId` を保存する。

Vast.ai未連携の場合は、ホームのサービス連携で設定が必要であることを明示する。

R2 model placement policy は従来どおり:

```text
Local execution  -> Local required / R2 optional
Remote execution -> Local optional / R2 required
```

---

## 18. Remote Execution handoff

Remote Run start 時:

```text
project.executionTarget = remote
        |
        v
remoteProvider = vastai
remoteInstanceId
        |
        v
Vast.ai API: get current instance
        |
        +-- stopped -> start request / running wait
        |
        +-- running -> continue
        |
        v
resolve latest public SSH host / port
        |
        v
app-wide SSH private key path / user
        |
        v
SshService
        |
        v
Remote Worker / ComfyUI
```

Vast.ai は Instance lifecycle と SSH endpoint discovery を所有する。

SSH Service は秘密鍵認証と remote control を所有する。

R2 は大容量 data transfer を所有する。

ComfyUI は generation を所有する。

Batch Studio Execution Service がこれらを orchestration する。

---

## 19. Instance final-state policy

Remote Execution の既定思想は initial state preservation とする。

```text
Run開始前からrunning
  -> Run終了後もrunningを維持

Batch Studioがstoppedから起動
  -> Run完了後は原則stoppedへ戻す
```

成功時 / 失敗時の `stop | keep | preserve-initial` policy を将来 UI で明示設定可能にできる。

この詳細な execution cleanup policy は `../architecture/remote-execution.md` が所有する。

---

## 20. Preflight

Remote / Vast.ai 選択時の Preflight は段階的に次を検証する。

Project-level blocking:

```text
remoteProvider = vastai
remoteInstanceId valid
```

Service-level blocking:

```text
Vast.ai API Key resolved
SSH private key path exists
Vast.ai API reachable
selected Instance exists
```

Execution-start blocking:

```text
Instance can reach running state
public SSH endpoint resolved
private-key SSH authentication succeeds
Environment SettingsにRemote ComfyUI install pathが設定済み
Remote ComfyUI environment is valid
```

初期実装で Execution Service 未実装の項目を成功したように偽装しない。検証 capability が追加された時点で Preflight Gate を強化する。

---

## 21. Security / logging

API Key を次へ出さない。

```text
Renderer response
Project files
application log
Grok attachment
error message
```

Vast.ai HTTP request の Authorization header を log しない。

SSH private key contents を読み込んだ場合も内容を log / Project persistence しない。

Public SSH host / port、Instance ID、GPU名、status は Secret ではないが、Projectのstable configuration sourceにはしない。

---

## 22. Failure policy

Silent fallback を禁止する。

```text
Vast.ai API unavailable
  != manual cached SSH endpointへ自動fallback

selected Instance missing
  != 別Instanceを自動選択

private key missing
  != password SSHへfallback
```

Provider error は provider context を付けてユーザーへ表示する。

Remote Execution が retry する場合も、Instance ID identity を維持する。

---

## 23. Reference implementation

`dommyttdev2/anima-vast-workflow-runner` は次の既存 contract / infrastructure pattern の参照元とする。

採用:

```text
VASTAI_API_KEY
private-key SSH
ssh_user = root
comfy_port = 18188
Instance normalization
start/stop lifecycle
public SSH endpoint resolution
```

Batch Studio では reference runner process 自体を起動せず、Electron Main Process内の provider serviceとして再実装する。

---

## 24. Acceptance Criteria

1. Home から「サービス連携」を開ける。
2. Home中央の主要actionから R2 / Civit を直接並列表示せず、連携済みserviceだけを左navigationへ条件付き表示する。
3. R2 / Civitai credential は環境設定ではなくサービス連携から編集する。
4. R2 File Manager / Civit Explorer はサービス連携、連携済み左navigation、application menuのWindowから開ける。
5. クラウドインスタンス選択画面に Vast.ai が表示される。
6. Vast.ai API Key を `safeStorage` で保存できる。
7. `VASTAI_API_KEY` を environment fallback として利用できる。
8. 保存済みAPI KeyをRendererへ返さない。
9. SSH private key contentsを保存せずpathだけを保持する。
10. Vast.ai Instance一覧をpagination-awareに取得できる。
11. Instanceのstart / stopを実行できる。
12. Destroy / Reboot / instance creationを初期UIに出さない。
13. Remote Projectに `remoteProvider=vastai` と `remoteInstanceId` を保存できる。
14. SSH host / portをProjectへ固定保存しない。
15. 実行時にcurrent Vast.ai API responseから公開SSH endpointを解決できる service API を持つ。
16. SSH Tunnelを導入しない。
