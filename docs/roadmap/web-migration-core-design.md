# P1 業務coreの境界と受入

P1は[移行計画](web-migration-plan.md) 3.1/3.2に従う新Web版の業務入口を `src/application/core.ts` に用意する段階である。HTTP起動やWeb画面、実サービス接続の完成とは区別する。主担当W10、関連W01/W03/W04/W06/W09/W12、受入はG10の層分離部分。[Issue #305](https://github.com/dommyttdev2/comfyui-batch-studio/issues/305)で管理する。

## 四層と依存方向

| 層 | P1で確定する責務 | 接続段階 |
| --- | --- | --- |
| presentation | actor/session解決、DTO検証、表示・確認画面、通信errorへの変換。業務判断はapplicationへ送る | HTTPはP2、Stage/画面はP3以降 |
| application | Project/Artifact操作、認可・lease/CAS・編集guard、Run停止の順序、AI予約と開始、確認tokenの再照合 | src/application、P1で単独実行可能 |
| domain | 型付き業務error、確定/stale、Run編集可否・停止方式、確認条件、画像メモリ予算 | src/domain、P1で単独実行可能 |
| infrastructure | transaction/CAS/outbox、CLI/runtime、確認tokenの原子的消費、SecretStore・ImageCodec・asset解決 | P1はtests/core-supportのfake、実実装は各機能phase |

依存はapplicationからdomainだけ。coreはNode標準module、React、Electron、HTTP、旧src/main・shared/typesをimportしない。ClockとIdSourceも注入する。tsconfig.core.jsonはES2022のみ、Node/DOM型なしでcompileする。境界検査はtype-only import/re-export、dynamic import/require、platform symbolも拒否する。

## 現行の混在箇所から切り出した責務

| 現行の調査参照 | 新版で判断する場所 | presentation/インフラへ残す責務 |
| --- | --- | --- |
| main.ts ensureProjectWritable、App.tsx閲覧専用判定 | domain/execution-policy、application/project-access | snapshot表示、scope解決、Run読出 |
| main.ts stopRunForExit、runRequiresExitGuard、Execution IPC | domain/execution-policy、application/execution-use-cases | ComfyUI/SSH/Vast.ai実呼出、worker終了待ち・外部状態照合 |
| main.ts confirmRunStopBeforeLeave、EXECUTION_LEAVE | application/project-use-cases.leave | Web画面離脱・Project切替は停止しない。server shutdownはP2/P6で別管理 |
| artifact-service.ts、Project/Grok/PromptPlan Stageの保存・確定 | domain/artifact-policy、application/project-use-cases | canonical validatorとphysical repository。画面の補助validationは受入根拠にしない |
| use-editor-autosave.tsの時刻採番、画像storeのrevision補完 | application/project-access/project-use-cases | debounce・未送信draft・保存表示。新版revisionはserverが発行 |
| agent-conversation-runner.ts、Assistant IPC/Pane | application/agent-use-cases | provider選択実装、CLI launch/停止、history永続化・event配信 |
| RENT/削除/SSH trust/Run破棄/backup/editor復元のdialog | domain/confirmation-policy、application/confirmation-use-cases | 条件取得、確認画面、外部操作とjob所有権 |
| image-size-limits.ts、image-pipeline.ts、設定store | domain/image-policy、application/platform-ports/platform-use-cases | 選択済codec、SecretStore、認可済asset解決。失敗時の代替経路なし |

旧main/IPC/StageはP0の調査参照として残る。新coreから到達しない。旧Electronへcoreを再接続するadapterは作成せず、P9で参照codeを撤去する。

## 新command/result/eventの契約

- actorはserverが認証したuser/session/request、許可Project IDとpermission。clientのroot/sender kindを権限にしない。
- Projectはweb-project/1だけを扱い、revision、lease、artifacts、drafts、runsを明示する。欠落・旧形式・未知Run状態はerror。旧stateを補完しない。
- read、acquireLease、beginEdit、saveDraft、confirm、resetはProject IDを使う。更新はexpectedRevisionとleaseIdが必須。下書き保存で確定済みArtifactを上書きせず、確定はtransaction内で再検証する。確定/resetでは下流をstaleにする。
- transactionはProject排他、CAS、revision増加と業務eventのatomic commitを所有する。eventにはproject/user/session/request/subject/revisionを付ける。実outbox配信のsequence/replayはP2で実装する。
- Run stopはgraceful/interruptを明示する。Remote準備はpause、成果物処理中は拒否、不確定Localは専用照合、Remoteは停止と課金finalizationを確認する。未確認を成功にしない。
- AIのchat/taskは同じproject/stage/provider所有権をavailability待ちの前に予約する。request再送では既存jobを返す。launch結果不明はunknownを保持し、予約解除や別provider起動をしない。履歴・stopも同じscopeで扱う。
- confirmationは対象・条件fingerprint・revision・user/session・期限を結び付ける。confirm時に再照合し、portが原子的に消費してjobを予約する。clientのconfirmed flagや追加fingerprintで条件を上書きできない。
- Secret取得は内部use case用であり、HTTPへ公開しない。指定storeが利用不能なら処理を開始しない。image renderも選択済codec一つを使う。

実portはproject/resource/jobのscope、request内容一致、durable予約、process跨ぎ排他、atomic保存、外部結果不明の照合を実装する義務を持つ。P1のmemory fakeは操作順序・失敗契約を検証するもので、disk durabilityや外部サービスの実動作を保証しない。

## P1の受入条件

- [x] 四層の責務と現行main/IPC/Stageからの対応を記録。
- [x] 型付きactor/command/result/event、Repository/runtime/confirmation/Secret/ImageCodecのportを定義。
- [x] 具体的なuse caseをcreateBusinessCoreから呼出可能にし、fake infrastructureを接続。
- [x] 禁止依存検査とNode/DOM型なしのcore compileを実装。
- [x] CAS競合、lease、scope、atomic失敗、Artifact確定、Run停止、不確定状態、AI二重起動、確認再照合、codec/Secret失敗をcore単独testで検証。
- [x] WindowsとDocker/LinuxでP1全体回帰を実行。
- [x] 新fileの主担当と層、core-local test経路を調査索引へ登録。

G01-G14全体の機能受入は完了扱いにしない。HTTP/認証/Origin/CSRFはP2、登録済みProjectと実永続化・各canonical validatorはP3以降、実CLIはP4、実Secret/外部clientはP5、実生成はP6、実codecはP7、browser E2EはP8で検証する。旧Desktop回帰・全app build・実外部接続はP1の証拠に含めない。通常実装のためapp versionは0.82.0を維持する。

## ローカル検証

Windows: Node v24.16.0、既存依存のTypeScript 7.0.2 CLIを使い、node scripts/check-core-boundaries.cjs、tsc -p tsconfig.core.json、node tests/business-core.cjsを実行。domain 5件・業務34件（計39件）、failure/cancel/skipは0。新coreのBiome整形も確認。

Docker/Linux: Node v22.12.0、composeの既存local-test imageを使用。npm run test:core（境界検査・compile・domain 5件・業務33件）とnpm run check・npm run typecheckを実行。checkの6 unused-variable警告は既存codeだけで、errorなし。

検証logは作業ツリーのp1-windows-core.logとp1-linux-core.log（Git対象外）。対象commitと統合後の再確認はPRの検証欄へ記録する。索引はnode docs/roadmap/web-migration-audit.cjs --checkで照合する。
