# P4: CLI Agent runtimeとWeb AssistantPane

Status: In progress / 未受入（2026-10-08）。

親Issue: [#354](https://github.com/dommyttdev2/comfyui-batch-studio/issues/354)。P3統合0d06a4767735d35d061720956f4c7874c7ffb681を起点とする。

## 管理と順序

統合branch: codex/web-p4-354-agent-runtime。親draft PRはcodex/web-migrationへ出す。子branch/PRは最新統合branchから作成し、依存完了順にsquash mergeする。全受入後だけ親PRをreadyにして刷新branchへsquash mergeする。CI追加、mainへの統合、version変更、releaseは行わない。後方互換、旧データ移行、fallbackは禁止。

| Issue | 主責務 | 所管 | 依存 |
| --- | --- | --- | --- |
| [#355](https://github.com/dommyttdev2/comfyui-batch-studio/issues/355) P4-1: AI実行・会話・成果物の新Web契約を確定する | scope、session/turn/job、API/DTO、履歴上限、reservation/CAS、event、process所有権、OS隔離、shutdown/reconcile、成果物取り込みと受入matrixを正本に固定する。 | W01/W04/W10 | P3 |
| [#356](https://github.com/dommyttdev2/comfyui-batch-studio/issues/356) P4-2: 両CLI adapterと隔離されたprocess実行を実装する | Node CLI parser/adapterをDesktop依存なしに接続し、固定実行path/image、env allowlist、認証/models/protocol probe、resume一致、stdout/backpressure、全process停止、隔離workspaceとcredential管理を実装する。 | W04/W10 | 355 |
| [#357](https://github.com/dommyttdev2/comfyui-batch-studio/issues/357) P4-3: 会話・履歴・session・model設定の永続化を実装する | 現行agent store、scope/user ownership、history/sessions/new/restore、上限、model/reasoning能力とP1 AgentPreferencesを実Repositoryへ接続する。 | W03/W04 | 355 |
| [#358](https://github.com/dommyttdev2/comfyui-batch-studio/issues/358) P4-4: chat/taskとserver jobの予約・停止・復旧を接続する | P1 AgentUseCases/AgentTaskUseCasesとP2 jobを接続。chat/task排他予約、切断非cancel、外部await前予約、durable input、event scope、stop/force fencing、再起動不確定状態と明示照合。 | W04/W10 | 356, 357 |
| [#359](https://github.com/dommyttdev2/comfyui-batch-studio/issues/359) P4-5: 工程task成果物の安全なdraft取り込みを実装する | P1 task planner/import/patch/LoRA policyを接続。現行確認済み入力snapshot、隔離output、path/size/hash/session/turn/revision検証、権限再検査、重複防止、無効/古い成果物保持、原子的draft/event保存。 | W03/W04 | 358 |
| [#360](https://github.com/dommyttdev2/comfyui-batch-studio/issues/360) P4-6: AI認可APIとscope付きイベントを実装する | 認証/models/preferences/history/new/restore/chat/task/stop/reconcile/import APIを狭いDTOで公開。任意CLI path/session/role入力拒否、permission/CAS/idempotency、公開eventにsecret/raw reasoning非出力。 | W01/W04 | 357, 358, 359 |
| [#361](https://github.com/dommyttdev2/comfyui-batch-studio/issues/361) P4-7: Web AssistantPaneの会話・task・履歴操作を接続する | Project/工程/provider別Pane state、model/reasoning/history/new/restore、送信/task/stop、stream/event再接続、job/progress/import結果、遅延世代・閉じたtab隔離、draft flushと共通Modalを実APIへ接続。 | W02/W04 | 360 |
| [#362](https://github.com/dommyttdev2/comfyui-batch-studio/issues/362) P4-8: Windows・Linux・Chromium・両実CLIの統合受入を行う | adapter fixtureだけで完了扱いにせず、既存CLIログインで両CLIのmodels/chat/task/resume/stop・sandbox/OS隔離を実行。API/永続化/crash/並行開始/出力安全性、ブラウザ切断/復帰をローカル検証する。 | W12/W04/W10 | 356, 358, 359, 360, 361 |
| [#363](https://github.com/dommyttdev2/comfyui-batch-studio/issues/363) P4-9: P4正本・移行計画・全コード索引と親PRを完成する | 実装・受入を正本/索引にMECE対応付け、対象SHA/コマンド/結果/未検証範囲を記録し全子PR/Issue完了後に親PRを刷新branchへsquash統合する。 | W11/W12/W14 | 362 |

## 実装境界

- domain/application: 会話・model・task planning・成果物の業務判断。Electron、HTTP、process、Dockerを参照しない。
- server: current agent store、認可、durable job、scope event、CLI adapter、隔離process、物理artifact検証。
- web: AssistantPane表示、scope別入力/履歴/stream、model選択、task/stop、競合/再認証UX。業務判断を複製しない。

## G04受入条件

1. Codex/Grok両方で既存CLIログインを明示使用し、models/chat/task/resume/stopを実行する。fixtureだけで受入済みにしない。
2. Project/stage/providerごとのchat/task共通予約を外部awaitより前に永続化。同一requestは同じjob、違う入力は競合。
3. tab切替・close・HTTP/WS切断でjobを停止しない。server restartはuncertain、明示照合前に再実行しない。
4. CLIは明示登録した固定imageで隔離する。Project本体、server dataDir、SSH/R2秘密設定、Docker socketをmountしない。cwd/env削減だけで隔離済みとしない。
5. sessionはuser/Project/stage/providerに結び付け、任意session/path/roleは入力として公開しない。履歴とeventにsecret/raw reasoningを出さない。
6. taskは確認済み入力snapshotを使う。成果物はscope/turn/path/size/hash/revision/権限を照合し、失敗や競合時にdraftを上書きしない。
7. Windows/Linux/Chromiumでローカル受入し、対象SHA、コマンド、結果と未検証範囲を記録する。

正本契約・運用・受入matrixと全コード調査索引を子Issueに対応させ、未完了は明示する。
