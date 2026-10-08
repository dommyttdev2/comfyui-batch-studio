# 新Web外部連携の設定

P5作業中。契約は[web-integrations](../contracts/web-integrations.md)。旧Electronの設定は読み込まない。serverを停止して管理者CLIで新規登録する。

## 明示設定元

BATCH_STUDIO_DATA_DIRは独立Webの既存data directory。BATCH_STUDIO_SECRET_SOURCEにenvironmentまたはvaultを必ず指定し、BATCH_STUDIO_INTEGRATION_PROVIDERSにcivitai,r2,vastの使用providerをカンマ区切りで指定する。Secret値をコマンド引数やログに書かず、管理者が環境変数を設定したprocessでnpm run init:server-integrationsを実行する。既存登録は上書きできず、稼働serverのleaseがあると登録を拒否する。

- Civitai: BATCH_STUDIO_SECRET_CIVITAI_API_KEY。
- R2: BATCH_STUDIO_R2_ACCOUNT（32桁小文字hex）、BATCH_STUDIO_SECRET_R2_ACCESS_KEY_ID、BATCH_STUDIO_SECRET_R2_SECRET_ACCESS_KEY。公開URLを使う場合はBATCH_STUDIO_R2_PUBLIC_URLをHTTPSで明示する。
- Vast: BATCH_STUDIO_SECRET_VAST_API_KEY。
- vault: BATCH_STUDIO_VAULT_KEYに管理者が生成した32byte鍵を64桁小文字hexで指定する。鍵をGit/store/会話へ保存しない。server起動時も同じ鍵を管理者のSecret管理から環境に注入する。

environmentは固定名の変数だけを実行時参照する。vaultは初回指定SecretをAES-256-GCMで暗号化してintegrations.jsonに保存し、以後のSecret更新はadmin設定APIを使う。sourceを自動切替しない。vaultのprovider credential環境変数は初回登録後に削除してよいがmaster keyはserver実行に必要。鍵を紛失すると暗号文を復号できないため、管理者のSecret管理で鍵の保管・復旧を行う。

## 公開設定API

GET /api/v1/integrations/settingsはread/admin権限で、設定有無・global revision・provider状態・provider revision・R2 account/public URL・操作権限のみ返す。Secret値、暗号文、鍵元、物理pathは返さない。readyは設定を解決できる状態で、サービスとの疎通成功を意味しない。

POSTはadmin、session、Origin/CSRF/buildが必要。bodyはprovider、expectedRevision、settingsのみ。settingsはenabledとR2 account/publicUrl、vaultで新規登録/更新する場合だけsecretsを含む。expectedRevisionはGETで取得したglobal revision。環境元へのSecret書込、任意endpoint/URL/role、確認booleanは拒否する。競合時は現在設定を取得して利用者が再確認する。

未登録はunconfigured、無効設定はdisabled、指定Secret/鍵不足・暗号文不一致はunavailable。未知schema/壊れた登録はserver起動を拒否する。旧Secret、別環境変数、平文、fixtureで復旧しない。CLIのDocker subprocessは固定のOS環境変数だけを渡し、統合Secretやmaster keyを継承しない。

実Civitai/R2/Vast、SSHと転送の操作・受入は後続P5子Issueで接続する。この設定実装だけでP5受入完了とは扱わない。

## 外部操作の確認・receipt

POST /api/v1/integrations/operations/prepareはoperation/targetIdと任意のProject binding（projectId/expectedRevision/leaseId）を受け、server取得factsのsummary、単回confirmationId、60秒のexpiresAtを返す。global管理はadmin、Project bindingはadminに加えてProject edit grant・current revision・owned leaseが必要。confirmはoperation/targetId/confirmationIdだけを受ける。boolean confirmedを受け取らない。

confirmは同user/sessionと対象・世代・期限を再確認し、token消費とreceipt予約を同じatomic storeに保存する。返却は202とreceipt id。GET /api/v1/integrations/operations/receipts/:idで同ownerだけが追跡する。異なるsessionのtoken利用と消費済みtokenの再確認を拒否する。Project receiptの閲覧には現在のread grantも必要。

応答消失/外部例外/再起動でreserved/runningだった操作はuncertainになる。同scopeで別の操作を予約できず、外部APIを自動再送しない。POST /api/v1/integrations/operations/reconcile/:idは対応するread-only照合portがある場合だけ実行できる。結果不明なら引き続きuncertain。料金が発生した可能性があるRENTを照合できないまま再実行しない。

storeは4MiB・1000confirmation・1000receiptを上限とする。期限切れ未消費tokenのみ新規prepare時に除去する。結果とconfirmationの関連を維持し、上限到達時は拒否する。停止時は新規予約を拒否して実行/照合をdrainし、期限超過はuncertainとfenceを保存してserver filesystem ownershipを保持する。遅延応答で成功へ書き換えない。旧形式・重複id/scope・壊れたbindingは読み込まない。

サービス別inspect/execute/reconcileは子Issueで接続する。未接続operationはINTEGRATION_UNAVAILABLEを返す。

## Civitai catalog

新Web専用のcivitai.jsonはweb-civitai/1とsource fingerprintで設定・資格情報世代を束ねる。環境Secretの差替もcache/catalogを無効化する。catalog generationは公開成功ごとに単調増加する。未登録/無効providerはcatalogなし、登録済みのSecret不備は利用不可と区別する。production起動はこのrepositoryを使う。明示catalogFileはローカルfixture受入用の注入で、自動切替先ではない。

同期はPOST /api/v1/integrations/civitai/syncにprojectIdを明示し、Idempotency-Keyを付ける。adminと当該Project execute grantを要求し、Projectをjobの観測元とする。catalog自体はserverの共有resourceでProject本文を変更しない。Projectを跨いでも同時同期は一つ。GET status/catalog/search?query=/collections/models/:id/versions/:idで設定状態・可視job・現行catalog・検索・詳細を取得する。検索は同期済みcatalogを対象にする。

Civitai endpointはcivitai.comとcivitai.redの固定先。redirectを追わず、SecretはAuthorization headerのみ。429はRetry-Afterを扱い、最大3retry・要求全体20秒・response4MiB、collection1000page/32MiB、cache/store32MiBとする。collection API形式変更・cursor反復・期限/容量超過は失敗する。外部レスポンスにcredentialが含まれる場合は保存・公開を拒否する。cacheは30分の有効期限内だけ使用し、expired cacheを失敗時に返さない。現在のcredential世代を再確認してcache/catalogをatomic公開する。中断/restartで同期を自動再開しない。

公開APIの現行正本は[Civitai developer reference](https://developer.civitai.com/site/reference)、collection手順は[公式router](https://github.com/civitai/civitai/blob/main/src/server/routers/collection.router.ts)と[公式schema](https://github.com/civitai/civitai/blob/main/src/server/schema/collection.schema.ts)で照合した。実設定の疎通/catalog受入は #385、画面操作は #384で追跡する。

## browser stagingとserver file（P5-6）

POST /api/v1/resources/stagingでname/sizeと任意のprojectId/sha256を指定する。Project scopeはexecute grant、global scopeはadminを要求する。返却resource idだけで操作し、nameは表示名として扱う。PUT /resources/staging/:idはapplication/octet-stream、Content-Length、X-Upload-Offset、X-Upload-Sha256を要求し、通常APIと同じsession/Origin/CSRF/build検証を通る。8MiB以下のchunkをstreamingし、fsync・metadata保存後のoffsetを返す。chunk hash不一致・切断時は未確定tailをtruncateする。再起動もdurable offsetを超えたtailだけを破棄する。

completeは全体を1MiB単位でhash計算しsize・stat・指定hashを検証する。上限はresource100GiB、全体200GiB、128resource、metadata64KiB、期限24時間。resourceをjobへpinすると削除を拒否し、再起動でもpinを保持する。unknown jobのpinを自動解除しない。expired resourceはownerの明示deleteでcleanupする。ブラウザはpath・argv・Secretを指定しない。

管理者がserverを停止し、BATCH_STUDIO_FILE_ID、BATCH_STUDIO_FILE_ROOT、BATCH_STUDIO_FILE_PATH、BATCH_STUDIO_FILE_PROJECTS（許可Project idのカンマ区切り）を明示してnpm run init:server-fileを実行する。dataDir外の許可root/実fileだけを登録し、現在のsize/stat/SHA-256をstreaming計算する。files.jsonはweb-files/1、128resource、128KiB。既存resource idの上書き・旧storeの読替は行わない。GET /resources/filesは許可Projectのresource id/name/size/hashだけ返す。転送時はgrant・realpath・hard link/statを再確認する。R2への転送接続とfull source再検証は #381。

## Vast.aiとSSH（P5-8）

Vast APIはconsole.vast.aiだけを使い、現行v1 instances paginationとv0 templates/bundles/instance lifecycleへ接続する。Authorization headerにのみSecretを渡し、redirect、alternate endpoint、pending instance補完、旧設定を使わない。要求全体20秒、response4MiB、一覧100pageを上限とし、変更操作をretryしない。P1 offer use case/観測policyを共用し、新Webは現行id/actual_status/portsを検証する。

GET /integrations/vast/status|instances|template、POST search/targetsを提供する。RENT targetはoffer/template/disk/price、instance targetはid/state/設定世代をimmutableに保存する。外部操作は共通prepare/confirm/receiptを使う。料金・状態・資格情報変更とoperationの取り違えを拒否する。RENT応答消失はuncertainを維持し、別offerのRENTも拒否する。RENT/rebootを一覧状態から成功と推測しない。start/stopは目的状態、destroyはinstance不在だけをread-only照合する。

管理者が停止中serverでBATCH_STUDIO_SSH_ID、BATCH_STUDIO_SSH_ROOT、BATCH_STUDIO_SSH_PRIVATE_FILE、BATCH_STUDIO_SSH_PUBLIC_FILE、BATCH_STUDIO_SSH_USER、BATCH_STUDIO_SSH_DIRECTORYを明示し、npm run init:server-sshで新しいresourceを登録する。SSH鍵を自動探索しない。独立Web dataDir外のcanonical root/file、最大64KiB、matching pairとhashを検証する。Unix秘密鍵は0600相当を要求し、serverのCLI containerへ渡さない。公開APIはresource id/user/remote directoryだけを返す。

POST /integrations/ssh/targetsは実running instanceと登録key idから認証前のhost keyをprobeする。DNSと鍵交換は各10秒以内、loopback/private networkを拒否し、解決済みIPへ接続する。prepareはendpoint/fingerprint/以前のfingerprint/public-key hashを束ねる。trust-sshのconfirm後にVastへの公開鍵登録とtrustのatomic保存を行う。鍵変更、設定変更、公開鍵登録の未知結果は無条件再送しない。POST endpointは現在のhost fingerprint/登録鍵/公開鍵provision状態とP1 SSH endpoint policyを再検証し、秘密鍵pathを返さない。生成・remote commandはP6。

現行endpointは[Vast公式CLI](https://github.com/vast-ai/vast-cli/blob/master/vast.py)と[公式REST案内](https://vast.ai/developers/api)で照合した。fixtureの管理/確認/未知結果とnative ssh2鍵交換は子Issue #382、実account/SSH hostへの接続は #385、画面操作は #384の受入対象。

## R2管理API（P5-5）

S3 clientは登録accountの固定HTTPS endpoint・region autoを使用する。資格情報は新Webの指定元だけから取得し、SDKの自動retryは1attemptに固定する。外部変更操作で応答が消失した場合、無条件再送しない。[現行S3互換表](https://developers.cloudflare.com/r2/api/s3/api/)でListObjectsV2、CopyObject、multipart/ListParts等を照合した。

GET /api/v1/integrations/r2/status/buckets/list/search/metadata/templates/metrics/download、POST index/targets/download-info/batch-download-info/put-url-info/save-template/delete-templateを提供する。bucket/key/query等は各操作の固定fieldsのみ。検索はP1 index policyを使い、同期前/資格情報世代変更後はR2_INDEX_UNAVAILABLE。binary downloadは認可付きstream、URLは期限付き。R2新storeはweb-r2/1、32MiB、bucket1000、bucket当たりobject100000、target1000を上限とし、旧indexを読み込まない。template更新はcurrent revisionのCAS。

targetsは管理者がoperation/bucket/keys/destinationを指定してserver側idを作成する。共通prepare/confirmへtargetIdを渡し、現在のobject etag/size、空bucket、既存destinationと資格情報世代を再確認する。未知結果の排他scopeはaccount/bucketで固定し、Secret差替で迂回できない。streaming move応答消失時は元objectを削除せずuncertainとする。copyはsourceを保持し、moveとobject削除はIf-Matchを要求し、失敗時に条件を除いて再送しない。条件付きdeleteは確認receipt専用の1byte objectを作り、誤ったIf-Matchが412で拒否され、objectが保持されることを検証してから対象を変更する。条件が無視・拒否された場合は対象変更を行わず、未知結果を保持する。probeの応答喪失で内部objectが残る可能性はread-only照合に持ち越す。予約済み内部prefix .batch-studio/ をUI/API対象から除外し、内部objectが残ったbucketの削除を空bucketとして扱わない。bucket作成/削除の結果不明は、存在だけで実施者を断定せずunknownを保持する。

moveはGetObject If-MatchとPutObject If-None-Matchによる64KiB単位のstreamingとlength検証を使い、移動先の競合書込みを上書きしない。receipt/source etag/sizeのmetadataを保存し、移動先を検証してから条件付きsource deleteを行う。現時点では5GiBを超えるobjectをMULTIPART_MOVE_REQUIREDとして拒否する。巨大objectとupload/pause/resume/cancelは #381 のmultipart jobへ接続する。browser staging・server fileの登録は #380、Modalは #384。これらが未完了の間、P5完了とは扱わない。

## Multipart転送

新Webの転送元は完成済みstaging IDまたは明示登録済みserver file IDを指定する。Projectのrevision/leaseに束ねたupload-object確認後にreceiptとjobを保存し、stagingをpinする。Partは最大16MiB、uploadの並列数は3、同時未確定uploadは3件まで。元fileは全体SHA-256、Part SHA-256、file identityで検証する。physical path、multipart ID、Secretを公開しない。

GET /api/v1/integrations/r2/transfers、POST /targets、POST /:id/pause|resume|cancel|reconcileを使う。再開はbinding（projectId/expectedRevision/leaseId）が必要。再起動後はuncertainとし自動再送しない。応答不明のPartはListPartsと保存MD5/sizeで受理済みを証明してから明示再開する。受理されていないという推測で再送しない。完成応答不明はreceipt metadataとsize/SHAをHeadで照合する。

copy/move targetは明示的なprojectIdと確認bindingを必須とする。5GiB超はr2-object-copy jobで16MiBのGetObject IfMatch Range→UploadPartを行う。UploadPartCopyの条件を省略する経路は持たない。完成IfNoneMatchと削除IfMatchはreceipt専用の一時objectで事前検証し、非対応なら対象に書き込まない。移動元はコピー先のreceipt/ETag/size証明後だけ条件付き削除する。大きなcopy/moveの中断・応答不明は保持し、自動abort/再実行/再開しない。照合は読取のみ。

Windowsの保存は同一のfsync済み一時fileのatomic renameが一時的なread lockで拒否された場合だけ、最大6回の限定再試行を行う。確定fileを削除したり外部操作を繰り返したりしない。保存故障はuncertainとして保持する。

P5-7検証: Windows/Linux(Docker、network none)で連携61件、server18件、core102件を通過。Windowsではagents16件とElectron TypeScript検査も通過。新規転送11件にはPart受理後応答消失、完成応答消失、条件無視、pause/resume/cancel、再起動、source変更、Project bindingを含む。実R2条件互換性と実サービス受入はP5-11に残る。
