# P3: Project・ArtifactとWeb shellの実行計画

Status: Accepted / P3実装・ローカル受入完了（2026-10-08）。統合は親PR #344で刷新branchへ行う。

## 前提と目的

親Issue: [#334](https://github.com/dommyttdev2/comfyui-batch-studio/issues/334)。P2親PR #323のsquash統合053cd134920a573179bb99072545b3cd977f0021を起点とする。P2の[独立server契約](../architecture/web-server-foundation.md)に、P1のProject/Workflow use caseと実永続化、新Web presentationを接続する。[移行計画](web-migration-plan.md)のP3/G02/G03/G05部分を完成させる。

Project表示はブラウザの別tabではなく、[画面内Projectタブ](web-workspace-tabs-plan.md)。Civitai Explorer/R2 Browser等はShell直下の大型モーダルへ配置する。P3はこのUI/context境界を実装し、実ツール機能の受入はP5、画像PickerはP7と分ける。

## 管理・branch・PR

- P3統合branch: codex/web-p3-334-project-workspace。
- 親draft PR [#344](https://github.com/dommyttdev2/comfyui-batch-studio/pull/344)のbase: codex/web-migration。計画差分で先に作成し、実装・受入が揃うまでdraftを保持する。
- 子branch: 最新P3統合commitからcodex/web-p3-<子Issue番号>-<topic>。
- 子PRのbase: codex/web-p3-334-project-workspace。依存IssueのPRをsquash統合してから着手する。
- 全P3受入後、親PRをreadyにして刷新branchへsquash merge。mainへは出さない。
- 刷新/P3向けCIを追加しない。子PRと親PRにローカル実行コマンド、対象SHA、結果、未検証範囲を記録する。
- 通常実装のためversion変更・releaseなし。後方互換・マイグレーション・fallback禁止。

## 子Issue・所管・依存

| Issue | 排他的な主責務 | 所管 | 依存 |
| --- | --- | --- | --- |
| [#335](https://github.com/dommyttdev2/comfyui-batch-studio/issues/335) Project・Workspace・保存イベント契約を確定する | Project/root/asset DTO、mutation/revision/lease、domain event/outbox、Workspace/Project/Modal context、phase間API境界を正本に定義する。 | W01/W02/W03 | P2 |
| [#336](https://github.com/dommyttdev2/comfyui-batch-studio/issues/336) Project登録・作成・選択とroot認可を実装する | P2 ProjectRegistryを公開use caseへ接続する。管理者が許可したroot内の新規作成/登録、canonical alias、Project一覧/Open、認可付与のatomic性とsession更新を扱う。browserから任意filesystem探索を許可しない。 | W01/W03/W10 | [#335](https://github.com/dommyttdev2/comfyui-batch-studio/issues/335) |
| [#337](https://github.com/dommyttdev2/comfyui-batch-studio/issues/337) Project永続Repository・編集lease・CAS・outboxを実装する | web-project/1のみを扱うProjectRepository/Transaction、project lock、atomic state+domain event commit、durable outbox配信を実装する。lease取得/更新/解放/失効とserver clock、読み取りと編集権限を分離する。P2 job.changedにProject domain eventを安全に追加する。 | W03/W10 | [#335](https://github.com/dommyttdev2/comfyui-batch-studio/issues/335)、[#336](https://github.com/dommyttdev2/comfyui-batch-studio/issues/336) |
| [#338](https://github.com/dommyttdev2/comfyui-batch-studio/issues/338) Artifact編集・保存・確定・reset APIを接続する | ProjectUseCasesのread/beginEdit/saveDraft/confirm/resetとモデル・PromptPlan手動編集を実Repositoryへ接続する。schema検証、下流stale、確認fingerprintと破壊操作の再照合、draft/historyを提供する。 | W01/W03 | [#337](https://github.com/dommyttdev2/comfyui-batch-studio/issues/337) |
| [#339](https://github.com/dommyttdev2/comfyui-batch-studio/issues/339) Compiler・Template・scope付きassetを接続する | WorkflowUseCases、CatalogRepository fixture、Template/Manifest/Digest portを実server adapterへ接続する。登録resourceとProject asset IDからのみ解決し、認可・realpath/型/サイズを検査する。Workflow/provenanceをrevision/eventとcommitする。 | W01/W03/W05 | [#336](https://github.com/dommyttdev2/comfyui-batch-studio/issues/336)、[#337](https://github.com/dommyttdev2/comfyui-batch-studio/issues/337)、[#338](https://github.com/dommyttdev2/comfyui-batch-studio/issues/338) |
| [#340](https://github.com/dommyttdev2/comfyui-batch-studio/issues/340) 独立Web entry・API client・認証とevent接続を実装する | Electron不要のWeb build/dev/startと同一origin配信を用意する。login、cookie/CSRF、API/build ID、request ID、error/reload UX、共有HTTP/WS clientとscope別event routingを実装する。 | W01/W02/W10 | [#335](https://github.com/dommyttdev2/comfyui-batch-studio/issues/335)、[#337](https://github.com/dommyttdev2/comfyui-batch-studio/issues/337) |
| [#341](https://github.com/dommyttdev2/comfyui-batch-studio/issues/341) 画面内Projectタブ・editor保存・draft回復を実装する | Home固定tab、create/Open/重複選択、並べ替え、Project別store、工程/editor/scroll/Pane配置、flush transaction、close/明示破棄、最後の有効Project1件復元、未送信draft revision照合、全job一覧を接続する。 | W02/W03 | [#338](https://github.com/dommyttdev2/comfyui-batch-studio/issues/338)、[#340](https://github.com/dommyttdev2/comfyui-batch-studio/issues/340) |
| [#342](https://github.com/dommyttdev2/comfyui-batch-studio/issues/342) 共通Modal Host・ツールと選択contextを実装する | Shell直下の大型モーダル、tool別UI store、管理/Project選択モード、起点Project/slot/revision/世代、1主modal+1確認dialog、focus trap/inert/Escape/復帰を実装する。Civitai/R2/Vast.ai導線とP5/P7 adapter接続点を用意する。 | W02/W01 | [#335](https://github.com/dommyttdev2/comfyui-batch-studio/issues/335)、[#340](https://github.com/dommyttdev2/comfyui-batch-studio/issues/340)、[#341](https://github.com/dommyttdev2/comfyui-batch-studio/issues/341) |
| [#343](https://github.com/dommyttdev2/comfyui-batch-studio/issues/343) P3統合受入・仕様と調査索引を更新する | 全子成果の実Web統合、local test登録、Windows/Linux disk/path/API/build、Chromium E2E、1/5/10 tab応答/メモリ・listener検証、正本/全コード索引と対象SHAを記録する。 | W11/W12/W14 | [#335](https://github.com/dommyttdev2/comfyui-batch-studio/issues/335)、[#336](https://github.com/dommyttdev2/comfyui-batch-studio/issues/336)、[#337](https://github.com/dommyttdev2/comfyui-batch-studio/issues/337)、[#338](https://github.com/dommyttdev2/comfyui-batch-studio/issues/338)、[#339](https://github.com/dommyttdev2/comfyui-batch-studio/issues/339)、[#340](https://github.com/dommyttdev2/comfyui-batch-studio/issues/340)、[#341](https://github.com/dommyttdev2/comfyui-batch-studio/issues/341)、[#342](https://github.com/dommyttdev2/comfyui-batch-studio/issues/342) |

依存順は契約→Project登録→Repository→Artifact→Compiler、Repositoryのevent契約→Web client→タブ→Modal Host、最後に全体受入。Web clientはCompilerの完了を待たずに着手可能。shared contract/package/lock編集は一つの担当branchに集約し、未merge実装を隠れて参照しない。

## 契約と実装境界

| 対象 | 正本・責務 | P3で確認する境界 |
| --- | --- | --- |
| 業務判断 | src/application/project-use-cases.ts、workflow-use-cases.tsとsrc/domain | Artifact検証・意味変更/stale・compile判断をUI/routeに再実装しない |
| 物理保存 | ProjectRepository/Transactionのserver adapter | Project排他、CAS、state/event atomic commit、durable outbox。P2 job.changedだけでProject変更配信済みとしない |
| Project/root | P2 ProjectRegistryの拡張と新作成・認可use case | 管理者登録root内のみ。canonical IDでalias重複排除。新規IDへの認可付与とregistry作成の整合 |
| browser編集lease | server actor/sessionとserver clock | acquire/renew/release/expire。生成資源lockとは別。clientのtab ID/時刻を認可根拠にしない |
| Template/asset | 登録resource、scope付きasset IDとserver adapter | 任意pathを公開しない。realpath/型/サイズ/権限を再検証。画像加工はP7 |
| 共通transport | 独立Web entry、HTTP/WS client | same origin、cookie/CSRF、build mismatch、request/project/revision、Project eventとjob routing |
| presentation | Workspace/Project store、editor、Pane、Modal Host | 選択外Projectにも対象別適用、起点/世代捕捉、flushと競合UX、focus/inert、状態保持 |

新形式はweb-project/1のみ。旧schema欠落を補完しない。Project作成時に未知IDを事前grantしなければ作成できない循環は、管理者操作とauth更新の契約を#335で決め、#336で原子的に実装する。任意rootを一般browser clientに登録させない。

Repositoryのatomic outboxとP2 EventBrokerを接続する際は、重複配信を識別するevent ID/revisionと永続cursorを契約化する。stateだけ保存できてeventが欠落する境界を検証し、旧APIやsnapshotへの自動fallbackで隠さない。request再送で二重確定/reset/compileしない契約も#335で定義する。

未送信draftのbrowser退避はuser/Project/schema/revisionでscopeを分ける。再認証後の権限確認、保存期間/容量/破棄、競合回復を#335で確定する。beforeunloadで保存成功を保証しない。初期再読込は最後の有効Project1件だけを復元する。

## 後続phaseとの境界

- P3のAssistantPaneは配置・Project別UI stateと接続口まで。実会話/task/models/historyはP4。
- 全job一覧と非表示/閉じたProjectへのroutingはP2実serverと登録fixture jobで検証する。実Run/AI/R2転送の継続はP4/P5/P6でも再受入する。
- Civitai/R2/Vast.aiはモーダル導線・state・context・accessibilityまで。実管理/検索/転送はP5。未登録機能は明示利用不可とし、製品経路でfake成功を返さない。
- Model/画像Pickerのcontext接続口はP3。実選択・外部model確認はP5、画像Picker/codec/Canvas/PSD/MarketplaceはP7。
- Compilerはcatalog fixtureと登録TemplateでP3受入。実catalog/R2 availability/PreflightはP5、生成はP6。
- 新Web実行経路はElectronを参照しない。旧Desktop全経路・依存・test撤去はP9。P3向け仕様を確定しても未移行機能の現行Active仕様を消さない。

## ローカル検証・完了条件

1. 空の新dataDirからlogin、新Project作成/Open、基本設定→モデル→PromptPlanのedit/save/confirm/reset、fixture compileを実disk/API/browserで通す。
2. 同一root別名、symlink/junction/UNC/大小文字、別Project/偽root/asset traversalをWindows/Linuxで確認する。権限変更/失効session/lease、二重client/CAS、request再送を検証する。
3. 保存とoutboxの途中障害、server crash/restart、重複配信/順序/replay不足を検証し、成功を偽装しない。
4. A/Bの工程/draft/scroll/Pane stateを隔離。flush失敗/409で切替・close保留、明示破棄、draft競合回復、最後の有効Project1件復元を検証する。
5. jobはtab切替/close/request切断で停止しない。遅延応答・event・取消済modal結果を別Projectに適用せず、閉じたtabを勝手に再作成しない。
6. Modal Hostのfocus trap、inert、Escape最前面、focus復帰、管理/選択mode、狭幅とキーボード、close/reopen stateを検証する。
7. Chromiumの実browser E2EをP3で開始し、Electron不要のWeb build/startをWindows/Linuxで確認する。1/5/10 tabの応答/メモリ、listener/timer cleanupを同条件で記録する。実画像memory gateはP7。
8. core/P2回帰・依存禁止検査・server/Web typecheck/build、索引--check、契約/正本対応表を確認し、全子Issue完了後に親PRをreadyへ変える。

実装・受入の証拠は[P3受入matrix](../quality/web-p3-acceptance.md)、起動・復旧は[Web Workspace運用](../operations/web-workspace.md)を参照する。

## #335 契約確定

Project/root/asset、lease/CAS/操作再送、atomic outbox/event、Workspace/Modal/draftの正本は[Web Project・Workspace契約](../contracts/web-project-workspace.md)。受入境界は[P3受入matrix](../quality/web-p3-acceptance.md)。P2 job-only eventとlease取得のみの実装との差分を明示し、#336–#343へ割り当てた。これは契約確定であり、P3製品機能の実装完了ではない。

## 実装PRの対応

- #335: [PR #345](https://github.com/dommyttdev2/comfyui-batch-studio/pull/345)。
- #336: [PR #346](https://github.com/dommyttdev2/comfyui-batch-studio/pull/346)。
- #337: [PR #347](https://github.com/dommyttdev2/comfyui-batch-studio/pull/347)。
- #338: [PR #348](https://github.com/dommyttdev2/comfyui-batch-studio/pull/348)。
- #339: [PR #349](https://github.com/dommyttdev2/comfyui-batch-studio/pull/349)。
- #340: [PR #350](https://github.com/dommyttdev2/comfyui-batch-studio/pull/350)。
- #341: [PR #351](https://github.com/dommyttdev2/comfyui-batch-studio/pull/351)。
- #342: [PR #352](https://github.com/dommyttdev2/comfyui-batch-studio/pull/352)。
- #343: 統合受入・復旧CLI・独立Web境界・Docker Chromium・正本/索引更新。

P3の製品経路はsrc/web（presentation）、src/server（HTTP/WS・実IO）、src/application/src/domain（業務判断）に分離済み。P4へ進む。
