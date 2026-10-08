# P4受入matrix

Status: Accepted / G04ローカル受入完了（2026-10-08）。親Issue [#354](https://github.com/dommyttdev2/comfyui-batch-studio/issues/354)、親PR [#364](https://github.com/dommyttdev2/comfyui-batch-studio/pull/364)。[契約](../contracts/web-agent-runtime.md)、[管理計画](../roadmap/web-migration-p4-plan.md)、[運用](../operations/web-agent-runtime.md)を参照する。

## 要求・実装・検証の対応

| ID | 要求境界 | 主実装 / 子Issue | 検証と結果 |
| --- | --- | --- | --- |
| A01 | 固定CLI登録・認証/models/protocol、未設定拒否 | agent-registration/agent-cli-runtime / #356,#360 | 両実CLI、container引数、後続Project登録との重なり拒否。PASS |
| A02 | model/reasoning能力、CAS/lease、provider別設定 | P1 AgentPreferences、agent-api / #357,#360 | 宣言外effort拒否、CLIへ設定伝達、server再起動後保持。PASS |
| A03 | user/Project/工程/provider別会話、公開/私有ID分離 | agent-store、CLI parser / #357,#356 | 永続history/new/restore/resume、別scope/owner拒否、壊れた関連/重複ID/上限拒否、reasoning非公開。PASS |
| A04 | 外部await前の共通chat/task排他、durable idempotency | jobs/agent-runtime / #358 | availability保留中のdisk reservation、並行開始拒否、同key同job/変更競合。PASS |
| A05 | HTTP/WS/closeと実行寿命の分離 | agent-api、Workspace/AssistantController / #360,#361 | Chromium close後の継続/再Open、応答喪失時の同key照合。P2のsnapshot/replayと単一WSを共有。PASS |
| A06 | crash後uncertain、自動再launch禁止、明示照合/破棄 | jobs/agent-runtime、既存lock復旧 / #358,#360 | 実server processをSIGKILL、dead lock照合後のuncertain・開始拒否・明示破棄。fixture CLIでPASS |
| A07 | 全job container停止の確認、force後late output拒否 | DockerAgentAdapter、agent-runtime / #356,#358 | 両実CLI stop、force時uncertain・後着本文fence。PASS |
| A08 | 確認済み入力snapshot・参照copy・P1 task planner再利用 | P1 AgentTaskUseCases、agent-runtime / #358 | core planning/policy回帰、fixture/両実CLI story-finalizeの出力とdraft取り込み。PASS |
| A09 | artifact許可名/通常file/path/size/hash/session/turn | agent-artifacts / #359 | 空/巨大file・hardlink・alias・逸脱・改変hash・session不一致拒否。Windows/Linux/実CLI file出力でPASS |
| A10 | import時の現行grant/revision検査、競合時非上書き | P1 ProjectUseCases、agent-artifacts / #359 | 権限取消中の実行をfixtureで検証、revision/hash/別user拒否。PASS |
| A11 | draft/event/receipt原子保存、二重import防止 | ProjectRepository/P1 import / #359 | 同job再取り込みは同revision/receipt、確定Artifact非変更。実APIでPASS |
| A12 | presentationと業務判断/OS IOの分離 | src/web、application/domain、src/server / #355–#361 | core/server/Web boundary check、独立Web imageにElectron binaryなし。PASS |
| A13 | tab/工程/provider入力、世代、flush、共通Modal | assistant.ts/assistant-pane.tsx、Workspace / #361 | Chromium scope切替、遅延世代、flush失敗、close、認証失効、共通Modalを既存P3回帰込みでPASS |
| A14 | credential以外のhost情報をmountしない | Dockerfile/adapter / #356,#362 | 固定mount引数検査、ホスト側sentinel不可視、容器非root/read-only root。両実CLIでPASS |
| A15 | 全コード索引と正本の一意所管 | audit/plan/契約/運用 / #363 | code/config 503、source 347、tests 108、scripts 17、IPC 172、resource 8。MECE索引check PASS |

## 実行記録

製品source最終変更は3bc934c6a8cac5e4b996c5351fb982327d95b108。受入branch最終SHAは8516141987a706e2f2530c356541616824b6ecbaで、その後の変更はmodel/force受入testと索引だけ。PR #372のsquash統合ddb3bfdeddacbf6dd689c540075014a99c2531f5は同じtree。親PRの最終統合commitはGitHub PRを正本とする。

| 実行環境 | command / 対象 | 結果 |
| --- | --- | --- |
| Windows、Node 24.16.0、NTFS | test:agents(16)、test:server(18)、test:projects(11)、test:core(102)、test:web(Chromium 156 / 18) | 全165件PASS。typecheck/typecheck:web/check/索引check PASS |
| Docker Desktop Linux、Node 22.12.0、Chromium 156、Electron binaryなし | web-local-test full suite、9fd8db9 source image。8516141の追加force test fileだけをread-only mountしてtest:agentsを追加実行 | 既存164件と追加force test PASS、agent全16件PASS。typechecks/check/索引PASS |
| Docker Desktop local-test target | Docker化した既存npm testとElectron/image回帰 | exit 0。61登録test fileと既存追加検証を完了 |
| Windows server → 固定Linux CLI容器 | test-web-agent-api-real.mjs、3bc934c source | Codex/Grokの実auth/models/chat/同key/resume/story-finalize/draft/stop、両方PASS |
| 固定Linux CLI容器 | test-web-agent-real.mjs | Codex/Grokの実file生成・host mount不可視・stop、両方PASS |

CLI image ID: sha256:0ec832945a8c543d07cfe7a9040bcd024102955b332b88d4b5c9df5956633a68。Codex 0.155.1 / Grok 1.0.46 (2765805b9442)。Grok binary SHA-256: 41626a53292324140b92556b9d42ff5542e3dcd04aff85eafb8689dd4adb44fc。既存host CLIログインのauth.jsonを明示使用し、内容・token・CLI履歴をGitへ保存していない。内側sandboxはユーザー承認済みのCodex danger-full-access/Grok offを固定指定し、Dockerの非root/read-only root/mount制限を維持した。

checkの4件の未使用変数warningはP3以前から存在するDesktop/test箇所。Docker Desktop baselineのDBus診断もexit 0の既存headless検証出力。検証成功と無警告を混同しない。CIを追加/実行条件変更せず、main/version/release変更も行っていない。

## 検証範囲と後続phase

実CLIは両providerのstory工程で受け入れた。models/Prompt Plan/captionの業務policyはP1/core回帰、API/task接続は明示fixtureで検証する。実Civitai/R2 catalogとresource操作はP5、ComfyUI/SSH/Vast.ai/Remote worker/実生成はP6、image/PSD後工程はP7、LAN/TLS/配布の完成はP8の範囲。P4の成功からそれらの実機E2E成功を推定しない。

server crashと権限取消、force late outputは実process/fixtureで再現した。動作中の実CLI容器を残す停電やOS/Docker強制停止、NAS/共有drive、全障害組合せ、Linux host serverからDocker daemonを操作する実CLI経路は未検証。今回はWindows serverとLinux CLI容器、Linux server/Chromium fixture受入を組み合わせた。未知結果はuncertainを保持し、fallback・互換変換・自動再実行で隠さない。
