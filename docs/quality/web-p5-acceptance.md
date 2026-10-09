# P5受入matrix

Status: 実装完了・ローカル検証済み / 実API読み取りを一部確認 / 総合受入は画面完全実装後（2026-10-09）。親Issue [#374](https://github.com/dommyttdev2/comfyui-batch-studio/issues/374)、親draft PR [#387](https://github.com/dommyttdev2/comfyui-batch-studio/pull/387)。[管理計画](../roadmap/web-migration-p5-plan.md)、[契約](../contracts/web-integrations.md)、[運用](../operations/web-integrations.md)、[全コード索引](../roadmap/web-migration-audit.md)を正本とする。

## 要求・実装・検証の一意対応

| ID | 主責務・Issue | 実装 | ローカル検証 | 実サービス |
| --- | --- | --- | --- | --- |
| A01 | 新規Secret/明示指定元 #375,#376 / W10 | integration-settings/init。environment/vault、AES-GCM、CAS、current schemaのみ | settings8件。metadata-only、指定元/鍵失敗、暗号文改変、旧store拒否、CLI env隔離 PASS | 既存環境変数を明示割当し3 provider ready、Secret非保存確認済み |
| A02 | 確認・durable予約 #377 / W01 | external-operations。owner/session/Project/lease/revision/fingerprint/期限、単回token・receipt | external8件。外部await前保存、scope排他、応答消失・crash・late success、read-only照合 PASS | 実変更操作・確認/取消は画面完全実装後へ繰越 |
| A03 | Civitai取得・同期 #378 / W07 | civitai-client/service、P1 catalog sync/policy。固定endpoint、429、deadline、世代cache、trusted job/event | civitai8件。認証/redirect、body limit/deadline、cursor、cache/credential rotation、catalog原子公開 PASS | 実同期成功（14 Collection・80検索結果、generation 1）、検索HTTP 200。detailの個別証跡は総合受入で記録 |
| A04 | R2 Browser管理 #379 / W08 | r2-service/gateway/conditions、P1 index/template/storage policy。fresh metadata、署名URL、条件付きcopy/move/delete | R212件。ETag/source/destination race、lost response、条件非対応の拒否、template restart、HTTP stream、Index job/grant世代 PASS | 条件付き実APIと選択Bucket未受入 |
| A05 | staging/server file #380 / W08（登録権限はW10） | staging、file-resources/init。8MiB binary、100GiB/resource・200GiB quota、hash/offset/期限/pin/許可resource | staging6件。中断truncate、改変/alias/hardlink/権限/quota/cleanup、worker全体hash・再開UI PASS | 実転送元resource未指定 |
| A06 | multipart/巨大copy job #381 / W08 | P1 r2-transfer-runtime、r2-snapshot-copy、r2-transfers/object-transfers、transfer-source | transfers11件。16MiB parts、並行数3、pause/drain/resume/cancel、ListParts照合、lost accepted part/complete、restart unknown、source改変、snapshot条件range PASS | 実R2 multipart/条件能力未受入 |
| A07 | Vast.ai管理 #382 / W07 | vast-client/service、P1 offer/observation policy。固定endpoint、current instance/quote、確認/unknown | vast/SSH9件。RENT/全lifecycle fixture、changed quote/owner/auth、lost RENT再送禁止、endpoint/size/deadline PASS | API情報取得は利用者確認済み。endpoint別証跡とlifecycleは画面完全実装後へ繰越。有料/破壊操作は具体的対象・承認が必要 |
| A08 | SSH初回信頼 #382 / W10 | ssh-resources/init、P1 endpoint。新規keypair、public endpoint、native handshake、host fingerprint確認 | 上記vast/SSH suite。認証前key exchange、private host拒否、host/credential世代変更、provision/trust保存 PASS | 実host/key target未指定。P6生成commandは未接続 |
| A09 | 実catalog/resource接続 #383 / W05 | resource-bindings、ProjectUseCases、project-resources、P1 model/placement/preflight/compiler | resources7件。canonical catalog、exact Local placement/stat/hash、fresh R2 ETag、Project/grant/世代変更、lease/CAS、remote SSH trust、logical DTO PASS | 実catalog取得確認済み。選択モデルとLocal/R2 snapshotのProject反映は総合受入へ繰越 |
| A10 | 共通Modal #384 / W02 | integration-tools/modal/api、file hash Worker。管理/Project選択、origin・flush・lease、server確認、binary/job/URL | 新Web検証9件（8 Chromium＋SHA契約1）。Civitai base/LoRA、取消/単回confirm、閉じたtoolの遅延応答、Object条件失効、staging fullSHA/改変再開、設定/Secret、list/search cursor、template/PUT PASS | 利用者がAPI情報取得を確認。共通Modalの操作一巡は画面完全実装後へ繰越 |
| A11 | 回帰・OS/CLI隔離 #385 / W12 | Docker web-local-test、server/core/Project/agent/browser suites、実CLI受入script | Windows/Linux同じ243件、typechecks/check PASS。実Codex/Grok HTTPも双方PASS | 新外部provider SecretはCLIに渡していない |
| A12 | 管理・正本・索引 #386 / W11/W12 | audit/inventory、plan/contract/operations、親PR | 一意owner、実行経路、hash/import/IPC索引を再照合。docs/親PRの完了は全実受入後 | #385,#386,#374/親PRは未完了 |

## 検証対象と結果

製品最終sourceの子commitは2f6f4eb、P5統合のsquash commitは71f16ac76a3fd64f48c8828156fecd3e84cab0f7。両者のtreeは同じ。後続変更は正本/索引の更新に限定する。親PRの刷新branchへのマージはまだ行っていない。

| 実行環境 | commands・対象 | 結果 |
| --- | --- | --- |
| Windows Node24.16、Chromium156 | test:integrations69 / test:projects11 / test:agents16 / test:server18 / test:core102 / test:web27 | 合計243件PASS。ビルド・境界・typecheck・check PASS |
| Docker Desktop Linux Node22.12、Chromium156、Electron binaryなし | web-local-test full entrypoint。最終image sha256:44e3629bde68c12d1cd711c1cfcdec6591e94ccab217d5f775a5cf3ea243c165。後続変更はdocs/索引のみ | 同じ243件PASS。typechecks/check/索引PASS、entrypoint exit0 |
| Windows server → 固定Linux CLI容器 | test-web-agent-api-real.mjs、変更後のsource | Codex/Grokのauth/models/chat/同key/resume/story task/draft/stop双方PASS |
| actual Civitai/R2/Vast | 起動したP5 serverの手動受入・認証付きHTTP確認 | 3 providerのenvironment設定ready・Secret非保存、Civitai同期/検索HTTP 200（14 Collection・80結果）を確認。利用者はAPI情報取得を確認。test-web-integrations-real.mjs全体とendpoint別証跡は未実行 |

CLI imageはsha256:0ec832945a8c543d07cfe7a9040bcd024102955b332b88d4b5c9df5956633a68、Codex0.155.1/Grok1.0.46。ユーザー承認済みの既存CLIログインを使用し、非root/read-only root/mount制限を維持した。外部provider Secret元への承認と混同しない。checkの未使用変数warning4件は既存Desktop/testの箇所。

## 2026-10-09 受入時期の変更と確認済み結果

ユーザー合意により、総合受入はElectron版の画面を完全実装した後にまとめて実施する。P5は「実装完了・総合受入待ち」として管理し、実API受入の残作業をP6/P7実装着手の阻害条件にしない。#385を未完了の追跡Issueとして残し、G05/G07/G08/G10を刷新全体の完了前に必ず検証する。受入時期の変更は合格条件の免除やP5全体の受入済み宣言ではない。

- 既存のCIVIT_API_KEY、R2_ACCOUNT_ID/R2_ACCESS_KEY/R2_SECRET_ACCESS_KEY/R2_PUBLIC_URL、VASTAI_API_KEYを受入用launcherでWebの固定環境変数へ明示割当した。取得元はenvironmentのみ。旧safeStorage・別取得元fallbackは使用せず、SecretはWeb設定fileへ保存していない。
- Civitai検索のDEPENDENCY_UNAVAILABLEは現行catalog未公開によるものだった。同期jobの失敗後に明示再実行し、job succeeded、14 Collection、検索HTTP 200・80結果・generation 1を確認した。初回失敗の原因は確定しておらず、継続的な同期安定性の合格証跡にはしない。
- 利用者がAPIからの情報取得を確認した。R2/Vastの全endpointや変更操作まで成功した証跡とは扱わない。
- この確認はP5統合branchの1e32a5ed3b664e451d947213bb64d74e1c4064c4をbuild:workspaceでビルドしたserverで実施した。今回の変更は文書のみ。

総合受入では、Electron版のログイン後ホーム・設定項目・各工程のレイアウト/操作感を継承した画面から、以下の既存ゲートを実施する。複数Projectは画面内タブ、Civitai Explorer/R2 Browser/Vastなどは共通Modalを維持する。P5の簡易画面は最終UIとして受け入れない。

## 総合受入へ繰り越すゲート・具体的な操作

- G05: 新設定でactual catalogを取得し、選択modelと登録Local/R2 resourceをProjectへ反映してavailability/Preflight snapshotを確認する。P6 runtime未接続なのでexecutionReady:falseを維持し、生成成功に読み替えない。
- G07: actual Civitai catalog/detail、Vast instances/template/offersを確認する。fixtureで確認したRENT/lifecycleを実課金/既存resource破壊で自動再演しない。必要な実操作は具体的対象・server prepare factsの承認を得る。
- G08: 明示Bucket/受入prefix・resourceでstaging/server file転送とmultipart条件能力・照合を確認する。条件非対応なら明示エラーとして未受入を維持し、条件を落としたfallbackへ進まない。未知結果のmultipart/objectを自動再送・削除しない。
- G10: environment指定とSecret非保存は確認済み。総合受入で設定表示/更新・取得元失敗時の明示errorを確認する。必要なSSH受入key/instanceを新Web resourceとして明示登録し、host fingerprintを確認する。旧Electron Secret/SSH登録の移行・取得元fallbackは使わない。

巨大小メモリは16MiB parts/3並行、1MiB hash読込、bounded conditional range/chunkとintegrationで検証した。100GiB実サービス転送、全障害組合せ、OS/Docker停電、NAS/共有drive、実hostへの生成は未検証。P6実生成、P7画像codec/Picker、P8LAN/TLS/配布、P9Desktop撤去は後続phase。

## 管理の完了条件

実装子Issue#375–#384はCLOSED、子PR#388–#397はP5統合へsquash済み。#398/#399も統合済み。#385は画面完全実装後の総合受入を追跡するためOPENを維持し、#386/#374と親#387は未完了/draftとして管理する。P6/P7はP5実装を前提に着手でき、P5実受入の延期で止めない。受入Issueは合格証跡が揃うまで閉じず、刷新全体の完了前に全ゲートを検証する。親PRの統合は実装統合と受入の状態を明示して管理し、今回の記録更新だけでは親PRをマージしない。CI/main/version/release変更は行わない。
