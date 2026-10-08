# Web server foundation (P2)

Status: Accepted。P2の実装・運用契約の正本。全体範囲は[移行計画](../roadmap/web-migration-plan.md)、受入は[P2計画](../roadmap/web-migration-p2-plan.md)を参照する。

## 実装境界

src/serverはHTTP/WS・認証・永続化・所有権・compositionを担当し、src/applicationとsrc/domainの新契約を呼ぶ。Electron、preload、renderer、React、DOMをimportしない。build:serverはcore/server双方の依存境界を検査して独立コンパイルする。旧IPCへの互換経路・fallback・旧schemaの読み替えは存在しない。

createServerRuntime(config, { commands, definitions, shutdownMs })が後続phaseの接続点。CommandControllerはpermission・validation・core呼出しを持ち、JobDefinitionはvalidate/reserve/runと必要に応じinterrupt/reconcileを提供する。ProjectRegistryはbackendがcanonical rootを登録・解決するサービスであり、クライアントから任意rootを受け取る公開routeではない。実Project操作はP3、実CLIはP4、外部連携はP5、生成runtimeはP6で登録する。通常entryのcommands/definitionsは空で、未登録機能は501となる。Web UIや製品全機能の利用開始を意味しない。

## 起動・設定

Node.jsとnpm依存関係を用意し、次の順で実行する。

1. npm ci、npm run build:server。
2. BATCH_STUDIO_DATA_DIRを専用の絶対pathに設定する。
3. BATCH_STUDIO_ADMIN_TOKENに暗号学的乱数の32〜128文字（英数字、_、-）を設定する。必要なProject IDをBATCH_STUDIO_PROJECT_IDSにカンマ区切りで指定し、npm run init:server-authを一度実行する。
4. 初期化後はBATCH_STUDIO_ADMIN_TOKENを環境から除去し、npm run start:serverを実行する。

initはauth.jsonを排他作成し、tokenのSHA-256だけを保存する。既存ファイルは上書きしない。起動時の認証元はdataDir/auth.jsonのみで、環境変数や旧credential storeへfallbackしない。初期principalはoperator、read/edit/execute/admin権限を持つが、Project許可は指定IDだけ。空のProject許可が全Project許可になることはない。OS権限でdataDirとauth.jsonを保護する。POSIXではauth.jsonの0600を検証する。

BATCH_STUDIO_HOSTは127.0.0.1または::1のみ、BATCH_STUDIO_PORTは既定3210（0はOSによる割当）。LAN公開・TLS終端はP2対象外。BATCH_STUDIO_RESOURCE_DIRを指定する場合は絶対pathとし、schemas/templatesを含める。未指定時はコンパイル済みmodule位置からrepository resource rootを解決し、cwdに依存しない。build IDはserver/core/resource/lockfileの内容から生成し、API versionは1。

## HTTP / WebSocket契約

| 入口 | 契約 |
| --- | --- |
| GET /api/v1/health | 公開health/readiness、apiVersion/buildId。path/secretを返さない |
| POST /api/v1/session | Authorization: Bearer token、JSON {}。HttpOnly/SameSite=Strict cookieとcsrfToken/権限/期限を返す |
| POST /api/v1/projects/:id/commands/:action | 登録controllerのみ。Project scope、permission、validationの後にcoreを呼ぶ。mutation controllerはexpectedRevision/leaseIdを要求 |
| POST /api/v1/projects/:id/jobs/:kind | 登録jobのみ。Idempotency-Key、JSON {input, stage, provider, turnId}。永続予約後202/job DTO |
| GET /api/v1/jobs、GET /api/v1/jobs/:id | 認可範囲内のpublic job DTO |
| POST /api/v1/jobs/:id/cancel | execute権限。明示cancel要求。request切断はcancelにならない |
| POST /api/v1/jobs/:id/reconcile | admin権限、uncertain jobに登録adapterで外部状態を照合。job単位で同時照合を一本化 |
| POST /api/v1/admin/shutdown | admin権限、JSON {mode: drain / stop / force}。202後に終了 |
| WS /api/v1/events?projectId=ID&after=N | 同じcookie、厳密Origin、subprotocol batch.v1.<buildId>。projectIdは複数指定可能。afterは省略可 |

health以外のHTTPはX-Batch-Api-Version: 1、X-Batch-Build-Idを要求する。認証済みrouteはX-Request-Idも要求し、mutationには正確なOriginとX-CSRF-Tokenを要求する。session作成にも正確なOriginが必要。Hostは待受originと一致させる。異なるbuildは409で明示拒否する。JSONはUTF-8で最大64KiB、loginは4KiB、unknown fieldを拒否する。HTTP errorは正規化code/requestIdで返し、内部exceptionやstackを返さない。

sessionはmemory上の30分期限。auth.jsonを各認証で読み直し、principal変更時は既存sessionを失効させる。再起動後は再認証する。cookie資格情報とjob/eventの公開sessionIdは別の値であり、cookieをDTOに含めない。loginはIP単位の試行上限とsession数上限を持つ。

eventは認可済みsnapshot、単調増加seq、job.changedの順序契約を持つ。永続journalは既定512件、最大4096件。snapshot取得と購読境界に隙間を作らない。履歴不足/不正cursorはREPLAY_UNAVAILABLEとして接続を終了し、自動snapshot fallbackしない。WSはcommandを受け付けず、再認可・heartbeat・接続上限・送信256KiB上限を持つ。切断してもjobは継続する。

## 永続化・所有権・再起動

dataDirにはauth.json、projects.json、jobs.json、events.jsonとserver.lockを置く。JSONは一時fileの排他作成・file fsync・atomic renameで書き換え、POSIXでは親directoryもfsyncする。Windowsはfile flushとrenameを行う。schema不一致・破損は拒否する。

server.lockはmkdirによる単一起動lock。Project rootはrealpathでcanonical化し、同一rootの別名を同じProjectにする。Project lockはroot内、Local endpoint/Vast.ai資源lockは同じOS accountのhome内共有namespaceで保持し、別dataDirから同じ資源を取得させない。OS account/hostを跨ぐ分散lockは対象外。Local endpointはlocalhost/IPv4/IPv6 loopback aliasとdefault port等を正規化する。

jobはuser/Project/kind/idempotency keyとinput hashで予約する。同じkey/inputは同じjob、同じkeyのinput変更は409。予約の永続化失敗時は外部副作用を開始せず、新規受付も停止する。結果不明はuncertainとして資源lockを保持する。再起動時に実行中記録をuncertainへ移し、自動再送・自動実行・自動lock削除をしない。起動時は永続jobの現在状態をjournalにも発行してjob/event保存境界を整合させる。

終了は受付停止→job drain→event/HTTP終了→server lock解放。通常期限は5秒、stopはabort要求、forceまたは期限超過はuncertainを永続化してinterrupt hookを呼ぶ。強制終了後の遅延completion/progress/reconcile結果は確定状態を上書きしない。永続化やinterruptを確認できない場合はserver lockも保持する。切断済みrequestのhandlerもdrain対象とし、HTTP処理の期限超過でもserver lockを保持して再起動競合を拒否する。uncertainな外部資源lockはserverの正常終了でも解放しない。

異常終了後はBATCH_STUDIO_DATA_DIRを設定してnpm run recover:server-lockを明示実行する。同じhostのowner PIDが死亡していると確認できたserver lockだけを回収し、生存/不明ownerは拒否する。jobと外部資源の復旧は別途adapterの照合が必要。Ownership.releaseVerifiedはtrusted backend adapterの検証を必須とし、クライアント申告だけでは解放しない。

## 検証範囲

WindowsとDocker/LinuxでHTTP、実WS、永続予約、scope隔離、auth変更/期限、競合、異常入力、保存障害、終了、実Node子processのcrash/restart/lock回収を検証する。P1 use caseへのHTTP接続と外部portのfakeを使い、Electronなしのserver起動を確認する。停電時のfilesystem耐久性、別OS account/別hostでの共有資源排他、実CLI・外部生成・製品UIの受入はこの検証に含めない。
