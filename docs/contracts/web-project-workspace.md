# Web Project・Workspace・保存イベント契約

Status: Decided / P3実装契約（#335）。契約確定と実装受入を区別する。実装・検証は#336–#343。P2起点は053cd134920a573179bb99072545b3cd977f0021。実行管理は[P3計画](../roadmap/web-migration-p3-plan.md)、UI配置は[Workspace計画](../roadmap/web-workspace-tabs-plan.md)。本書は新Web経路の契約の正本であり、後方互換・旧schema変換・fallbackを提供しない。

## 1. 識別子・所有者・依存方向

| 識別子/状態 | 所有・発行 | 境界 |
| --- | --- | --- |
| userId / sessionId | server認証。sessionIdは公開ID | cookie資格情報とは別。clientのrole入力を採用しない |
| requestId | clientが送信、serverが検証 | tracingのみ。認可や再送dedupの鍵として使わない |
| projectId / rootId / assetId | server登録サービス | opaque ID。任意pathをprojectIdにしない |
| revision | Project transaction | 非負safe integer。全Project更新で単調増加 |
| leaseId | core IdSource | user/session/Projectとserver expiryに結び付く |
| operationId | clientのUUID、serverが予約・検証 | Project操作再送の意味identity。requestIdとは別 |
| tabId / tabGeneration | Workspace store | tab再Openごとに新世代。認可根拠にしない |
| modalSessionId / generation | Modal Host | 起点Project/slot/lease/revision/目的と固定 |
| eventId / sequence | Project commit / EventBroker | eventIdは配信dedup、sequenceは接続replay。revisionとは別 |

presentationはapplicationをAPI経由で呼ぶ。application/domainはHTTP/WS/React/DOM/Electronをimportしない。server adapterはpath/bytes/atomic保存を扱い、Artifact検証・stale・compileの判断を再実装しない。

## 2. root登録・作成・認可

rootのallowlistはdataDir内の新形式web-project-roots/1。管理者がserver側CLIでabsolute rootを明示登録し、realpath/OS大小文字を確定する。一般browser clientに任意root探索・登録APIを提供しない。GET /api/v1/project-rootsはadminだけがrootId/displayNameを取得でき、absolute pathを返さない。

POST /api/v1/projectsはadmin権限で{rootId, directoryName, displayName}を受ける。directoryNameは1 path segment（1〜64文字）、dot/dotdot、separator、NUL、Windows予約名/末尾dot・spaceを拒否する。IDはserverが生成する。作成先は登録root直下の新directoryのみ。既存・不明directoryを勝手に採用しない。既存の新形式Project登録はadmin専用POST /api/v1/projects/registerで{rootId, directoryName}を受け、schema/保存されたID/canonical rootを検証する。旧Project探索・読替はしない。

新規IDへの事前grantを要求する循環は作らない。admin bootstrap権限を認証境界で確認し、作成coordinatorが作成者userIdへのProject grantとregistry公開を管理する。一般のauthorize(actor, projectId, permission)を未登録IDで無条件迂回する処理は用意しない。

root/Project作成coordinatorは単一dataDir lock下で、operationId・input hash・割当ID・対象canonical path・前後grant・状態を新形式provisioning journalに永続予約する。Projectを排他作成→grantをauth.jsonにatomic保存→registryをactiveとして公開→receipt commitの順。未完了Projectは一覧/Open/編集へ公開しない。authとregistryの複数file renameを1回のatomic commitと呼ばない。restartでは未完了intentを検証して同一IDの残り処理だけ完遂し、不明root/hash/外部変更なら受付を止めて明示照合を要求する。旧形式migrationや別rootへのfallbackとはしない。無関係なdirectoryをrollbackで削除しない。

auth.json変更はP2 fingerprint失効を維持する。作成receiptにreauthenticationRequiredを返し、UIはdraftを保持して再loginを要求する。session principalを黙って拡張しない。再送receiptは認証userが一致するときだけ返す。付与失敗・公開失敗では作成成功を返さない。

GET /api/v1/projectsは認可済みactive Projectの{id, displayName, revision}、GET /api/v1/projects/:idは明示Project IDでpublic stateを返す。同じcanonical rootは既存IDへ統一し、tab重複はIDで防ぐ。root symlink/junction置換をread/write直前に再検証する。UNCは登録時に実filesystemの排他/atomic保存要件を満たす場合だけ許可し、未確認は拒否する。別host/OS accountの分散lockはP3の範囲外。

## 3. DTOと公開操作

P2のAPI version/build ID、cookie、Origin/Host、CSRF、request ID契約を引き継ぐ。unknown field、本文内projectId/root/role、不正UTF-8を拒否する。JSON body上限は64KiBのまま。超過documentは413で明示拒否し、body分割や旧経路へ自動切替しない。後続binary転送は別契約。

ProjectStateはsrc/application/project-ports.tsのweb-project/1。public Project DTOは{id, schema, displayName, revision, artifacts, drafts, lease, runSummaries}に限定する。内部root、auth token、raw CLI history/agentImports、outbox、registry journalを返さない。Artifact.contentはユーザーが編集する文書としてread権限に公開する。画像/Template bytesはasset取得経路を使う。

lease DTOは{ownedByCurrentSession, expiresAt, leaseId?}。leaseIdは所有sessionにのみ返す。expiresAtはserver基準の表示情報であり、client clockで有効性を決めない。runSummariesは公開job/Run metadataのみで、P3で実Run機能を有効化しない。

| API | 入力 / 権限 | adapterから呼ぶcore |
| --- | --- | --- |
| POST /projects/:id/commands/acquire-lease | {} / edit | ProjectUseCases.acquireLease |
| POST /projects/:id/commands/renew-lease | expectedRevision, leaseId / edit | P3でapplication use case追加。同じleaseIdを更新 |
| POST /projects/:id/commands/release-lease | expectedRevision, leaseId / edit | P3でapplication use case追加。ownerだけ解放 |
| POST /projects/:id/commands/begin-edit | expectedRevision, leaseId, key / edit | ProjectUseCases.beginEdit |
| POST /projects/:id/commands/save-draft | expectedRevision, leaseId, key, content / edit | ProjectUseCases.saveDraft |
| POST /projects/:id/commands/confirm-artifact | expectedRevision, leaseId, key / edit | ProjectUseCases.confirm |
| POST /projects/:id/commands/reset-artifact | expectedRevision, leaseId, key, confirmationId / edit | 確認をconsumeしてProjectUseCases.reset |
| POST /projects/:id/commands/reset-stage | expectedRevision, leaseId, scope, confirmationId / edit | 確認をconsumeしてProjectUseCases.resetStage |
| POST /projects/:id/commands/configure-models、replace-models、patch-prompt-plan | mutation envelopeとcoreの対応command field / edit | 同名ProjectUseCases |
| POST /projects/:id/commands/compile-workflow | expectedRevision, leaseId / edit | WorkflowUseCases.compile |
| GET /projects/:id/workflow-status | read | WorkflowUseCases.status |
| GET /projects/:id/assets/:assetId | read、asset scope / binary | 登録asset adapter。加工はP7 |

全pathは/api/v1配下。command一覧はP3対象のみで、key/scope/model構造のvalidationは対応domain型を正本とする。一般UIからraw JSONの任意core methodを呼べる入口は作らない。

P3のreset確認はedit permissionの専用prepare/reset transactionで実装する。確認はuser/session/Project/対象/条件fingerprint/revision/期限に結び付け、commit内で再照合し消費する。P1 ConfirmationUseCasesのoperation一覧はProject Artifact resetを含まずadmin専用なので、既存prepareへ無理にresetを割り当てない。domainの確認規則を再利用し、Project向けoperation/permission/portを#338で明示拡張する。clientのconfirmed flagは使わない。

## 4. lease・CAS・操作再送

lease TTLはP1と同じ60秒、UI更新間隔は20秒。同じsessionの更新はleaseIdを変えない。取得は旧lease失効後または同じownerで行い、他sessionの生存leaseは拒否。lease更新/解放もrevision増加とdomain eventを伴い、他sessionへleaseIdを漏らさない。session失効は更新/書込を拒否し、leaseの自然失効前に別sessionへ強制移譲しない。

UIはProject別のmutation queueでsave/renew/confirm/resetを直列化し、応答revisionを次のexpectedRevisionに使う。lease renewalがrevisionを更新するため、editor draftのbaseRevisionは保存済み内容のrevisionと分けて記録する。jobのrevisionやtab世代をProject CASの代わりに使わない。

操作にはIdempotency-Key: operationIdを必須とする。scopeはuser/Project/operationId、input hashはroute/actionと全semantic input（expectedRevision/leaseIdを含むcanonical JSON）。初回をproject transaction内で予約し、state・domain event・receiptを同じatomic envelopeでcommitする。同じkey/hashは同じreceipt。同じkeyの内容変更は409 OPERATION_KEY_CONFLICT。retry時にも現在の認証/Project権限を確認する。別sessionへのlease資格情報再出力はしない。予約結果不明はOPERATION_UNCERTAINで拒否し、別keyで自動再実行しない。

作成/registerとlease取得もdedup対象。readonly GETは対象外。receiptは原則7日保持し、期間経過後はfull responseを削除してkey/hash/revisionのtombstoneをProject存続中保持する。期限後のkeyは410 OPERATION_EXPIREDで返し、同じkeyを新操作として再利用しない。quota（Project毎100,000予約/tombstone、outbox含むstate envelope最大64MiB）到達は503 STORAGE_LIMITで新規mutationを止める。自動削除で再実行可能にしない。

REVISION_CONFLICT/LEASE_REQUIREDでは、server保存を上書きせずローカルdraftを保持する。UIは取得した最新状態と差分を提示し、利用者が再編集/破棄を決める。clock差やtimeoutだけで成功を判定しない。正常commit後に配信が失敗した場合、保存済みreceiptを返せるがeventDelivery: pendingを明示し、未commitの保存と区別する。

## 5. transaction・outbox・Project event

保存正本は新形式web-project-store/1 envelope。{project: web-project/1, operations, outbox, delivery}を1つのatomic JSONとしてProject配下に保存する。多重fileへstateとeventを別々にcommitしない。schema/所有Project/Artifact/Run/leaseを読み出し時に検証する。書込はP2のfile flush/atomic renameとPOSIX directory fsync、Projectのprocess間ownership lock、CASを組み合わせる。

core ProjectTransaction.commit(expectedRevision, next, DomainEvent)はProject/revision/type/actorを検証し、commit時にeventIdを発行する。P3 Project系domain eventはproject.changedだけで、execution.changed/agent.changedの実接続はP4/P6。browser用eventは{type: project.changed, eventId, sequence, projectId, revision, subjectId, requestId}。文書本文/leaseId/root/秘密をeventに入れない。clientは必要なstateをGETし、競合draftを自動上書きしない。

P2 journalはjob専用web-events/1のため、#337でjob/project discriminated unionを持つweb-events/2へ更新する。既存v1 journalは拒否し、新開発dataDirで起動する。変換・読み替え・自動削除を実装しない。HTTP API versionは1を維持し、build IDで旧clientの接続を拒否する。

配信workerはoutbox順にeventIdをbrokerへ渡し、brokerはjournalとdedup ledgerを同一atomic commitで永続化する。永続append確認後にProject側delivery cursorを進める。append済み・cursor未更新のrestartでも同じeventIdを再発行しない。journal replay evictionとは別に、Project delivery watermarkを確認するまでdedup情報を保持する。故障/容量超過は明示拒否し、eventを捨てない。新起動時はoutboxを照合しstate/snapshot cacheを構築してからreadyにする。

snapshotは{type: snapshot, sequence, jobs, projects:[{id, revision}]}。broker queue内でimmutable Project revision cache、job snapshot、sequenceと購読登録を同じ同期境界で捕捉する。commit済みcacheを反映する操作とevent enqueueを同じ直列境界へ接続し、snapshot後に既知revisionを巻き戻さない。outbox配信中のGETがsnapshotより新しいrevisionを返すことは許可し、clientはProjectごとのmax revisionで重複/遅延invalidationsを無視する。全Projectのsequenceに連番性を要求しない。

after指定は既存replay契約。REPLAY_UNAVAILABLEは接続を終了し、利用者へ再同期操作を提示する。利用者の明示的な再同期は新snapshot購読として開始するが、自動fallbackはしない。1接続のProject集合を変える場合はShellがcursorと対象世代を管理して再購読する。権限失効/401は全編集を停止し、旧cacheを別userへ表示しない。

## 6. asset・Compiler

asset IDはProject登録領域/resource registryへscope付きで解決する。GET直前にread認可、realpathのcontainment、型/size/対象hashを検査する。absolute path、file URI、秘密file、別Project assetを受け付けない。認証cookieを使い、長寿命の無認証URLを発行しない。ETagは内容hash、private cacheとしてscopeを分離する。画像decode・variant生成はP7。

Template/Manifestは登録resourceだけを使う。CatalogRepositoryはP3の明示fixture源1つのみ。不足/無効時はDEPENDENCY_UNAVAILABLEで止め、旧catalog/cwd/別Templateに切り替えない。Workflow graphとprovenanceをProject revision/event/receiptと同一commitに含める。モデルidentity/input変更とresource hashはapplication/WorkflowUseCasesの既存規則で再検証する。

## 7. Workspace・draft・Modal

Workspace storeはtab一覧/順序/選択、Tool UI store、共通API/WSと全job一覧を持つ。Project storeはprojectId/tabGeneration、工程/draft/baseRevision、serverRevision/lease状態、scroll/Pane比率/provider選択を持つ。Assistantの実会話状態はP4から接続する。

flush→state退避→選択/closeをProject別のnavigation transactionで直列実行する。保存失敗/409/lease喪失は起点を維持する。明示破棄はローカルdraftの破棄で、server Artifact resetやjob停止を兼ねない。tab close後もserver jobは継続し、全job一覧から同じProject IDを再Openする。

async requestはprojectId/tabGeneration/operationId/revisionを捕捉する。応答は一致するstoreだけへ適用し、選択tabへ転送しない。閉じたtabへの遅延応答はタブを再生成しない。job metadataはShellで保持する。重い画面は選択tabだけmountし、event/listener/timer/object URLはowner終了時に解放する。

未送信draftはIndexedDBにuserId/Project/schema/key/baseRevision/content/updatedAtで退避する。token/cookie/lease資格情報は保存しない。最大7日・user毎20MiB、容量不足時は明示エラーとし保存済みを偽装しない。期限切れは内容を削除する。logout/別user login/権限取消は該当user/Projectのcacheを消し、session期限のみなら非表示にして再login後の権限確認まで読み出さない。recoveryはserver revision一致の場合だけ復元提案し、不一致は差分/明示破棄にする。再読込で全tabは復元せず、最後の有効Project1件のみOpenする。

主Modalは同時に1件、内部確認dialogは1段。背景inert/focus trap、Escapeは最前面、close後のfocus復帰。Tool UI stateはclose後も保持する。選択用途はmodalSessionId/projectId/slot/revision/leaseId/generationを開始時に固定し、confirm時はserverでも再検証する。cancel/起点close/lease喪失後の結果は拒否し、現在tabへ付け替えない。未登録Civitai/R2/Vast.ai操作は利用不可を明示しfake成功を返さない。

## 8. code対応・未実装差分

| 既存契約/実装 | P3で追加するもの | 所管 |
| --- | --- | --- |
| src/domain/contracts.ts / application/project-ports.ts | 公開DTO、receipt、outbox envelope。domainへtransport型を持ち込まない | #335契約 / #337実装 |
| src/server/ownership.ts ProjectRegistry | root allowlist、作成intent/公開/grant整合、公開list/Open | #336 |
| src/server/security.ts fingerprint失効 | auth grant coordinator、再login receipt。自動session権限拡大なし | #336 |
| application/project-use-cases.ts acquireLease / assertMutation | renew/release、実Repository/CAS、server Clock | #337 |
| ProjectTransaction.commit + DomainEvent | atomic state/receipt/outbox、broker append dedup、Project snapshot | #337 |
| server/events.ts job-only journal | web-events/2、project.changed、watermark/dedup、再認可 | #337 / client #340 |
| application/project-use-cases.ts edit/confirm/reset | controller接続、Project reset確認operation/port | #338 |
| application/workflow-use-cases.ts | fixture Catalog/登録Template/Digest、scope asset | #339 |
| server/http.ts commands / runtime.ts空commands | 公開route登録、operation header/DTO/error、同一origin Web配信 | #336–#340 |
| renderer App/Assistant/StandaloneToolとwindow依存 | 独立Web entry/store、タブ、Modal Host。旧route fallbackなし | #340–#342 |

本書の期限・容量・route・journal変更はP3新仕様。現codeに実装済みとは扱わない。受入ケースとownerは[受入matrix](../quality/web-p3-acceptance.md)。
