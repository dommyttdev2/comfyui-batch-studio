# P3受入matrix

Status: Accepted / P3（2026-10-08）。#335–#343の実装・ローカル受入を完了。下表は要求境界と所管であり、全障害組合せや停電耐久性を保証する表ではない。[契約正本](../contracts/web-project-workspace.md)と[P3管理](../roadmap/web-migration-p3-plan.md)を参照する。成功記録は実行command/対象SHA/OS/browser/結果/未検証範囲を各PRに残す。

| ID | 境界・trigger | 期待結果 | 実装owner / 検証 |
| --- | --- | --- | --- |
| C01 | 未認証/別Project/入力role/root | 401/403/400、core未実行・内部path非出力 | #336/#338 API |
| C02 | admin作成と未知ID | 事前grant不要、未完了Project非公開、再login後Open可 | #336 実disk/API |
| C03 | 同じcreate key再送・内容変更 | 同じID/receipt、変更409、権限再検査 | #336 API |
| C04 | Project作成/grant/registry各境界crash | intent照合、二重directory/IDなし、不明なら停止 | #336 process/disk |
| C05 | alias/大小文字/junction/symlink/UNC/root置換 | canonical同一ID、escape拒否、未保証FS拒否 | #336/#339 Windows/Linux |
| C06 | 空/旧schema/壊れたProject/registry/journal | 明示拒否、変換・補完・自動削除なし | #336/#337 disk |
| C07 | A/B client lease競合・server/client時計差 | 60秒server TTL、別session拒否、20秒renew | #337 API/clock fixture |
| C08 | renew/release・失効/別session/保存競合 | 同一lease ID更新、revision増加、資格情報秘匿 | #337 API |
| C09 | 同時save/confirm/reset/compile、再送/timeout | state/event/receipt atomic、CAS・dedup、競合409 | #337/#338/#339 disk/API |
| C10 | receipt期限/quota/key再利用 | 410/503、tombstone維持、無条件再実行なし | #337 clock/storage fixture |
| C11 | state保存前/後・broker append前/後・cursor前/後crash | 欠落/二重sequence発行なし、ready前照合 | #337 実process/disk |
| C12 | snapshot/購読同時commit・古いinvalidation・journal eviction | revision巻戻しなし、dedup watermark維持、履歴不足明示 | #337/#340 HTTP/WS |
| C13 | reset確認後target/revision/owner変更、再利用 | consumeと再検証、失効拒否、別対象に適用しない | #338 API |
| C14 | 有効/無効draft、意味変更/説明だけ変更、下流reset | core validation/stale規則、確定Artifactをdraftで上書きしない | #338 core/API |
| C15 | fixture compile、Template/hash欠落、入力変更 | deterministic graph/provenance、一括commit、fallbackなし | #339 core/disk/API |
| C16 | asset traversal/別Project/symlink置換、権限取消 | scope/realpath/型/size再検査、秘密非公開 | #339 binary HTTP |
| C17 | login失効/権限変更/build不一致/WS履歴不足 | 編集停止、再login/reload/明示再同期、旧cache非表示 | #340 Chromium |
| C18 | A/B反復切替・save失敗/409/lease喪失・close | state独立、flush完了まで保留、明示破棄はjob停止でない | #341 Chromium E2E |
| C19 | close後の遅延HTTP/event、同ID再Open | 世代一致storeのみ更新、勝手なtab再生成なし | #341 Chromium/fake server port |
| C20 | reload・draft期限/容量/別user/revision競合 | 最後の有効Project1件、回復提案/差分、無断上書きなし | #341 Chromium/IndexedDB |
| C21 | 非表示/closed Project job、request切断 | server継続、全jobから再Open、別Project混入なし | #341 P2 fixture job/E2E |
| C22 | Modal close/reOpen、内部dialog/Escape/狭幅 | state保持、focus trap/inert/復帰、1+1段 | #342 Chromium keyboard |
| C23 | Modal取消/起点close/lease失効/遅延confirm | Project/slot/世代固定、server再検証、結果拒否 | #342 API/context fixture |
| C24 | 未登録実ツール/CLI/Run/画像Picker | 明示利用不可、fake成功や旧IPC経路なし | #340–#342 UI/API |
| C25 | 1/5/10 tab反復切替/close | listener/timer/URL leakなし、同条件memory/応答記録 | #343 Chromium local |
| C26 | ElectronなしWeb build/start、型/境界/P2/core回帰 | Windows/Linux成功、索引--check、対象SHA証拠 | #343 local build/test |

#336–#342は担当boundaryを子PRで検証し、#343でcreate→edit→confirm→compile、複数client/tabのChromium統合を実行した。CIは追加しない。既存Desktop test成功でWeb操作を受入済みとしない。停電耐久性、実CLI/外部生成、実画像memory/codec、全Electron撤去はP4–P9に残す。


## 実行証拠と境界対応

対象sourceはP3-9子PRのhead SHAと親PR #344に記録する。生成物と依存packageを除く全コード索引は479 file（src336/tests98/scripts14）、IPC172、binary8、文書37で主担当重複・未分類なし。最終git diff --check / 索引--checkを確認する。

| 境界 | 実行経路と証拠 |
| --- | --- |
| C01–C06 | test:projectsのregistration/API/acceptance。10並列同key作成、内容変更拒否、grant後registry publish障害と再照合、canonical alias/大小文字（Windows）/junction（Windows）/symlink（Linux）/escape、旧envelope/journal拒否。未確認のmkdir-marker境界は自動修復せず停止する契約と実装を照合 |
| C07–C10 | repository/API/acceptanceとtest:core。lease取得/renew/別session/CAS、10並列同key保存、7日receipt期限、100,000 tombstone上限、server TTL境界、失効後書込み拒否 |
| C11–C12 | acceptanceの実Node子process強制終了（予約後、broker append後）、明示dead-owner復旧、outbox/event IDの重複防止、repository配信fault fixture。P2 eventsのsnapshot/replay/eviction/real WS scope検査 |
| C13–C16 | API reset確認消費/変更後拒否/再送、core検証/stale、deterministic fixture compile/Template不整合、binary HTTP scope/hash/traversal/asset root置換。builtin Template取得も実HTTPで確認 |
| C17–C19 | Chromium auth変更によるWS失効/画面・modal非表示、build mismatch、A/B isolation、flush 409/lease喪失保持、重複Open/close。実Workspace classと遅延API portで世代差/closed-tab eventを検査。再接続/replay不足のserver拒否はP2 real WSで検証 |
| C20–C21 | Chromium reload/最後のProject1件/未送信draft復元、実Drafts classのIndexedDB容量/期限/別user/非同期put→discard。P2登録probe jobがtab close後も継続し全jobから再Openできることを確認 |
| C22–C24 | Chromium tool条件保持/keyboard/focus/inert/Escape/narrow/reset確認。実Modal context guardで世代/対象工程/revision/lease変更を拒否。未接続のAI送信/外部操作はdisabled表示 |
| C25–C26 | 下記performance記録、独立Web/Server build、Web/Server/Core import境界、WindowsとElectron binaryのないDocker Linux Chromium、core/P2回帰、型/format/lint/索引 |

| 実行環境 | 結果 |
| --- | --- |
| Windows / Node24.16.0 / Chromium156（Playwright1.64.0） | test:projects 11/11、test:web 15/15、test:server 18/18、test:core 102/102成功。typecheck/typecheck:web/check/境界/索引成功 |
| Docker Desktop / Linux Node22.12.0 / Chromium156（Playwright1.64.0） | web-local-testでtest:projects 11/11、test:web 15/15、test:server 18/18、test:core 102/102、型/format/lint/索引成功。Electron binaryなしをscriptで検査 |
| Linux従来Desktop回帰 | 既存test imageに現sourceをread-only mountしてnpm test（61登録test file）とnpm run build成功。独立Web受入とは別経路 |

checkは既存Desktop source/testの未使用変数warning4件で成功し、新規errorはない。Docker受入はdocker compose build web-test / docker compose run --rm web-testで再現できる。CI追加・version変更・旧形式移行なし。

## 1 / 5 / 10タブ測定

同じ空fixture10 Project、headless Chromium、各countで3巡、Playwright click→表示確認までの平均。GC後のCDP JS heapを記録する。描画時間だけのmicrobenchmarkではない。固定React listenerも含むCDP totalをprocess終了前に観測し、全listenerが0になると解釈しない。

| OS | tab数 | 平均切替ms | JS heap MiB | DOM nodes | CDP event listeners |
| --- | ---: | ---: | ---: | ---: | ---: |
| Windows | 1 | 61.0 | 2.70 | 130 | 183 |
| Windows | 5 | 36.7 | 2.91 | 175 | 338 |
| Windows | 10 | 35.1 | 3.10 | 230 | 358 |
| Linux | 1 | 67.0 | 2.70 | 130 | 183 |
| Linux | 5 | 37.9 | 2.91 | 175 | 338 |
| Linux | 10 | 36.2 | 3.09 | 230 | 358 |

選択editorは常に1つ、WSとlease timerは各1つ。tool dialogのwindow listenerはclose後baselineへ戻り、object URLは0。10タブclose後editor0/Home1、logout後WS/timer0。close/logout後のCDP nodes35・listeners295・heap約3.08MiBを記録した。短いfixture測定で長時間・実画像・実CLIのmemory上限を保証しない。長時間/実画像はP7で測定する。

予約後の強制終了は成功結果を捏造せず、操作をtombstone化する明示recover:projectでのみ再受付できる。既にcommit済みのoutboxは次起動で照合する。生存/不明owner・Run入りProject・破損schemaは復旧拒否。全phaseの復旧をP3で完了扱いにしない。
