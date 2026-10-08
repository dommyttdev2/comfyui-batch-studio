# Webベースへの完全移行計画

Status: P0基準・計画整理（Web実装前） / 初回調査: 2026-10-04 / コード再照合: 2026-10-06

## 1. 結論と移行の範囲

Electronを実行時・ビルド時・通常テストから除去し、React Web UI + 常駐Node.jsサーバーへ移行できる。Codex/GrokのCLI adapter、会話保存、工程task、Workflow compiler、Local/Remote execution、R2/Civitai/Vast.aiの業務処理を再利用する。移行の主作業はアプリケーションの起動・権限・状態管理と通信境界の再構成であり、AIの実行方式変更ではない。

最初の完成形は「単一ユーザー・単一Windowsホスト・単一server process」。同じホストのブラウザで全機能を利用し、認証を整備してLANの別端末も利用可能にする。Linux serverでの動作確認も移行検証へ含めるが、クラウド配置、多人数の認証基盤、水平分散、任意の利用者PC上のComfyUI操作は別の拡張として扱う。これらを実現するには追加の分離・接続・運用設計が必要になる。

「完全移行」はElectronを不要にすることを意味する。CLI、SSH、モデルやプロジェクトファイルへのアクセスにはserverが必要。ブラウザだけの静的サイトにはしない。ブラウザのlocalhostは閲覧端末、serverのlocalhostは実行ホストを指すため、ComfyUI endpointはserver設定として扱う。

### 1.1 刷新の必須方針

**後方互換性と旧データのマイグレーションは実装しない。fallbackは禁止する。** この方針は本計画・調査索引・Issue・受入条件すべてに優先する。

- 新Web版は新しいdataDir・現行schema・明示的に設定された実行経路で開始する。旧Project、Run、AI履歴、設定、Secret、upload状態を自動検出・コピー・変換・継承しない。旧アプリのデータを変更・削除する作業も行わない。
- 旧形式の読み替え、互換API、Electron互換bridge、旧provider/store、移行ツールを作らない。現行schemaに合わない入力は明示的なerrorとする。新形式のProjectを新規作成し、設定・認証は新Web版として登録する。
- API/画像codec/provider/実行target/Secret源は一つの選択済み経路を使う。失敗時に別経路・別provider・旧実装・平文保存・旧API・旧画像処理へ自動切替しない。必須値の欠落を推測値や旧設定で補わない。
- retryは同じ選択済み経路に対して、定義した条件と回数でのみ行う。新Web版自身のRun照合・再開・障害復旧は対象とするが、復旧不能な状態を別経路の成功として扱わない。
- backup復元や設定変更は、新Web版の現行形式に対する明示的なユーザー操作としてのみ扱う。破損時の自動backup採用・空状態への置換は禁止する。新旧版間の変換・復元は提供しない。
- 層分離は新Web版の業務coreを独立させるために行う。刷新branchで旧Electron版の起動・操作・保存互換を維持することは受入条件にしない。現行版の保守はmainで行う。

## 2. 調査の基準と根拠

公開済み `v0.82.0`（`1e2614aef2ae08fa0c596fa34ac6c2a885aeb621`）から刷新統合branch `codex/web-migration` を作成した。再照合基準は `2d2656d2673209a3330d792520e958296a473b08`。元の `codex/web-p1-execution-core` に残るCLI修正は未統合として保持し、旧P1原型は破棄済みで、このbaselineの受入証拠には含めない。

P0の再照合対象は272コード・設定ファイル（src 164、tests 73、scripts 8）だった。binary asset 8件、既存仕様・運用文書31件は別の母集団として管理した。追加実装後の最新の対象数、ファイル別の主担当・完成phase・検証gate・IPCの処置は[調査索引](web-migration-audit.md)、hash・行番号・依存は[機械可読索引](web-migration-inventory.json)に記録する。P0の件数を現在の実装範囲と読み替えない。

対象はsrc、scripts、tests、.github、schemas、templatesおよびルートのbuild/launch設定。node_modules、生成済dist、binary PSD/画像、release evidenceはコード走査対象から除外した。PSDはcopy-runtime、server読込、rendererのag-psd/Canvas処理の経路を調査した。静的走査は全行の手動レビューや実動作の保証ではなく、動的import・文字列内コード・外部CLIとの互換性は各フェーズで検証する。

主要な確認事実:

- 初回調査時の`main.ts`は2,416行で、service初期化、runtime復旧、window、dialog、IPC依存供給が混在する。
- `src/shared/ipc.ts`は171定義（invoke 160、notification 11）。R2を途中で切り取っていた旧regexを修正し、全invokeを実在する一つのhandlerへ、全notificationを送信元へ接続した。171個のHTTP endpointが必要という意味ではない。
- `ipc-registration.ts`の依存型は`main.ts`から逆参照される。HTTP handlerを増やす前にservice interfaceを独立させる必要がある。
- CLI adapters、AgentConversationRunner、task runnersはNode主体。通常会話・工程成果物task・session/model/historyは既に共通化されている。
- `image-pipeline.ts`、`thumbnail-image-cache.ts`、`thumbnail-service.ts`、`marketplace-image-service.ts`が`nativeImage`に依存する。
- Civitai/R2/Vast.ai設定に加え、`app-settings.ts`も動的require経由で`safeStorage`を使う。
- `use-editor-autosave.ts`だけでなく、thumbnail/marketplaceのserver保存fallbackも`Date.now() * 1000`に依存。三箇所を一つのserver revision契約へ変更する。
- `ipc-access.ts`は信頼できるWebContentsの種類とProject rootを権限の根拠にする。Webから任意のsender kind/rootを受け入れる置換は不可。
- image-memory test、CIのxvfb、起動中チェック、run/update、resourceコピー、testのcompile先にもElectron依存がある。

### 2.1 MECEの定義と再照合方法

対象集合をcode/config、binary resource、仕様文書、IPC、test実行経路に分ける。異なる集合の件数を合算して「全コード」と称さない。code/configの各fileにはW01–W14の**主担当を一つ**、IPCには移行分類を一つ、testには現実行経路を一つ割り当てる。横断条件（認可、排他、復旧等）は主担当を追加せず、gateと依存として参照する。

fileの主担当はそのfileの変更責任、IPCの主担当は操作の意味契約の責任である。例えばassistant handler fileの変更はW01、会話の意味契約はW04が担当する。同じ実装を二重開発する意味ではなく、W01はW04のserviceを呼ぶ。巨大なmain.tsの分割はW10が所有し、抽出先serviceの契約は各領域へ移す。

phaseは主実装の受入段階、Wは変更責任、Gは受入条件とし、相互に置き換えない。先行技術検証や共通基盤の作成を機能完成と数えない。Desktop adapter/旧codeが残るfileには別に`desktopRemovalPhase=P9`を記録し、API完成と旧code撤去を同じ段階としない。分類・hash・リンクの機械検証は`node docs/roadmap/web-migration-audit.cjs --check`、コード変更後の再生成は`--write`で行う。新規file/IPCの分類、技術判断とgateの変更はレビューを要する。

生成済planning evidence（本計画、索引、JSON、再照合tool）は母集団から除外して自己参照を避ける。release履歴は移行対象のActive仕様と分け、依存package内部・秘密設定・ログは走査しない。CLI実動作、binaryの視覚互換、動的参照は機械検証の対象外でありgateで確認する。

## 3. 目標構成

```text
Browser: React UI / AssistantPane / editor / Canvas / routes
  | same-origin HTTP commands, queries, binary uploads/downloads
  | authenticated WebSocket: scoped events, reconnect
Node Server
  + API validation / authentication / Project & File authorization
  + ClientSession / ProjectRegistry / EditorRevision / PickerSession
  + Project / Artifact / Compiler / Catalog / Caption / Image services
  + AgentRuntime -> Codex CLI / Grok CLI
  + ExecutionRuntime -> Local ComfyUI / SSH Remote Worker
  + TransferRuntime -> R2
  + SecretStore / dataDir / resourceDir / logs / recovery
```

提案する分割（実装時に細部を確定）:

- `src/server/main.ts`: server起動・停止、single-instance lock、health、runtime初期化。
- `src/server/application/`: 現main.tsのuse case、復旧、編集guard、設定、確認要求。
- `src/server/transport/`: HTTP route、WebSocket、DTO検証、認証・認可、binary配信。
- `src/server/platform/`: SecretStore、ImageCodec、resource解決、CLI/OS適合。
- `src/main/`の純粋処理・Nodeサービスは初期段階では配置を維持し、依存の分離後に移動する。一度に名称変更と機能変更を重ねない。
- `src/shared/`: domain型/純粋処理とAPI契約を分離。Desktop API型をdomain型へ混ぜない。
- `src/renderer/api/`: 新Web API/イベントclient。Electron互換adapterや自動切替は実装しない。

HTTPとWeb UIは同一originで提供する。dev時はVite proxyを使い、build時はserverがdist-rendererと明示的に列挙したWeb routeを提供する。未知routeとAPI/asset/healthの404をSPA HTMLへ置換しない。

### 3.1 プレゼンテーション層とビジネスロジックの分離

Web移行の前提として、**Electronを使う表示・操作受付の実装と、業務判断・状態遷移を分離する**。現在のMain Process全体をビジネスロジックとみなさず、Renderer全体を単なる表示ともみなさない。file名やprocessではなく責務で切り分ける。Node.jsで動く処理であっても、HTTP、画面、OSに依存する部分は業務の中核へ持ち込まない。

| 層 | 所有する責務 | 依存してはいけない対象 |
| --- | --- | --- |
| プレゼンテーション・入力境界 | React表示、画面状態、navigation、確認画面、Electron window/menu/dialog、preload/IPC、Web HTTP/WebSocket controller、DTOと表示用errorの変換 | 業務ルールの独自実装、直接の永続化・CLI起動・生成制御 |
| アプリケーション層 | Project/Artifact/AI/Execution等のuse case、業務上の権限・編集可否、transaction、排他、確認後の実行、jobの調整 | React/DOM、Electron、IPC sender、HTTP request/response、UIの寿命 |
| ドメイン層 | Artifactの意味検証、依存/stale、model identity、Workflow変換規則、Runの状態遷移・再開条件などの業務ルール | 上記の表示・通信依存、直接のファイル/ネットワーク/OS操作 |
| インフラストラクチャ層 | Repository、ファイル保存、CLI adapter、ComfyUI/R2/Civitai/Vast.ai/SSH client、SecretStore、ImageCodec、OS/resource解決 | 業務判断の重複、presentationを経由したuse case実行 |

Electronの`safeStorage`や`nativeImage`は表示以外でも使われるため、プレゼンテーション層へ一括移動せずインフラ実装として隔離する。`main.ts`のbootstrapはcomposition rootとして各実装を結線する。これらを含む「Electron依存の撤去」と「表示から業務ロジックを分離すること」は別の作業として扱う。

依存方向は以下を固定する。インフラ実装はアプリケーション層が定義するportを実装し、composition rootだけが具体実装を選ぶ。

```text
Web presentation ───────> Application use cases ─> Domain rules
                                   │
                                   └─> Ports (interfaces)
                                           ↑ implements
                                   Infrastructure adapters
```

最終配置は`src/domain/`、`src/application/`（use case/port）と、`src/server/transport/`、`src/server/platform/`等の実装を基本とする。前述の`src/server/application/`は切出し途中の配置として利用できるが、業務coreがserverの起動・transportに依存する状態を完成形にしない。既存`src/main/`の純粋処理とNode serviceは、責務を分離してから必要なものを移す。単にディレクトリを移動して分離完了とはしない。

### 3.2 既存コードの切り分けと共有契約

| 現在の混在箇所 | presentation/adapterに残す処理 | 共通ビジネスロジックへ抽出する処理 |
| --- | --- | --- |
| `main.ts`、`ipc-registration/*` | sender/sessionの解決、IPC/HTTP入力、window操作、応答・event送信 | `ensureProjectWritable`、実行復旧、Project/Artifact操作、task/run開始・停止のuse case |
| `confirmRunStopBeforeLeave`等の確認フロー | dialog、button表示、navigation、未保存状態の表示 | 停止が必要な条件、停止方法、停止確認、編集を許可する条件。Webでの離脱差分は4.2に従う |
| RENT/削除/SSH trust/backup復元 | 確認対象と理由の表示、ユーザー意思の送信 | prepare/confirm、対象再照合、期限・revision・fingerprint検証、実行と結果不明の照合 |
| `App.tsx`、各Stage、`use-editor-autosave.ts` | form入力、debounce、loading/error表示、保存要求、画面内の選択 | canonical validation、server revision/CAS、編集lease、保存/確定/生成の許可判断 |
| AI/Executionの通知処理 | `webContents.send`、WebSocket配信、表示用snapshot変換 | provider-neutralな業務event、runtime所有権、履歴・進捗更新、復旧と排他 |
| `image-pipeline.ts`、設定store | ImageCodec/SecretStoreの具体的なElectron/OS実装 | 画像サイズ・出力形式・保存可否などの契約、credential利用条件。画素計算は純粋処理として保持 |

共通use caseの入力は認証済みactor/contextと型付きcommand、出力は結果・job参照・確認要求・業務errorとする。Electron event、WebContents ID、DOM event、HTTP statusをcoreの型へ持ち込まない。transport側の入力形式検証とcore側の業務検証を区別し、UIでの補助検証だけでserver側の業務判断を省略しない。

Repository、SecretStore、ImageCodec、AgentCliAdapter、外部service client、event sink等はportを通して注入する。業務coreが`window.batchStudio`、`ipcMain`、`dialog`、`shell`、`webContents`、Reactを直接呼ばない。長いuse caseの継続はruntime/jobが所有し、presentationのunmountや接続切断を実行終了条件にしない。

既存Electron実装から再利用する業務ルールを抽出し、**新Web presentationだけが業務coreを呼ぶ**。Electron presentationは現状調査の参照であり、新版で動かす互換経路ではない。HTTP handlerへ業務ルールを重複実装しない。この層分類はW01–W14とは独立した責務軸であり、fileの主担当を重複追加しない。W10が切出しを調整し、各Wが抽出された業務契約を所有する。

## 4. 機能・ファイル単位の移行方針

以下は主担当の正本。file単位の全対応は索引に置き、ここで同じfile一覧を重複管理しない。

| ID | 変更責任の範囲 | 他領域との境界 | 完成 / gate |
| --- | --- | --- | --- |
| W01 | transport、IPC/preload/API DTO、入力検証と認可 | 業務処理はW03–W09、Secret実装はW10を呼ぶ | P2 / G01 |
| W02 | Web shell、共通UI/CSS、navigation、editor flush/lease UI | 各機能UIは対応W、物理保存はW03/W09へ | P3 / G02 |
| W03 | Project/Artifact、draft/history、transaction、共通JSON保存 | AI生成はW04、検証はW05、画像editor保存はW09へ | P3 / G03 |
| W04 | AI provider/session/model/history、chat/task、workspace/import | transportはW01、Artifact保存はW03、CLI secret隔離はW10へ | P4 / G04 |
| W05 | model選択/解決、Compiler、availability、Preflight | catalog取得はW07、R2 lookupはW08、generationはW06へ | P5 / G05 |
| W06 | execution、ComfyUI、SSH、Remote Worker、復旧/finalization | Vast.ai APIはW07、R2転送はW08、server停止signalはW10へ | P6 / G06 |
| W07 | Civitai catalog/cache/rate limit、Vast.ai管理操作 | Secret保存はW10、run内instance lifecycleはW06へ | P5 / G07 |
| W08 | R2 object/index、multipart/転送jobとUI | Secret保存はW10、認可binary入口はW01、runの制御はW06へ | P5 / G08 |
| W09 | codec/画素、画像cache、Caption/成果物、PSD、Picker、画像editor保存 | asset認可はW01、revision/lease共通契約はW02、resource配置はW13へ | P7 / G09 |
| W10 | main分割、bootstrap、OS、Secret、dataDir、process環境とshutdown | 各runtime停止/復旧はW04/W06/W08を呼ぶ | P5 / G10 |
| W11 | build/launcher/update、CI orchestration、仕様更新 | test内容はW12、runtime resource内容はW13へ | P8 / G11 |
| W12 | test/harness/fixture、実環境・browser検証の実行計画 | 判定基準は各G、実行経路はW11へ | P8 / G12 |
| W13 | schema/Template/Manifest/targets/PSD/previewの管理・配置契約 | CompilerはW05、画像処理はW09、build copyはW11へ | P8 / G13 |
| W14 | 旧実装・旧store参照・互換/fallback経路の撤去 | 旧データ移行は実装しない。依存package削除はW11へ | P9 / G14 |

IPCはquery 44、command 65、binary-query 8、binary-command 6、event 2、ui-local 5、ui-flow 28、native-replacement 13の8分類（合計171）。現通信方向invoke/notificationは独立属性であり、分類を混ぜない。`query`には現状の副作用を持つ読込を含むため、そのままGETを公開せず、状態復元やprovider選択のcommandを分離する。

### 4.1 APIとイベント

- domain serviceはElectron eventやHTTP requestを受け取らない。認可済みcontextと検証済みinputを渡す。
- 提案例: `/api/v1/projects/:projectId/...`、`/api/v1/jobs/:jobId`、`/api/v1/assets/:assetId`。rootや任意のfilePathを外部権限の根拠にしない。
- server側で型だけでなく実行時入力検証を行う。エラーをcode/message/retryableへ正規化し、秘密や内部stackを返さない。
- commandにはrequest ID/idempotency keyを設ける。CLI開始、Run開始、R2転送、Vast.ai RENTはrequestを永続的に予約してから実行する。外部APIが受理した直後にserverが落ちた場合は結果不明として照合し、同じRENTを無条件に再送しない。外部providerまで含めたexactly-onceを保証すると記載しない。保存・設定変更も競合を検出する。
- 長い処理はjob IDを返す。request切断でCLI/生成/転送を中止しない。明示stop/cancelだけを受け付ける。
- eventsはprojectId/stage/provider/sessionId/turnId/jobId/sequenceを付ける。初期snapshotと購読の間の取りこぼし、再接続時の重複・順序逆転を解決する。
- event replayは上限付きとし、履歴不足なら明示的な再接続errorを返す。自動的にsnapshotだけへ切り替えて成功扱いしない。ユーザーの再読込は新接続の正規snapshot/購読手順で行う。遅いclientのbuffer/backpressureも上限を設ける。secret/raw reasoningは配信しない。
- layout、Pane visible/ratio、menu、ClipboardはReact/browserへ移す。全IPCを汎用RPCとして公開しない。

### 4.2 セッション・同時編集・終了

- ClientSessionは選択Project、工程、provider、画面状態を所有する。runtimeとProjectファイルの所有者にはしない。
- 複数Projectは、1つのブラウザ画面内のアプリ内タブで切り替える。同一ProjectはWorkspace内で1タブとし、再Openは既存タブを選択する。Projectごとの工程・draft・Pane状態を保持する。他clientとの編集leaseとserver revision/CASは維持する。Civitai Explorer/R2 Browser等は大型モーダルで操作する。詳細は[画面内タブ・モーダル計画](web-workspace-tabs-plan.md)を参照する。
- 新schemaのrevisionはserverが発行し、更新にはexpectedRevisionを必須とする。不一致は409相当の競合、欠落・旧形式は入力errorとする。client hookとthumbnail/marketplace server保存の三箇所を変更し、時刻採番や旧revisionの読み替えを残さない。
- app内navigationはflush完了後に移動。tab終了だけで保存成功を保証しない。必要な未送信draftは端末内で回復可能にし、再送時もCASを適用する。
- 現`EXECUTION_LEAVE`はProject一致の検証後にtrueを返し、工程移動ではRunを停止しない。Webでも維持する。現Desktopで停止確認があるのはProject切替・window close・app exitである。Webではtab切断/Project切替とserver終了を分離し、tab離脱でruntimeを停止しない。この差分だけを仕様変更として文書・testへ反映する。
- server停止は別の管理操作とする。graceful stop、force interrupt、復旧不確定Run、Vast.ai finalization、R2転送、AI子processまで対象にする。強制終了後は状態照合を経て復旧し、停止/生成済みを推測して成功にしない。
- `ExecutionCoordinator`と`ensureProjectWritable`の制約は維持する。in-memory lockを複数server processの排他と誤認しない。dataDir lockに加え、別dataDirのserverが同じProject/ComfyUI/instanceを操作する場合も拒否または照合できる所有権を定義する。browser editor leaseと生成資源lockは別の対象として管理する。
- AI conversation/taskの排他はavailability/model/workspace待ちより前に原子的に予約する。HTTP並行requestで同じstage/providerが二重起動しないことを確認する。

### 4.3 ファイル・画像・転送

- ProjectRegistryは管理者が登録したrootをcanonicalizeして管理する。Windows大小文字、junction/symlink、UNC、同じrootの別名を確認する。
- 画像、Template、成果物はscope付きasset IDから解決し、realpath/型/サイズを検証する。任意path読出、探索、上書きを拒否する。出力先や鍵/CLI pathの変更は管理者操作。
- browser FileはserverのfilePathを持たない。アップロードはserver stagingへstreamingし、source fingerprintを確定して既存R2 multipart jobへ接続する。
- R2のserver既存file uploadとbrowser uploadは区別する。途中切断後のbrowser uploadは受領済みoffset/partを照合して再開できる経路を用意する。大きなmodel binaryを全量JSON/base64にしない。
- gallery/source/downloadはHTTP binary URLを唯一の取得契約とし、旧data URL DTOの互換adapterを作らない。private画像に長寿命の無認証URLを発行しない。cacheはscope/hash/variantで管理し、cache miss時の正規処理も選択済みcodecで実行する。decode失敗時に旧codecや未検証の元画像を代用しない。
- codec置換ではBGRA/RGBA、EXIF、crop端数、Lanczos、alpha、JPEG白背景、PNG/WebP、pixel budgetを確認する。`image-pipeline-core`の既存計算を保存し、encode/decodeのみ交換して差分を限定する。
- ZIP生成、画像validation、cache pruning、tracked output cleanup、atomic-image-output、Marketplace manifest/hash gateは維持する。
- PSDはag-psdとCanvas処理を再利用する。配信可能なfontを明示し、選択済みfontの読込完了後にrenderする。fontがない/読込失敗の場合はrenderを停止しerrorを表示する。別fontへの自動代替は禁止し、変更する場合はユーザーが明示的に選択する。
- Explorer表示はWeb file list/パス表示/downloadへ変更する。別端末のExplorerにserver pathを開く機能としては提供できない。

### 4.4 権限・Secret・確認操作

- default bindはloopback。loopbackでも認証、Origin/Host検証、変更操作のCSRF対策を実施する。WebSocketもhandshakeと購読scopeを検証する。LAN公開はTLSと認証を前提にする。
- 現sender kindをclient入力から採用しない。serverのsession/role/project/file権限から毎回判定する。Pickerにも所有session、Project、source種類、許可asset、世代を持たせる。
- SecretStoreをCivitai/R2/Vast.ai/AppSettingsへ注入し、Secretの取得元を設定で一つ指定する。指定元が利用不能ならerrorとし、環境変数/別store/平文へ自動切替しない。鍵を暗号文の隣に無保護保存しない。
- 旧safeStorageデータの復号・読替・コピー・移行ツールを作らない。新Web版でSecretを新規登録する。CLIの認証は設定済み実行ユーザーのものを使い、browserへ渡さない。必要な認証が利用不能なら処理を開始しない。
- server process全体のenvをCLIへ無条件に継承しない。providerに必要な認証/envを選別し、R2/Civitai/Vast.ai secretやSSH鍵をworkspaceとCLIの参照可能領域から隔離する。
- CLIのcwd/workspace設定だけでファイル読取範囲が限定されるとは判断しない。各providerの実sandbox挙動をG04で検証し、必要なら別実行ユーザー等のOS境界を追加する。env削減だけで同一ユーザーのSecretファイルが保護されるという前提を置かない。
- CLI実行path、ComfyUI endpoint、SSH endpoint、出力先の任意変更は強い権限を要する。通常利用者に任意processや任意URLへの接続機能を公開しない。
- RENT、instance削除、SSH初回信頼、offline Run破棄、Run/editor backup復元、破損editor初期化、最新Prompt Planでの再実行はprepare/confirmで実装する。server発行の有効期限付きtokenに対象・価格/条件・fingerprint・revisionを結び付け、confirm時に再照合する。単なるclientの`confirmed: true`で代替しない。
- 変更・生成・転送の監査ログはuser/session/project/request/job IDを記録し、secretを伏せる。healthは認証情報を表示しない。

## 5. 実装フェーズと完了条件

| 順序 | 作業単位 | 成果物・完了条件 | 依存 |
| --- | --- | --- | --- |
| P0 | baselineと契約固定 | 調査索引、全171 IPC処置、既存fixture、新Web版のUI/画像/Run/AI受入checklist。現未コミット変更を取り込む時点を固定 | なし |
| P1 | presentationと業務coreの分離 | 3.1/3.2に従いmain/IPC/Stageの責務を切分け、use case/domain/portを抽出。業務coreをElectron/React/HTTPなしで検証。Electron互換adapterは作らない | P0 |
| P2 | server基盤 | HTTP/WebSocket、認証/認可、data/resourceDir、lock、job/event/idempotency、API version/build ID、graceful shutdown | P1 |
| P3 | Project/ArtifactとWeb shell | Webから作成/選択/保存/確定/reset、catalog fixtureでcompile。React内Pane配置、route、server revision/lease。権限外root/assetを拒否 | P2 |
| P4 | Codex/Grok全機能 | chat/task、resume/history/models、stop、artifact import、event再接続、二重起動防止。ブラウザなしでもtask完了 | P2,P3 |
| P5 | 設定・外部連携 | Secret新規登録、Civitai/R2/Vast.ai、SSH確認、browser/server file転送、confirm契約。実catalog/R2設定でmodel選択・availability・Preflightを統合。巨大fileをstreamingし再開できる | P2,P3 |
| P6 | 全生成runtime | Local/Remote start/resume/stop/interrupt/reconcile、resource lock、R2成果物取得、Vast.ai finalization、server再起動復旧 | P3,P5。AIによる入力生成はP4で別検証 |
| P7 | 画像・後処理完全移行 | codec、gallery/cache、Picker、PSD/font、caption、Marketplace/ZIP。全画像・メモリgate通過 | P3,P5; P6で実成果物確認 |
| P8 | 新規配布・起動・受入 | server build/resourceコピー、launcher/service実行、空dataDirからの新規設定・Project作成、Windows/Linuxのローカル検証、browser E2E | P4-P7 |
| P9 | Electron廃止 | 新Web版の受入gate通過後にpreload/IPC/Desktop entry/依存/xvfb/旧testsを除去。Electron未インストールでbuild/start/test/全操作成功 | P8 |

P7のcodec技術検証はP1から先行できる。W10のmain分離はP1、server起動はP2、Secret/OS適合を含む完成はP5。W05の純粋CompilerはP3、実catalog/R2との統合はP5。W01の共通transport基盤はP2で完成し、各機能routeの接続は対応Wのphaseで受け入れる。P4とP5はP3の契約確定後に独立実装できる。各phaseはレビューできるPR単位に分割し、phase全体を一つの巨大PRにしない。

P1/P2から新Web契約を使う。調査のため旧codeがsourceに残る場合でも、新Web版からは到達させない。Electron互換adapterや旧経路への切替は作らない。

P1は次の順で進める: (1) 混在する処理を3.1の四層へ割り当てる、(2) 新command/result/eventとportを定義する、(3) 再利用する業務判断とuse caseを抽出する、(4) 新インフラ実装/fakeを接続する、(5) core単独testで新契約を検証する。P2のWeb controllerは、この契約を呼ぶ。画面・transport・serviceのいずれにも同じ業務判断を再実装しない。

## 6. 検証計画

### 6.1 主担当別の受入gate

gateの判定は下表を正本とする。各file/IPC/testが参照するGは索引に置く。既存testのfeature対応は必要条件の一部であり、Web固有の新規検証を置き換えない。

| Gate | 主担当 | 判定する対象と証拠 |
| --- | --- | --- |
| G01 | W01 | 全160 invoke/11 notificationの処置、DTO・scope・Origin/CSRF・秘密漏えい・body上限、replayとrequest再送をAPI integrationで検証 |
| G02 | W02 | shell/route/複数tab、工程離脱とProject切替の違い、flush/未保存回復、lease UIをbrowser E2Eで検証 |
| G03 | W03 | 作成/scan/draft/confirm/reset、stale/hash、atomic JSON・journal/backup、Project alias/書込guardをservice/API testで検証 |
| G04 | W04 | 両providerの認証/models/chat/task/resume/stop、session mismatch、workspace/成果物隔離、並行開始と切断をadapter/API/実CLIで検証 |
| G05 | W05 | family/model/version/file/trainedWords、compilerのdeterminism、Template binding、Local/Remote availabilityとPreflightをfixtureと実catalogで検証 |
| G06 | W06 | 生成/submit不明/停止/interrupt/resume/instance置換/最新Plan再実行、資源lock、SSH trust、課金停止finalizationをmockと実ComfyUIで検証 |
| G07 | W07 | Civitai 429/cache/generation/template、Vast.aiのRENT/start/stop/reboot/destroy、確認・外部結果不明の照合をclient/APIで検証 |
| G08 | W08 | list/search/URL/template/move/delete、server/browser fileのupload/pause/resume/cancel、fingerprint・multipart・staging quota/cleanupを転送integrationで検証 |
| G09 | W09 | EXIF/alpha/crop/codec、gallery/cache、Picker所有権/世代/preview/commit/cancel、server revision、PSD/font、Caption stale、manifest/ZIP、破損状態復元を画像fixture/browserで検証 |
| G10 | W10 | P1の層分離（3.1/3.2）、空dataDirからのbootstrap/Secret新規登録、指定取得元失敗時のerror、CLI env隔離、単一server所有権、新Run停止/復旧を検証 |
| G11 | W11 | build/start、新版の更新手順、API/build ID、Windows/Linuxのローカル実行とmain向けCI設定、全31既存文書の処置を新規配布で検証 |
| G12 | W12 | 全73 test fileの実行経路・処置と新API/E2Eへの接続、実環境未検証項目の記録、画像memory/perf gateを確認 |
| G13 | W13 | 11 schema/Template/targets fileと4 PSD/4 previewの採否、resourceDir解決、独立version/hash、repository外cwdからの起動をpackage fixtureで検証 |
| G14 | W14 | 12旧実装候補の動的/test/store参照確認、互換loader/bridge/移行処理/fallbackとElectron依存の撤去、旧形式拒否を依存走査とclean installで検証 |

### 6.2 既存testの実行経路

P0時点の73 test fileをCI-conditional 2、CI-only 2、npm-test 61、standalone 5、support 3へ排他的に分類した。当時の未接続standaloneは`assistant-pane.cjs`、`codex-snapshot-race.cjs`、`codex-turn-status.cjs`、`grok-cli-adapter.cjs`、`grok-cli-task-runner.cjs`。P0での実行結果・採否・後続検証は[開始基準と受入チェックリスト](web-migration-baseline-checklist.md)に記録した。追加後のtest母集団とcore-local等の最新分類は調査索引を参照する。新test経路への接続・旧test撤去は対応phaseで行う。CI-onlyとhelperを未登録という理由だけで未検証扱いしない。

`.github/workflows/release-201-performance.yml`はmain向けPRのtest file/workflowのpath変更時だけ発火する。刷新branch向けPRでは実行せず、同等のperformance検証をローカルで実行する。mainへ最終統合する際にWeb版の発火条件を見直す。古いElectron buildの固定baselineを無条件に新Web buildと比較せず、同じ計測条件の新baselineを残す。CI-only/CI-conditionalは現mainの実行経路分類であり、刷新branchで検証を省略する意味ではない。

### 新契約で再検証する業務ルール

既存testは業務ルールとfixtureの参考とする。旧schema・旧Desktop経路の互換性は要求せず、互換読込・自動復旧・fallbackを前提とするtestは新契約へ置換または廃止する。backupの読込は現行schemaに対する明示操作に限定する。

- Artifact検証、Prompt Plan、model選択/reset、compiler、Workflow API graph、atomic JSON/image、journal/backup、caption stale、Marketplace manifest、cache prune。
- Codex/Grok event parser、adapter、workspace、session mismatch、task runner、artifact auto import。
- Local/Remote generation、image hash、partial failure、submit ambiguity、resume、model staging、remote lifecycle/finalization、execution lock。
- Civitai rate limit/catalog、R2 index/transfer、Vast.ai client、SSH key検証。

### 更新・追加する検証

- P1でdomain/applicationからElectron・React・DOM・IPC・HTTP frameworkへの禁止依存を検査する。portのfakeを使い、保存/確定/編集禁止/Run遷移/AI成果物取込をwindow・browser・HTTP serverなしで検証する。実ファイル/CLI/networkを使う検証はadapter integrationへ分ける。
- 新契約に対して、旧schema/不足必須値/取得元不在/codec失敗/font未読込/replay不足が明示errorになることを検証する。別provider/旧store/旧API/別codecへの呼出がないことも検証し、業務ルールの二重実装を残さない。
- `main-process-source.cjs`、`source-match.cjs`を参照する構造testは、新service/APIの実挙動を検証するものへ移す。テキスト一致だけで移行成功としない。
- 多くのtestは`tsconfig.electron.json`と一時`main/`出力を前提にする。server tsconfig/resource fixtureへ更新し、package.jsonに未登録のtestも採否を記録する。
- 全APIの未認証、別Project、別Picker所有者、path traversal、symlink/junction、偽root、Origin/CSRF、body超過、秘密漏えいを確認する。
- 並行send/start/save、二重click、タイムアウト後の再送、event重複/欠落、tab再読込、ネットワーク切断、lease失効、異なる時計のclientで確認する。
- server/CLI/SSH/ComfyUIを途中で終了させ、reconcileまで生成や課金状態を誤認しないこと、同一Promptを再生成しないことを確認する。
- Chromiumで全工程E2Eを必須にする。別端末のFirefox/WebKit相当でもPane・upload/download・Canvas/font・navigationを確認する。
- `image-memory-electron.cjs`とElectron picker benchmarkはserver codec＋browser memory/perf検証に置換する。現在の3584px検証、WebP、EXIF、大画像、preview/commit/cancel、ZIP、cache pruningを引き継ぐ。
- 同一codec/同一fontで決定的な出力はhash比較。browser/font/codec差がある画像は寸法/alpha/EXIF/視覚fixtureの許容差を定義し、全面的なhash一致を無条件に要求しない。
- 実CLIで両providerの認証/start/resume/model/stopを検証し、実ComfyUIの生成・取得も確認する。実Vast.ai/R2の課金・削除を伴う検証は対象・予算を明示して実施する。

## 7. 新規データ・配布・設定

- Project/Artifact/Run/editor/sessionの新schemaと必須値を定義する。旧形式の読込・schema推定・変換は行わない。schema/Template/Manifest/Worker番号は各契約として独立に判断する。
- app設定、catalog、AI store、R2 upload状態、SSH trust、cache、ログは新dataDirで新規作成する。旧userDataや旧Projectを探索しない。旧版と同じdataDirを指定した場合は拒否する。
- 新設定はSecret、実行ユーザー、Project root、実行target、endpoint、resourceを明示登録して検証する。設定不足や無効pathでは開始しない。旧アプリからのexport/import、移行dry-run、移行rollbackは対象外とする。
- runtime resourceは新契約で指定したTemplate/Manifest、Marketplace targets、4 PSD templateを配置する。`default-scene-batch`は旧互換用として採用せず、採用するfamilyを明示する。4 preview PNGは参照assetとして別管理する。指定resourceがない場合はerrorとし、別Templateやcwd探索へ切り替えない。
- package scriptsはWeb/server build/typecheck/test/startへ置換する。run.batはhealth/build ID/lockを確認する。update-releaseは新版の停止・更新・起動・healthを扱い、schema変換や旧版への自動切戻しをしない。
- dev/build API不一致をversion/build IDで検出し、古いtabにreloadを促す。server更新中の長いtaskと未保存editorを無視しない。
- 刷新branchではserver/renderer typecheck、domain/API regression、browser E2E、Windows/Linux codec・path・CLI process検証、resource package検証をローカルで実行する。main向けCIのWeb構成への置換は最終統合時に行う。正常系でElectron/xvfbを要求しない。
- 今回は計画文書のためversionを変更しない。正式リリース準備時に[versioning](../operations/versioning.md)に従いrelease先とtagを確認する。後方互換性を提供しない刷新として0.xのMINOR区分を検討し、アプリ番号はroot package/lockのみ同期する。新schema/validatorの番号は独立に判断し、migrationは実装しない。

## 8. 旧コード候補と未確定事項

静的importで現在のmain/renderer entryから到達しない候補は、codex-app-server/artifact-turn/chat-state/file-artifact/model-selection/thread-history/turn-monitor、grok-artifact-adapter/auto-artifact-watcher/chat-state/navigation-queue/navigation。test・動的参照を確認して旧実装/store参照を削除する。旧履歴の移行・互換読込は作らず、旧アプリの実データも削除しない。

実装開始時の判断項目:

1. 既存Windowsホスト運用を初期targetとすること、LAN公開の範囲。
2. API server/WebSocket、入力schema、browser E2Eの具体的library選定。新しいlibraryの現行仕様と保守状況は選定時に公式情報で確認する。
3. image codecと配布可能font。P1で小さなfixtureによる置換試験を行い、性能・出力差を測定して決定する。
4. 新SecretStoreのOS適合と明示的な取得元。認証・新dataDirの実行ユーザーを決める。
5. editor lease/未送信draftの保存期間、event replay上限、upload staging quota/期限。

工程見積もりはP1/P7の技術検証後に行う。現段階で日数を確約しない。最大の不確定要素は新codec/fontの品質、SecretStoreのOS適合、server強制停止からの新Run復旧である。

## 9. 完全移行の判定

以下をすべて満たしてからElectronを削除する:

- Electron未インストールでbuild/start/testが成功し、src/server/renderer/sharedにruntime Electron importがない。
- Project作成からAI生成、model配置、compile、Local/Remote生成、caption、thumbnail、Marketplace/ZIP、R2操作までWebで完結する。
- 両CLIの会話/history/model/task/stop/resume/成果物、ネットワーク再接続、server再起動復旧が検証済み。
- 権限・秘密保存・path/Picker検証・Run編集禁止・Vast.ai停止/確認契約が維持されている。
- 空dataDirから新Project/Run/session/Secretを作成でき、旧形式/不足値/利用不能経路がerrorになり、互換読込・migration・fallbackがないことを検証済み。
- 全171 IPC定義の処置、73 test fileの継続/置換/廃止理由、旧実装候補の処置が確定している。
- W01–W14/G01–G14の受入証拠が揃い、272 code/config・8 binary asset・31既存仕様文書に未割当/複数主担当がない。再照合toolの`--check`が成功する。
- presentation/application/domain/infrastructureの責務と依存方向が3.1に一致し、業務core単独の検証と禁止依存検査が成功する。Electron互換bridgeと業務ルールの二重実装が残っていない。
- architecture/UI/operations/security/READMEが最終構成に更新されている。現在のActive仕様は実装移行前に既成事実として書き換えない。

## 10. ブランチ・Issue・PRの管理方法

### 10.1 推奨方式

**mainから刷新用の統合branch `codex/web-migration`を一つ作り、Issue単位のPRをそのbranchへ統合する方式**とする。mainは現行版の保守・リリースを担う。刷新branchのPR/pushではCIを実行せず、ローカル検証を必須にする。main向けの既存CIは維持する。

刷新branchへ取り込むPRは小さく保つ。新Web契約と新規dataDirで実装し、旧Electron版のbuild/test/start維持や互換adapterは要求しない。未実装/無効な機能は明示的に利用不可とし、feature flagで旧経路へ切り替えない。旧sourceが一時的に残る場合も新版から到達させず、P9で残存を確認する。技術試験は期限・仮説・判定条件を持つspike branchに置く。

| 管理対象 | 単位・命名 | 役割 |
| --- | --- | --- |
| main | 一つ | 現行版の保守・リリース。刷新完了後の最終PRだけを受け入れる |
| 刷新統合branch | `codex/web-migration` | P0–P9の作業PRとphase受入の統合先。CIなし・ローカル検証必須 |
| 作業branch | `codex/web-p<phase>-<issue番号>-<topic>` | 原則一つの実装Issue・一つのPR。例: `codex/web-p1-123-artifact-usecase`（番号は例示） |
| spike branch | `codex/web-spike-<topic>` | codec/Secret等の検証用。正式実装・受入完了とは区別 |
| Epic Issue | Web完全移行、全体で一つ | 計画・索引へのリンク、P0–P9の達成状況、依存・判断・未確認リスクを集約 |
| milestone | P0–P9 | 時系列のphase受入。W領域と同じ階層の親Issueを重ねない |
| 実装Issue | 一つのレビュー可能な成果 | 主担当Wを一つ、完成phaseを一つ、関連Gと依存Issueを明記 |
| 受入Issue | 各phaseに一つ | 複数PRの統合結果を検証し、そのphaseを完了とする証拠を保持 |
| PR | 原則一実装Issue | 変更・ローカル検証・新契約・禁止経路の撤去をレビュー。刷新branchへsquash merge |

Wは責任分担の分類、Pはmilestone、Gは受入条件とし、それぞれ別軸で管理する。Issueの親子階層をEpic → phase → W → feature → PRと多重化しない。横断Issueでも主担当は一つにし、他のWは依存先/レビュー対象として記載する。

### 10.2 Issueの切り方

「P1全部」「AI移行全部」「main.tsを全部分解」のような大きな実装Issueは避ける。共通契約 → 一つのuse case → adapter接続 → 統合検証の順に切る。各Issueは単独の完了条件と後続が利用できる成果を持ち、変更しない周辺領域も明記する。

初期backlogの例（各項目は一Issue候補。規模に応じて機能単位へ細分化）:

| Phase | 実装Issue候補 | phase受入で確認すること |
| --- | --- | --- |
| P0 | baseline固定と既存変更整理、全IPC/層境界の契約、未接続testの採否 | 計画・索引・実装開始点が一致 |
| P1 | 新command/result/eventとport、Artifact use case切出し、AI use case切出し、Execution policy/復旧切出し | core単独検証とElectron依存の排除 |
| P2 | server bootstrap/lock、認証とscope認可、HTTP契約、job/idempotency、event/snapshot/reconnect | 共通transportとruntime境界が機能する |
| P3 | ProjectRegistryと保存API、Web shell/navigation、editor lease/CAS契約 | 新形式Projectの作成・保存とlease/CAS検証 |
| P4 | 会話・履歴・model API/UI、工程task・成果物、停止/resume/並行開始 | 両providerの実CLI受入 |
| P5 | 新SecretStoreと新規設定、Civitai catalog、R2転送、Vast.ai/確認契約、model/Preflight統合 | 指定経路での外部連携と秘密・確認・転送の契約 |
| P6 | Local生成、Remote生成/SSH、停止と課金finalization、再起動・結果不明の照合 | 実ComfyUI生成と復旧・資源競合 |
| P7 | codecとcache、Picker、PSD/font/editor保存、Caption/Marketplace/ZIP | 画像・後処理・memory/perfの一致 |
| P8 | 新規配布/start/ローカル検証、空dataDirからの登録、旧形式拒否・fallback禁止検証 | 新Web全工程と明示error |
| P9 | 旧code/store参照整理、Electron依存・入口の撤去 | clean installで全gate通過 |

受入Issueは実装Issueをまとめて閉じるための形式的な項目ではない。統合後の検証結果、未確認事項、削除対象の旧sourceを記録する。互換adapterは受け入れない。PRがmergedでもphase受入前にmilestoneを完了扱いしない。

実装Issueには以下を必須記載する:

- 解決する問題と完了後の挙動。
- 主担当W、milestone P、対象file/IPC、関連G。
- 依存Issue（何がmergedになれば着手可能か）。
- 変更する範囲、変更しない範囲、presentation/application/domain/infrastructureの境界。
- 受入条件と検証方法、新Web版の成立条件、旧形式・fallbackの拒否条件。
- 新保存形式・Secret・外部課金への影響、削除する旧実装、新版で使用するport/adapter。

例: `P1: Artifact確定use caseをElectron IPCから分離`は、W03が主担当、G03/G10が受入条件。新command/port Issueに依存し、業務coreへElectron型を渡さず、fake repositoryで新契約を検証する。旧IPCへの再接続、HTTP実装、全Artifact UI変更はこのIssueに含めない。

### 10.3 branchとPRの運用

1. 依存PRを刷新branchへ取り込んだ後、その刷新branchから次の作業branchを作る。PRのbaseは`codex/web-migration`とする。独立したIssueは別branchで進められるが、main.ts、shared/types、API契約、package/lockの同時編集は事前に分担する。
2. PRは小さく、初期は契約と一機能の縦方向の接続を優先する。巨大なfile移動・整形・機能変更を同じPRへ入れない。CI設定やcodecのような横断変更は先に独立PRへ切る。
3. branch間の直接依存は例外とする。必要な場合は親PRとbaseを明記したdraft PRにし、親のsquash後に最新刷新branchへ差分を載せ直して重複commit/変更を除き、ローカル検証とdiffを再確認する。刷新branchから独立して取り込める形になるまでmergeしない。
4. PR本文は問題・結果・関連Issue・W/P/G・検証結果・新契約・旧経路撤去・明示errorを記載する。未検証gateを「確認済み」としない。
5. 最新刷新branchに対して取り込む差分を確認し、対象commitのローカル検証が成功してからsquash mergeする。CI成功を条件にしない。CLI利用時は`gh pr merge <番号> --squash`。merge commit/rebase mergeは使わない。
6. merge後はbranchを整理し、Issueの証拠リンクとEpic/phase受入状況を更新する。PRのsquash commitとIssueを辿れるようにする。

未完成Web入口の追加PRでも、新core単独test、禁止依存/互換loader/fallback経路の検査、変更したAPIのintegrationをローカルで必須とする。Web E2Eが利用可能になった段階から対象機能のE2Eもローカルで実行する。各phase受入では刷新branchの統合済みcommitに対して新契約の全体回帰/buildを実行する。旧Desktop専用testの成功は必須にしない。

PRの検証欄にはcommit SHA、OS/Node/CLI等の環境、実行command、結果、logの場所、未実施項目と理由を残す。差分や依存が変わった場合は影響する検証を再実行する。Windowsだけで実行した結果をLinux確認済みとはしない。CIを使わないことをtest省略として扱わない。

CI設定はpush/PRともmainのみを対象とする。refresh向けPRにrequired status checkを設定しない。現在のbranch protection設定は未確認であり、実装開始時に確認する。CI実行・保護設定は別物なので、workflowを止めても必須checkが残る場合は刷新branchにだけ適用を外す。

進捗はIssueの`Backlog / Ready / In progress / Review / Done`と依存関係で管理する。`Blocked`は独立状態または属性で明示し、Readyには受入条件・依存・担当が決まったIssueだけを置く。主担当あたり実装中は原則一つとし、共通契約が未確定の状態で多数の枝を作らない。labelを使う場合は`web-migration`、`area:Wxx`、`type:implementation/acceptance/spike`、`risk:data/secret/runtime`に絞り、milestoneと同じphase labelを重複管理しない。

### 10.4 baseline・リリース・戻し方

刷新統合branch `codex/web-migration` は最新公開済みmainから作成済み。計画・索引は刷新branch向けの独立PRとして整理する。元の作業ツリーの既存Codex修正は破棄せず、旧P1原型はユーザー指示により破棄し、後続の独立Issue/PRで必要な差分を選別する。旧commitだけを新版の起点にしない。

mainの必要な業務修正は同期専用Issue/PRで新契約へ適合するものだけ刷新branchへ選別して取り込む。旧互換/fallback実装は取り込まない。元PR/commitを記録しローカル回帰を実行する。全phaseと新規導入・旧形式拒否の受入後、刷新branchからmainへ最終PRを出しsquash mergeする。その最終PRはmain向けCIの対象で、旧Desktop専用checkを新Web checkへ置換する。

通常実装の各PRではアプリversionを増やさない。phase完了と公開releaseは別に管理する。公開準備が明示された時点で最新main/tagを確認し、リリース全体へ一度だけ付番する。P9の切替は新schema/Secret登録/新規dataDirの受入後に公開し、旧データ移行は提供しない旨を明記する。

コードのrevertや緊急修正は独立Issue/PRで管理し、mainの履歴をforce pushで書き換えない。revert後に新dataDir/schemaが利用不能なら明示的に停止し、自動変換・旧版への自動切戻し・別store採用は行わない。旧版とのデータrollback手順は提供しない。

今回の成果は刷新統合branchの作成、main限定のCI制御、公開版を基準とする計画・調査索引の整理。Web実装、旧データ移行、アプリversion更新は行っていない。

## 11. 開始記録（2026-10-06）

- `codex/web-migration`を公開済みv0.82.0から作成し、リモートへ公開した。
- [PR #301](https://github.com/dommyttdev2/comfyui-batch-studio/pull/301)を刷新branchへsquash mergeし、push/PRの自動CIをmain限定にした。mainのMarkdown除外設定は維持する。
- GitHubのbranch rules照会は非公開repositoryのプラン制約でHTTP 403になり、required checkの有無はAPIでは確認できなかった。PR #301はチェック待ちなしでmerge可能だった。保護設定の変更は行っていない。
- 旧調査とCLI修正は元の作業ツリーに保持されている。旧P1原型はユーザー指示により破棄した。P1は計画と新契約の確定後に改めて実装する。
- Docker/Linux検証環境はv0.82.0に含まれる既存基盤として使用する。過去の別作業ツリーの検証成功を、新baselineの実装受入へ流用しない。
- P0の索引再照合、未接続testの採否、UI/画像/Run/AIの受入checklistを[開始基準と受入チェックリスト](web-migration-baseline-checklist.md)へ整理した。P1の層分離・core単独検証は[業務coreの境界と受入](web-migration-core-design.md)へ記録した。Web機能受入は各後続phaseで行う。


## 12. P2完了と次工程（2026-10-08）

P1は親Issue #305 / PR #309が完了し、刷新branchのf221c1799a668e757e6f4de141100588c2547a6bに統合済み。[P2親Issue #313](https://github.com/dommyttdev2/comfyui-batch-studio/issues/313)のserver基盤は実装・ローカル受入を完了した。ブランチ・子Issue・依存・受入条件は[P2実行計画](web-migration-p2-plan.md)を参照する。親PR #323は刷新branch向け。次はP3のProject/ArtifactとWeb shellを進める。運用契約は[Web server foundation](../architecture/web-server-foundation.md)を参照する。

## 13. P3着手管理（2026-10-08）

P2はPR #323で刷新branchの053cd134920a573179bb99072545b3cd977f0021にsquash統合済み。P3親Issue [#334](https://github.com/dommyttdev2/comfyui-batch-studio/issues/334)と子Issue #335–#343を起票し、codex/web-p3-334-project-workspaceから刷新branch向け親draft PRを作成する。責務・依存と受入は[P3実行計画](web-migration-p3-plan.md)に一本化する。P3はProject/Artifact/Compiler fixture・画面内タブ・共通Modal Hostを実装し、Windows/Linux/Chromiumのローカル受入を完了した。次はP4の実CLI会話/task。詳細と残るphase境界は[P3受入](../quality/web-p3-acceptance.md)、[運用](../operations/web-workspace.md)を参照する。
