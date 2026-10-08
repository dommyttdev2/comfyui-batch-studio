# P5: 設定・外部連携・streaming転送

Status: 実装子Issue10件完了 / Windows・Linux fixture受入済み / 実サービス設定元待ち（2026-10-08）。

親Issue [#374](https://github.com/dommyttdev2/comfyui-batch-studio/issues/374)。P4統合0744c5549c024b7f95759b752a2cad5375fe3bfdから開始する。統合branch codex/web-p5-374-integrations、親draft PR [#387](https://github.com/dommyttdev2/comfyui-batch-studio/pull/387)はcodex/web-migrationへ。子branchは最新統合から作成し、依存完了順に子PRをsquash統合する。CI/main/version/release変更なし。旧データmigration・後方互換・fallbackは禁止。

## 子Issueと一意の責務

| Issue | 主責務 | 所管 | 依存 |
| --- | --- | --- | --- |
| [#375](https://github.com/dommyttdev2/comfyui-batch-studio/issues/375) P5-1: 外部連携・Secret・確認・転送の新Web契約を確定する | 現行schema、認可scope、Secret指定元、確認token/receipt、外部結果不明、browser staging/offset、multipart/source hash、SSH trust、API/UI/受入を固定する。 | W01/W05/W07/W08/W10 | P4 |
| [#376](https://github.com/dommyttdev2/comfyui-batch-studio/issues/376) P5-2: 新規SecretStoreと外部連携設定を実装する | 旧safeStorageを読み込まない現行設定と明示Secret元。admin新規登録、metadata-only DTO、暗号/鍵境界、利用不能時の明示エラーとCLI隔離を実装する。 | W10 | P5-1 |
| [#377](https://github.com/dommyttdev2/comfyui-batch-studio/issues/377) P5-3: prepare/confirmと外部操作のdurable予約を実装する | user/session/project/revision/target fingerprint/expiryを束ねた一度限りの確認、外部await前予約、receipt、未知結果の照合、再送禁止を共通化する。 | W01/W10 | P5-1,P5-2 |
| [#378](https://github.com/dommyttdev2/comfyui-batch-studio/issues/378) P5-4: Civitai client・catalog同期とcacheを接続する | P1 catalog sync/policyを再利用し、固定endpoint/429/deadline/cache世代、検索/detail/collection、job/event、current catalog原子保存を実装する。 | W07 | P5-2,P5-3 |
| [#379](https://github.com/dommyttdev2/comfyui-batch-studio/issues/379) P5-5: R2 Browser・object indexと管理APIを接続する | 固定S3資格情報、bucket/list/search/index、URL/metrics/template、copy/move/deleteと確認、認可付きbinary取得、unknown outcome保持を実装する。 | W08 | P5-2,P5-3 |
| [#380](https://github.com/dommyttdev2/comfyui-batch-studio/issues/380) P5-6: browser/server fileのstreaming stagingと再開を実装する | 許可assetとserver file登録、browser binary streaming、offset/hash/owner/世代、quota、切断後再開、cleanup、任意path禁止を実装する。 | W08/W10 | P5-2,P5-3 |
| [#381](https://github.com/dommyttdev2/comfyui-batch-studio/issues/381) P5-7: R2 multipart転送jobと停止・照合を接続する | P1 transfer runtimeの業務判断を再利用。durable job/multipart parts/source fingerprint、pause/resume/cancel、ListParts照合、server再起動uncertain、重複転送防止を実装する。 | W08 | P5-5,P5-6 |
| [#382](https://github.com/dommyttdev2/comfyui-batch-studio/issues/382) P5-8: Vast.ai管理とSSH初回信頼を接続する | P1 offer/SSH core、instances/templates/offers、RENT/start/stop/reboot/destroy確認、外部結果不明照合、SSH key/endpointとhost fingerprintの確認を実装する。生成runtimeはP6。 | W07/W10 | P5-2,P5-3 |
| [#383](https://github.com/dommyttdev2/comfyui-batch-studio/issues/383) P5-9: 実catalog/resourceのmodel選択・availability・Preflightを統合する | current Projectと登録resource/Local/R2の観測をP1 policy/compiler/preflightへ接続する。legacy Project/settings/index読替を使わず、snapshot revision/hashと許可resourceを検証する。 | W05 | P5-4,P5-5,P5-8 |
| [#384](https://github.com/dommyttdev2/comfyui-batch-studio/issues/384) P5-10: Civitai・R2・Vast.ai・設定の共通Modalを接続する | 管理/Project選択context、server確認、browser upload/download/job、条件保持、世代/認証/lease/flushを共通Modalで実APIへ接続する。 | W02/W07/W08 | P5-4,P5-5,P5-6,P5-7,P5-8,P5-9 |
| [#385](https://github.com/dommyttdev2/comfyui-batch-studio/issues/385) P5-11: Windows・Linux・Chromium・実サービスのローカル受入を行う | 認可/秘密/確認/外部受理後crash/streaming multipart再開/巨大小メモリ/未知結果と全機能をfixtureで検証。実Civitai/R2/Vast設定で接続/catalog/resource受入を行い未検証範囲を明示する。 | W12 | P5-2〜P5-10 |
| [#386](https://github.com/dommyttdev2/comfyui-batch-studio/issues/386) P5-12: P5正本・移行計画・全コード索引と親PRを完成する | MECEな要求/実装/検証/管理対応、運用/契約/受入SHA/全コード索引を完成し、全子Issue後に親PRを刷新branchへsquash統合する。 | W11/W12/W14 | P5-11 |

## 境界と受入

- application/domain: 既存P1 catalog/transfer/offer/model/Preflight policyを再利用する。HTTP・Electron・physical pathやSecret sourceを持ち込まない。
- server: current設定/Secret、固定外部client、認可、durable確認/receipt/job、staging/resource/SSHの実IO。
- web: 共通Modalの操作・条件/世代・flush・lease・server確認・binary upload/download。業務判断を複製しない。

G05は実catalogとLocal/R2のresource観測、G07はCivitai/cache/429とVast管理/確認/未知結果、G08はR2管理とbrowser/server streaming/multipart再開、G10はSecret指定元/OS/SSH確認を対象にする。実接続の設定元はユーザー指定を待ち、秘密値を会話/Git/公開DTOへ出さない。fixtureを実環境成功に読み替えない。P6の実生成、P7の画像codec、P8のLAN/TLS/配布は本phaseの完了に混ぜない。

## 実施状況と残る依存

| 子Issue | PR（P5統合へsquash） | 状態 |
| --- | --- | --- |
| #375 契約 | [#388](https://github.com/dommyttdev2/comfyui-batch-studio/pull/388) | CLOSED |
| #376 設定/Secret | [#389](https://github.com/dommyttdev2/comfyui-batch-studio/pull/389) | CLOSED |
| #377 durable外部確認 | [#390](https://github.com/dommyttdev2/comfyui-batch-studio/pull/390) | CLOSED |
| #378 Civitai | [#391](https://github.com/dommyttdev2/comfyui-batch-studio/pull/391) | CLOSED |
| #379 R2管理 | [#392](https://github.com/dommyttdev2/comfyui-batch-studio/pull/392) | CLOSED |
| #380 staging/files | [#393](https://github.com/dommyttdev2/comfyui-batch-studio/pull/393) | CLOSED |
| #381 multipart/snapshot転送 | [#395](https://github.com/dommyttdev2/comfyui-batch-studio/pull/395) | CLOSED |
| #382 Vast/SSH | [#394](https://github.com/dommyttdev2/comfyui-batch-studio/pull/394) | CLOSED |
| #383 model/resource/Preflight | [#396](https://github.com/dommyttdev2/comfyui-batch-studio/pull/396) | CLOSED |
| #384 共通Modal | [#397](https://github.com/dommyttdev2/comfyui-batch-studio/pull/397) | CLOSED |
| #385 OS/実受入 | [#398](https://github.com/dommyttdev2/comfyui-batch-studio/pull/398) | 独立した受入修正は統合済み。Windows/Linux243件・実Codex/Grok PASS。実Civitai/R2/Vastと具体的resource受入は新設定元待ちでOPEN |
| #386 正本/索引/親統合 | 正本・索引更新を子PR化する | 索引538 code/config、372src、117tests、18scripts、172IPCを再照合。全実受入と親PR統合までOPEN |

[受入matrix](../quality/web-p5-acceptance.md)に要求・実装・test・実環境の状態を一意に対応付ける。製品sourceの最新P5統合は71f16ac76a3fd64f48c8828156fecd3e84cab0f7。ここからの正本/索引更新は製品挙動を変更しない。

新Web設定元の回答後は、明示登録→read-only service受入→選択catalog/Local/R2 resource観測→具体的R2転送/SSH確認の順にG05/G07/G08/G10を受け入れる。料金発生・既存resource破壊は具体的対象を確認して承認する。条件付きS3機能が実環境で非対応ならfallbackを使わず未受入として修正する。fixtureを実成功に置き換えない。

すべて通過後に#385を閉じ、正本のStatusと最終SHAを更新し、親#387をreadyにしてcodex/web-migrationへsquashする。親マージ確認後に#386/#374を閉じる。それまでは親draftを維持する。P6には実catalog/resourceとSSH信頼・転送jobの新契約を渡すが、P5未受入のままP6完了や実生成成功を宣言しない。
