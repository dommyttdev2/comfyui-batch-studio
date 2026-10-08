# P3受入matrix

Status: Planned。#335の契約照合は完了。下表の製品動作は#336–#343で実装・検証する。[契約正本](../contracts/web-project-workspace.md)と[P3管理](../roadmap/web-migration-p3-plan.md)を参照する。成功記録は実行command/対象SHA/OS/browser/結果/未検証範囲を各PRに残す。

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

#336–#342は担当boundaryの検証を子PRで行い、#343は統合commitで一連のcreate→edit→confirm→compileと複数client/tabのbrowser検証を実行する。CIは追加しない。既存Desktop test成功でWeb操作を受入済みとしない。停電耐久性、実CLI/外部生成、実画像memory/codec、全Electron撤去はP4–P9に残す。
