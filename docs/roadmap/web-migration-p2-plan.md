# P2: Webサーバー基盤の実行計画

Status: Complete / 実装・ローカル受入完了（2026-10-08）。親PR #323で刷新ブランチへ統合する。

## 前提と目的

P1の親Issue #305とPR #309は完了済み。刷新ブランチのmerge commitは `f221c1799a668e757e6f4de141100588c2547a6b`。このcommitを起点に、分離済みdomain/application/portへHTTP/WebSocketの入口と実サーバー基盤を接続する。

親Issue: [#313](https://github.com/dommyttdev2/comfyui-batch-studio/issues/313)

複数Projectはブラウザの別タブではなく、[画面内Projectタブ](web-workspace-tabs-plan.md)で操作する。P2はProject context・認可・job/eventの独立所有を用意し、タブUIを実装するのはP3以降。

## ブランチとPR

- P2統合ブランチ: `codex/web-p2-313-server-foundation`。
- 親PR [#323](https://github.com/dommyttdev2/comfyui-batch-studio/pull/323)のbase: `codex/web-migration`。bootstrapから統合受入までの全P2差分を含む。
- 子作業ブランチ: P2統合ブランチの最新commitから `codex/web-p2-<子Issue番号>-<topic>` を作る。
- 子PRのbase: `codex/web-p2-313-server-foundation`。子Issue単位でローカル検証後にsquash mergeする。
- 依存する子PRを取り込んでから次の子ブランチを作る。独立作業でもshared contract/package/lockの編集を競合させない。
- P2全体の受入後、親PRをrefresh統合ブランチへsquash mergeする。それまではdraftのまま保持する。
- これはユーザー指定の親PRのためにP2だけ設ける統合階層。mainへの直接PRやmainへのmergeは行わない。
- CIはP2/刷新向けに追加しない。ローカル検証を必須とする。アプリversionを変更しない。

## 子Issue・責務・依存

| Issue | 主な成果 | 依存 |
| --- | --- | --- |
| [#314](https://github.com/dommyttdev2/comfyui-batch-studio/issues/314) P2-1 bootstrap | entry/composition root、設定、loopback、data/resourceDir、health/readiness、API/build ID | P1 |
| [#315](https://github.com/dommyttdev2/comfyui-batch-studio/issues/315) P2-2 HTTP契約 | DTO/validation/controller、Project/Job ID、revision/request ID、エラー/body上限 | #314。認証接続は#317 |
| [#317](https://github.com/dommyttdev2/comfyui-batch-studio/issues/317) P2-3 認証・認可 | session、role/project/asset/job scope、Origin/Host/CSRF、WS handshake | #314、#315 |
| [#318](https://github.com/dommyttdev2/comfyui-batch-studio/issues/318) P2-4 所有権・lock | dataDir単一起動、canonical Project、別serverの同資源、所有不明の照合 | #314、#315、#317 |
| [#319](https://github.com/dommyttdev2/comfyui-batch-studio/issues/319) P2-5 job/idempotency | 永続予約、input identity、状態、排他、stop/cancel、結果不明、再起動hook | #315、#317、#318 |
| [#320](https://github.com/dommyttdev2/comfyui-batch-studio/issues/320) P2-6 event/replay | scoped envelope、snapshot/購読境界、順序/重複、上限/履歴不足/backpressure | #315、#317、#319 |
| [#321](https://github.com/dommyttdev2/comfyui-batch-studio/issues/321) P2-7 終了・統合受入 | command受付停止、drain、期限、force/不確定、lock解放、P2全体検証 | #314、#315、#317、#318、#319、#320 |

認証前の#315はfakeの認可済みcontextで検証する。外部から到達する業務APIは#317の認証接続前に有効化しない。表の依存は実装・受入順であり、並行する未完成branch同士を隠れて参照しない。

## 横断契約と禁止事項

- UI tab IDは認可根拠ではない。serverの認証session、Project ID、job/picker contextを検証する。
- jobは画面やrequestの所有物にしない。tab切替/close/切断ではRun/CLI/転送を停止しない。
- coreはHTTP・WS・Electron・React・DOMを直接参照しない。controllerが認可・入力検証後にcoreを呼び出す。
- job開始は原子的に予約し、外部副作用の結果不明を成功や無条件再送に変えない。
- replay不足は明示エラー。snapshotや旧APIへの自動fallbackを実装しない。
- Secret/raw reasoning/内部stackをhealth、log、HTTP、eventへ漏らさない。
- 旧schema読み替え・マイグレーション・互換adapterは禁止。未完成機能は明示的に利用不可とする。

## ローカル検証と完了条件

各子PRで変更した境界の型検査・core禁止依存検査・API/WS integrationを実行し、コマンド、対象SHA、結果、未検証範囲を記録する。#321では統合commitで全P2回帰/buildとWindows/Linuxのpath/lock/process検証を行う。Docker/Linuxは既存基盤を利用し、旧Electronのテスト成功だけでP2受入を代替しない。

複数Projectのjob/event隔離、未認証/越権/偽Origin/CSRF、競合予約、開始前後の障害、snapshot中のevent、再接続と履歴不足、slow client、二重server、graceful/force/restartの各ケースが通過し、P3が利用できるAPI/context/event契約を確定したら親PRをreadyにする。

実Project/Artifact操作とUIはP3、実CLIはP4、Secret/外部連携はP5、実生成はP6、画像はP7。P2はfake/portと実serverで基盤を受け入れ、後続phaseの実機検証を済んだことにしない。

## 実装・受入結果

子Issue #314/#315/#317/#318/#319/#320はそれぞれPR #325/#326/#327/#328/#329/#331でP2 branchにsquash統合済み。#321はPR #333で終了・統合受入、運用文書と全コード索引更新を完成した。P2統合SHAは54a53aa03de53cab8f174d71708f12a12d8824ef。検証対象21d12f2a8638757258c641d8a1cede1ed659dd71と統合SHAの実装/test/build入力の差分はない。全子PRの後に親PR #323を刷新branchへsquash統合する。

WindowsおよびDocker/Linuxで npm run test:server（18件、失敗/skipなし）、npm run test:core（102ケース）、npm run check、npm run typecheckを成功確認した。Docker/Linuxでは既存 npm test（登録61ファイル）と npm run buildも成功。最後のserver照合競合・HTTP drain修正後に両OSのtest:serverを再実行した。checkの既存4件のunused-variable警告と既存buildのag-psd/util警告は残る。CI追加・version変更・mainへの統合は実施しない。

依存禁止検査、実HTTP/WS、P1 use case接続、実Node起動/crash/restart、保存失敗、同時予約/照合、force後の遅延結果を受け入れた。実CLI、実生成、製品Web UI、停電耐久性は未検証で後続phaseの範囲。運用/API契約は[Web server foundation](../architecture/web-server-foundation.md)に一本化する。次はP3のProject/Artifact操作と画面内タブ・ツールモーダルを進める。

| 完了Issue | squash統合PR |
| --- | --- |
| #314 | [#325](https://github.com/dommyttdev2/comfyui-batch-studio/pull/325) |
| #315 | [#326](https://github.com/dommyttdev2/comfyui-batch-studio/pull/326) |
| #317 | [#327](https://github.com/dommyttdev2/comfyui-batch-studio/pull/327) |
| #318 | [#328](https://github.com/dommyttdev2/comfyui-batch-studio/pull/328) |
| #319 | [#329](https://github.com/dommyttdev2/comfyui-batch-studio/pull/329) |
| #320 | [#331](https://github.com/dommyttdev2/comfyui-batch-studio/pull/331) |
| #321 | [#333](https://github.com/dommyttdev2/comfyui-batch-studio/pull/333) |
