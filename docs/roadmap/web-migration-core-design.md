# P1 業務coreの境界と受入

P1は[移行計画](web-migration-plan.md) 3.1/3.2に従う実際の業務規則をdomain/applicationへ移し、新Web版の業務入口を `src/application/core.ts` に用意する段階である。HTTP起動やWeb画面、実サービス接続の完成とは区別する。主担当W10、関連W01/W03/W04/W06/W09/W12、受入はG10の層分離部分。[Issue #305](https://github.com/dommyttdev2/comfyui-batch-studio/issues/305)で管理する。

## 四層と依存方向

| 層 | P1で確定する責務 | 接続段階 |
| --- | --- | --- |
| presentation | actor/session解決、DTO検証、表示・確認画面、通信errorへの変換。業務判断はapplicationへ送る | HTTPはP2、Stage/画面はP3以降 |
| application | Project/Artifact操作、認可・lease/CAS・編集guard、Workflow生成、Preflight、Run作成・復旧・停止、AI予約と開始、確認tokenの再照合 | src/application、P1で単独実行可能 |
| domain | Artifact/カタログの検証、モデル更新と生成入力比較、Prompt生成、Workflow graph、Run判断と証拠検証、caption検証/描画、画像画素処理・メモリ予算 | src/domain、P1で単独実行可能 |
| infrastructure | transaction/CAS/outbox、CLI/runtime、確認tokenの原子的消費、SecretStore・ImageCodec・asset解決 | P1はtests/core-supportのfake、実実装は各機能phase |

依存はapplicationからdomainだけ。coreはNode標準module、React、Electron、HTTP、旧src/main・shared/typesをimportしない。ClockとIdSourceも注入する。tsconfig.core.jsonはES2022のみ、Node/DOM型なしでcompileする。境界検査はtype-only import/re-export、dynamic import/require、platform symbolも拒否する。

## 現行の混在箇所から切り出した責務

| 現行の調査参照 | 新版で判断する場所 | presentation/インフラへ残す責務 |
| --- | --- | --- |
| main.ts ensureProjectWritable、App.tsx閲覧専用判定 | domain/execution-policy、application/project-access | snapshot表示、scope解決、Run読出 |
| main.ts stopRunForExit、runRequiresExitGuard、Execution IPC | domain/execution-policy、application/execution-use-cases | ComfyUI/SSH/Vast.ai実呼出、worker終了待ち・外部状態照合 |
| main.ts confirmRunStopBeforeLeave、EXECUTION_LEAVE | application/project-use-cases.leave | Web画面離脱・Project切替は停止しない。server shutdownはP2/P6で別管理 |
| artifact-service.ts、Project/Grok/PromptPlan Stageの保存・確定 | domain/artifact-policy、application/project-use-cases | カタログ読出とphysical repository。canonical validationはcoreが実行し、画面の補助validationは受入根拠にしない |
| use-editor-autosave.tsの時刻採番、画像storeのrevision補完 | application/project-access/project-use-cases | debounce・未送信draft・保存表示。新版revisionはserverが発行 |
| agent-conversation-runner.ts、Assistant IPC/Pane | application/agent-use-cases | provider選択実装、CLI launch/停止、history永続化・event配信 |
| RENT/削除/SSH trust/Run破棄/backup/editor復元のdialog | domain/confirmation-policy、application/confirmation-use-cases | 条件取得、確認画面、外部操作とjob所有権 |
| image-size-limits.ts、image-pipeline.ts、設定store | domain/image-policy、application/platform-ports/platform-use-cases | 選択済codec、SecretStore、認可済asset解決。失敗時の代替経路なし |
| validation.ts / model-catalog.ts / caption-service.ts | domain/artifact-validation・catalog-validation・caption-policy、domain/canonical-artifact | ファイルとカタログの読出。新coreはModels v5 / PromptPlan v2 / Caption v2のみ受付 |
| GrokStages.tsx saveBase / saveManualSelection | domain/model-editing、application/project-use-cases.configureModels / replaceModels | 選択操作と表示。新版の更新判断はserver transaction内で行う |
| compiler.ts / image-tasks.ts / workflow-api.ts | domain/workflow-compilation・workflow-graph・image-tasks・prompt-policy、application/workflow-use-cases | Template読出、SHA-256、保存。生成入力の再検証と結果/event commitはapplication |
| execution-run.ts start / main.ts persisted recovery | application/execution-creation・execution-recovery、domain/execution-policy・execution-evidence・execution-resume | snapshotコピー、Queue/History照合、外部資源所有権とWorker操作 |
| preflight.ts / availability.ts / model-placement-paths.ts | application/preflight、domain/availability-policy・model-placement | ファイルの存在と内容、配置情報、hashの取得 |
| image-pipeline-core.ts EXIF適用 / Lanczos / 白背景合成 | domain/image-pixels | 画像containerの解析、codec、Bufferとbyte arrayの境界 |

今回の再調査では、上記の入口だけでなく、入口から呼ばれる実際の処理とportの戻り値を確認し、次の責務も切り出した。

| 再調査した工程 | coreへ移した実処理 | 残るIO・表示 |
| --- | --- | --- |
| Local/Remote生成と復旧 | application/local-execution-runtime・remote-execution-runtime・local-output-verification・remote-instance-lifecycle・execution-coordinator、domain/execution-snapshot-capture・execution-workflow-policy・local-output-policy・execution-mutation-policy・execution-finalization-policy・remote-progress-policy | HTTP/SSH/R2/Vast.ai呼出、ファイル実体の読出・保存、process起動、取得bytesのhash算出 |
| Run作成・再開・Preflight | application/execution-creation・execution-resumption・preflight、domain/remote-target-policy。送信意図、snapshot入力identity、モデル配置、Remote接続条件、出力数と証拠の判断 | 生の接続設定・instance観測値・配置情報・Queue/History・出力metadataの取得 |
| AI工程task・会話設定・取込 | application/agent-task-planning・agent-task-use-cases・agent-preferences-use-cases・project-use-cases、domain/agent-task-policy・agent-state-policy・agent-artifact-policy・prompt-plan-patch-policy。予約順序、保存済みモデル選択、セッション所属、入力本文/指紋/revision、取込dedupと下書きのatomic更新 | CLI固有引数、workspaceファイルへの出力、provider protocol、durable job/session store |
| モデル確定・LoRA再選定・工程reset | domain/model-draft-policy・model-reset-policy・brief-impact-policy、application/project-use-cases。補助タグの保存と意味比較、初回選定の復元、基本設定の変更影響 | カタログ取得、旧履歴ファイルの読出とbackup保管 |
| Caption・最終成果物・画像出力 | application/output-use-cases・marketplace-generation・thumbnail-output-generation、domain/caption-build-policy・caption-import-policy・final-artifact-policy・marketplace-generation-policy・output-tracking-policy。入力/出力指紋、Pixivタイトルの独立性、生成manifest commit、入力変更検出、追跡済み旧出力だけのcleanup | asset/画像bytes取得、画像codec、ZIP container encoding、ファイルのatomic保存・削除 |
| 画像編集と描画 | domain/thumbnail-editor-policy・thumbnail-layout-policy・thumbnail-render-policy・marketplace-editor-policy・marketplace-crop-policy・image-size-policy。editor構造、crop/配置/文字/描画手順、サイズ制限 | Canvas/画像decodeの具体実装、drag/zoom/選択操作、表示 |
| 共通純粋規則 | domain/execution-progress・r2-storage-policy・text-policy・time-policy。進捗/ETA、storage key、UTF-8サイズ、日時書式 | Clock/ID/乱数/ハッシュの実装、タイマーとbyte container |

旧main/IPC/StageはP0の調査参照として残る。新coreから到達しない。既存呼出は移動した純粋関数を参照し、同じ規則の再実装を減らす。新Webのuse caseを旧IPCへ接続する互換adapterは作成しない。旧transport/UIはP9で撤去する。

## 新command/result/eventの契約

- actorはserverが認証したuser/session/request、許可Project IDとpermission。clientのroot/sender kindを権限にしない。
- Projectはweb-project/1だけを扱い、revision、lease、artifacts、drafts、runsを明示する。欠落・旧形式・未知Run状態はerror。旧stateを補完しない。
- read、acquireLease、beginEdit、saveDraft、confirm、resetはProject IDを使う。更新はexpectedRevisionとleaseIdが必須。下書き保存で確定済みArtifactを上書きせず、確定はtransaction内で再検証する。確定では生成入力が変わった下流だけをstaleにする。モデルのreasonやカタログgenerationだけの変更では下流を維持する。resetは下流をstaleにする。
- transactionはProject排他、CAS、revision増加と業務eventのatomic commitを所有する。eventにはproject/user/session/request/subject/revisionを付ける。実outbox配信のsequence/replayはP2で実装する。
- Workflow生成は確認済みモデル/PromptPlanと現在のカタログを再検証し、Template/ManifestとSHA-256を確認して生成する。graphと入力provenanceをProject revision/eventと一括commitする。
- Run作成はProject排他の中でPreflight前後とsnapshotコピー後の入力identityを照合する。コピー中の変更では仮snapshotを削除し、Runを公開しない。復旧は送信意図、外部Worker、検証済み証拠から判断し、応答不明の状態を安全な停止に置き換えない。
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
- [x] 実際のモデル/PromptPlan/Template fixtureでcanonical validation、モデルidentity競合、下流reset条件、Workflow生成、Preflight、Run作成/復旧、captionと画素処理を検証。
- [x] validator/start/recoveryを丸ごと外部portへ委譲せず、業務判断をcoreで実行。
- [x] WindowsとDocker/Linuxでcore検証・型検査を実行し、既存Node回帰も通過。
- [x] 新fileの主担当と層、core-local test経路を調査索引へ登録。

G01-G14全体の機能受入は完了扱いにしない。HTTP/認証/Origin/CSRFはP2、登録済みProjectと実永続化・新画面からの操作接続はP3以降、実CLIはP4、実Secret/外部clientはP5、実生成はP6、実codecはP7、browser E2EはP8で検証する。既存Node回帰は抽出の影響確認に使う。旧Desktopの実操作・全app build・実外部接続は未検証。通常実装のためapp versionは0.82.0を維持する。

## ローカル検証

Windows: Node v24.16.0。境界検査、Node/DOM型なしのcore compile、domain 5件・業務38件・実fixture 41件（計84件）が通過。failure/cancel/skipは0。

Docker/Linux: Node v22.12.0。npm run test:core（84件）、npm run typecheck、npm test、npm run checkを実行。checkの6 unused-variable警告は既存codeだけで、errorなし。実サービス接続やdisk durabilityの受入を、この結果から推測しない。

Date.parseによる既存入力日時の検証は純粋な検証として許可する。現在時刻の取得（Date.now / new Date）と乱数はportから注入し、禁止依存検査で直接取得を拒否する。domain型の移動は業務データ定義の共有であり、旧Project/Electron APIの互換読み込みを新Webの入口に追加しない。

検証logは作業ツリーのp1-separation-linux.log（Git対象外）。Windowsのcore結果は実行出力に記録。索引はnode docs/roadmap/web-migration-audit.cjs --checkで照合する。

## 再調査の範囲と結果

Project/Artifact、モデル/Compiler/Preflight、Run生成・停止・復旧、AI会話/task/取込、Caption/Thumbnail/Marketplaceを対象に、旧呼出元・抽出先・port契約・回帰テストを照合した。単にcoreから旧moduleを呼ぶ経路や、インフラからREADY/検証済みの判定だけを受け取る経路を見直し、実際のアルゴリズムと入力条件をdomain/applicationへ移した。最後の再調査では、この範囲で追加の分離漏れは見つからなかった。

生成runtimeやsnapshotコピー・復旧のportには複数のIOをまとめた操作もある。これらの具体adapterは、抽出済みのsnapshot検証・Local出力検証・Remote runtimeを呼び、物理pathの解決、bytesの取得、保存と外部client接続を受け持つ。portの型だけを根拠に実装完了とはしない。新Web側の永続化と実runtime adapterを接続するphaseでも、この責務分担と不確定結果の契約を再検証する。

既存DesktopのCaptionでは相対/絶対pathの正規化をadapterに残し、旧Workflowのモデル入力hash契約も維持した。新Webのresource IDにOSのpath処理を導入せず、新Preflightでは補助タグを含む現行入力provenanceを検証する。相対path設定の変更と補助タグmetadataを持つ既存Workflowの回帰も検証した。
