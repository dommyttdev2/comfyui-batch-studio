# Project Window / Execution Runtime Architecture

Status: Accepted design / implementation pending

## 1. 目的

ComfyUI Batch Studio の Multi Window 化にあたり、Project、Project Window、Execution Run、Execution Runtime の所有関係と lifecycle を明確に分離する。

この文書は次の事項の正本とする。

- Project Window と Project の関係。
- Project と Execution Run 永続履歴の関係。
- `LocalExecutionService` / `RemoteExecutionService` を含む Execution Runtime の app-wide ownership。
- Window close / Project close / Application quit と実行中 Run の関係。
- Local ComfyUI endpoint / Remote Instance の同時利用排他。
- Multi Window 時の Grok view / IPC / UI state の分離境界。
- File menu の New Project / Open Project と opening target 選択。

Local / Remote の個別実行手順、Remote Worker、SSH、R2 transfer、artifact recovery の詳細は `remote-execution.md` を正本とする。

---

## 2. 最上位の責務分離

基本原則は次の4層とする。

```text
Project
  = 何を生成するか

ExecutionRun
  = 今回何を実行するか / 何が起きたか

ExecutionCoordinator
  = Runをいつ・どのExecutorで動かすか

Executor / Infrastructure
  = ComfyUI / Vast.ai / SSH / Remote Worker / R2を実際に操作する
```

Project Window はこれらの上にある UI であり、Execution を所有しない。

```text
Project Window A ----+
                     |
Project Window B ----+----> Electron Main Process
                     |        |
Project Window C ----+        +-- ExecutionCoordinator
                              |      |
                              |      +-- LocalExecutionService
                              |      +-- RemoteExecutionService
                              |      +-- ExecutionResourceLockManager
                              |
                              +-- Project / Artifact services
                              +-- app-wide integrations
```

### 2.1 Project が所有するもの

Project は生成定義と、その Project に紐づく永続履歴を所有する。

代表例:

- `project_brief.json`
- `story.md`
- `models.json`
- `prompt_plan.json`
- Workflow / API graph
- Project settings
- `execution_runs/<runId>.json`
- `execution_runs/current.json`

Execution Run の履歴を Project 配下へ置く理由は、「この Project で、どの snapshot を使い、いつ、何を実行し、どこまで完了したか」が Project の再現性・監査履歴だからである。

### 2.2 Project が所有しないもの

次は Project の子オブジェクトとして lifecycle を持たせない。

- `ExecutionCoordinator`
- `LocalExecutionService`
- `RemoteExecutionService`
- `RemoteControlPlane`
- `RemoteInstanceLifecycleService`
- active worker / Promise / SSH session
- runtime resource lock

これらは Electron Main Process の app-wide Application Runtime として存在する。

Project を閉じたり Project Window を破棄したりしても、これらの service instance を dispose しない。

---

## 3. ExecutionRun の永続状態と Runtime 状態を分ける

Execution には、Project とともに保存すべき状態と、アプリ実行中だけ存在する状態がある。

| 種別 | 所有者 | 例 |
| --- | --- | --- |
| 永続 Run state | Project | phase、lifecycle、progress、prompt IDs、snapshot、evidence、error history |
| Run history | Project | `execution_runs/<runId>.json` |
| current Run pointer | Project | `execution_runs/current.json` |
| active worker | Application Runtime | Local / Remote worker Promise |
| SSH session | Application Runtime | `RemoteControlPlane` handle |
| resource lock | Application Runtime | Local endpoint / Vast.ai Instance lock |
| Window表示状態 | Project Window | current stage、Grok visibility、divider ratio |
| Grok login session | Application | persistent Electron partition |

永続 Run state と active worker を同一概念にしない。

Window が閉じても active worker は継続する。一方 Application process 自体が終了すれば active worker / SSH session は消滅するが、ExecutionRun の永続状態は Project に残る。

---

## 4. Execution の Project 参照は ownership を意味しない

現行 API のように、

```ts
localExecutor.start(projectRoot, runId)
remoteExecutor.start(projectRoot, runId)
```

と `projectRoot` を渡すこと自体は許容する。

この `projectRoot` は次を解決するための Execution Context であり、Executor が Project に所有されていることを意味しない。

- ExecutionRun state
- workflow snapshot
- prompt plan snapshot
- Project settings
- artifact output location

実装上は必要に応じて次のような参照型へ整理できる。

```ts
type ExecutionRef = {
  projectRoot: string;
  runId: string;
};
```

重要なのは型名ではなく、**Project lifecycle が Executor lifecycle を所有しないこと**である。

---

## 5. ExecutionCoordinator

Multi Window 化後の Execution lifecycle の正本は Renderer / Project Window ではなく Main Process の `ExecutionCoordinator` とする。

責務:

- Run start / resume / stop scheduling / force interrupt のオーケストレーション。
- Local / Remote executor の選択。
- Remote pre-generation phase を含む active execution 全体の追跡。
- Runtime resource lock の acquire / release。
- active Run の有無を application lifecycle へ提供。
- Project Window が存在しない間も Run を継続。
- Renderer は persistent Run を表示・操作するクライアントとして扱う。

概念 API:

```ts
class ExecutionCoordinator {
  start(projectRoot: string): Promise<ExecutionRun>;
  resume(projectRoot: string, runId: string): Promise<ExecutionRun>;
  stopScheduling(projectRoot: string, runId: string): Promise<ExecutionRun>;
  forceInterrupt(projectRoot: string, runId: string): Promise<ExecutionRun>;
  hasActiveRuns(): boolean;
}
```

実装時にこの形へ完全一致させる必要はないが、責務境界は維持する。

Remote の active 判定を `RemoteExecutionService.workers` だけで行ってはならない。Vast.ai Instance start、SSH接続、bootstrap、model staging 等、generation worker開始前も active execution に含める。

---

## 6. Project Window model

Project Window ごとに次を独立して保持する。

```ts
type ProjectWindowState = {
  window: BaseWindow;
  localView: WebContentsView;
  grokView: WebContentsView;

  projectRoot: string | null;

  grokVisible: boolean;
  localRatio: number;
  activeGrokContext: {
    root: string;
    stage: GrokContextStage;
  } | null;

  restoringGrokContext: boolean;

  grokNavigationQueue: GrokNavigationQueue;
  grokContextQueue: LatestGrokContextQueue<GrokPaneState>;
};
```

Main Process は複数 Project Window を registry で管理する。

```ts
const projectWindows = new Map<number, ProjectWindowState>();
```

現在の単一 `mainWindow` / `localView` / `grokView` / `activeGrokContext` を Multi Window の共有グローバル状態として残さない。

---

## 7. 同一 Project は1 Windowのみ

同一の filesystem Project root を複数 Project Window で同時に開かない。

```text
Window A -> D:\Project\reze
Window B -> D:\Project\reze   // prohibited
```

既に開かれている Project を Open Project で指定した場合は、新しい Window を作らず既存 Window を show / focus する。

理由:

- `prompt_plan.json` 等の同時編集競合を避ける。
- Project-level `current.json` や metadata の複数 Renderer 競合を避ける。
- 「Projectの現在画面」と「Execution Runtime」の責務を混同しない。

---

## 8. File menu / Project opening UX

Application menu の File に次を追加する。

```text
File
├─ New Project...
├─ Open Project...
├────────────
├─ Close Window
└─ Quit
```

`New Project...` / `Open Project...` を選択した時点で、Projectをどこで開くかを選択する。

```text
Projectをどこで開きますか？

[キャンセル]
[現在のWindowで開く]
[新しいWindowで開く]
```

### 8.1 現在のWindow

現在フォーカスされている Project Window の Renderer state を切り替える。

既存 Project の Execution Run を停止・破棄しない。

### 8.2 新しいWindow

新しい Project Window を生成し、その Window 上で新規 Project 作成または選択した Project の open を行う。

既存 Window の Project / Grok / Execution state を変更しない。

### 8.3 Dialog ownership

Open directory / message box 等の native dialog は、操作元の Project Window を parent として開く。

---

## 9. Grok state boundary

Grok の login session と Project-specific UI state を分ける。

共有してよいもの:

- persistent Electron partition
- login Cookie / browser session

Window単位で分離するもの:

- `grokView`
- visible / hidden
- divider ratio
- active Project / stage context
- navigation queue
- latest-context queue
- restoring flag

これにより、

```text
Window A -> Project A / Story conversation
Window B -> Project B / Models conversation
```

を独立して扱う。

Project × stage の最後の conversation URL は app-wide `GrokChatStateStore` に保存してよい。

---

## 10. IPC sender boundary

Window固有操作は Main Process の単一グローバル View を操作してはならない。

対象例:

- `GROK_SET_VISIBLE`
- `GROK_SET_CONTEXT`
- `GROK_SET_RATIO`
- `GROK_SET_DIVIDER_X`
- `GROK_RELOAD`
- Project close / current-window navigation

IPC は `event.sender` から操作元 `ProjectWindowState` を解決する。

```text
ipc event.sender
      |
      v
webContents.id
      |
      v
ProjectWindowState
```

Execution IPC は Window ownership に結び付けず、`projectRoot + runId` を明示して persistent Run を操作する。

---

## 11. UiStateStore boundary

app-wide UI state と Window-local current Project を分ける。

app-wide に保持するもの:

- recent Project paths
- last opened directory
- 起動時復元に必要な app-level state

Window-local に保持するもの:

- 現在その Window で開いている Project
- current stage
- Grok pane state

Project Window を閉じただけで、別 Window の current Project stateやactive executionをclearしない。

従来の `PROJECT_CLOSE -> UiStateStore.clearProject()` をそのまま Multi Window のWindow close semanticsへ流用しない。

---

## 12. Window lifecycle と Execution lifecycle

### 12.1 Projectを現在のWindowから外す

Project artifactやExecution Runを削除しない。

active executionは継続する。

### 12.2 Project Windowを閉じる

- Local Renderer WebContentsをclose。
- Grok WebContentsをclose。
- Window registryから削除。
- Project Executionをstop / pause / discardしない。
- SSH session / workerをWindow cleanupとしてcloseしない。

### 12.3 最後のWindowを閉じる

active execution が1件以上存在する場合は Electron Main Process を終了しない。

```text
window-all-closed
  |
  +-- active execution exists -> keep Main Process alive
  |
  `-- no active execution     -> normal app quit policy
```

active execution の判定は Local / Remote generation workerだけではなく、Remote bootstrap / staging / artifact delivery / finalizationを含む Run lifecycle 全体を対象とする。

### 12.4 明示的 Quit

File > Quit 等、明示的な Application quit では active execution が存在する場合に確認を表示する。

Window close と Application quit を同義にしない。

---

## 13. Runtime resource lock

Multi Window は複数Projectを同時操作可能にするため、実行リソース競合を Project UI ではなく Execution Runtime で制御する。

### 13.1 Local ComfyUI

初期仕様では、同じ normalized Local ComfyUI API endpoint を複数 active Execution Run が同時利用することを禁止する。

```text
local:http://127.0.0.1:8188
    -> Project A / Run A owns lock
```

別WindowのProject Bは編集・Compile・Preflight等を継続できるが、同じendpointへのStartはblocking errorとする。

理由:

- 同一queueへの複数orchestrator混在を避ける。
- Stop / interrupt の対象境界を曖昧にしない。
- Local成果物確認の誤帰属を避ける。

将来、endpointごとの安全な並列実行契約を定義できた場合のみ緩和する。

### 13.2 Vast.ai Remote Instance

同一 Vast.ai Instance を複数 active Execution Run が同時利用することを禁止する。

```text
vastai:<instanceId>
    -> Project B / Run B owns lock
```

別 Vast.ai Instance であれば parallel Remote Runを許可する。

同一Instance排他が必要な理由:

- Remote environment update / custom_nodes syncが共有環境を変更する。
- ComfyUI queue / interruptが共有される。
- Run Aのfinalize時にinitial-state restoreでInstanceをstopすると、Run Bを停止させる可能性がある。

### 13.3 Lock ownership

resource lockはProject settingsへ保存しない。

Projectは「利用したいendpoint / instance」を設定するだけであり、「現在誰が使用しているか」は Application Runtime が所有する。

概念:

```ts
class ExecutionResourceLockManager {
  acquireLocal(endpoint: string, ref: ExecutionRef): void;
  acquireRemote(provider: string, instanceId: number, ref: ExecutionRef): void;
  release(ref: ExecutionRef): void;
}
```

---

## 14. 同時利用 matrix

| 操作 | 仕様 |
| --- | --- |
| Project A生成中にProject Bを別Windowで開く | 許可 |
| Project A生成中にProject Bを編集 | 許可 |
| Project A生成中にProject BのPrompt設計 | 許可 |
| Project A生成中にProject BのWorkflow生成 | 許可 |
| 同じProjectを2 Windowで開く | 禁止。既存Windowをfocus |
| 同じLocal ComfyUI endpointで2 active Run | 禁止 |
| 別Local endpointで2 active Run | 将来拡張可能。初期実装では要件外 |
| 同じVast.ai Instanceで2 active Run | 禁止 |
| 別Vast.ai Instanceで2 Remote Run | 許可 |
| Project Windowを閉じる | Run継続 |
| Run中に最後のProject Windowを閉じる | Main Process継続 |
| 明示的Application Quit | active Run確認後に終了可能 |

---

## 15. コード責務の目標構造

概念的には次の境界を目標とする。

```text
src/main/
  execution/
    execution-coordinator
    execution-run repository/state
    execution-resource-lock
    local-execution-service
    remote-execution-service

  remote/
    remote-control-plane
    remote-worker
    remote-model-stager
    remote-environment-bootstrap
    remote-instance-lifecycle

  window/
    project-window-manager
    project-window-state
```

実装時に必ず物理directoryを一度に変更する必要はない。

本Decisionの本質は source tree の見た目ではなく、次の依存方向を守ることである。

```text
Project Window
   |
   v
Application services
   |
   +--> Project / Artifact
   |
   `--> ExecutionCoordinator
          |
          +--> Local Execution
          `--> Remote Execution
```

`LocalExecutionService` / `RemoteExecutionService` を Window や Project component の所有物へ戻してはならない。

---

## 16. 非目標

初期 Multi Window 実装では次を必須としない。

- 同一Projectの複数Window編集。
- 同じLocal ComfyUI endpointへのparallel Run。
- 1 Projectから複数active Runの同時実行。
- Electron Main Process自体を終了しても生成を継続する完全daemon化。
- Window layoutのセッション間完全復元。

Application processが明示的に終了した後もRunを継続する要件は、detached worker / daemon等を含む別Decisionとして扱う。

---

## 17. Acceptance criteria

実装は最低限次を満たす。

1. File > New Project / Open Project で current window / new window を選択できる。
2. Project AのRun中にProject Bをnew windowで開いてもRun Aが停止・pause・discardされない。
3. Window BのGrok操作がWindow AのGrok表示・conversation contextを変更しない。
4. 同一Projectを再度開くと既存Windowへfocusする。
5. active Runを持つProject Windowを閉じてもRunが継続する。
6. active Run中に最後のWindowを閉じてもMain Processが終了しない。
7. same Local endpoint / same Vast.ai Instanceの競合StartをExecution Runtimeが拒否する。
8. 別Vast.ai InstanceのRemote Runは並行して保持できる。
9. Application quitとWindow closeが別のlifecycleとして扱われる。
10. Project配下のExecution Run履歴とapp-wide Execution Runtimeのownershipがコード上でも混同されない。
