# 業務ロジック分離の実装・再検証

PR #309 HEAD `a6a6b726e33cfaf9dbec00ea7faedc97a2a3045b` を基点とする `codex/pr309-business-separation` の変更。旧Desktopに残してよいという除外は設けず、確認済みの17規則群とsnapshot契約1群をcoreへ移した。追加探索で見つかったArtifact/Caption/AIランナー/Workflow/検索/復旧/下流リセットの判断も移した。

## 完了判定と範囲

今回の台帳・候補・実入口比較で**未解消と確認した業務分離漏れは0件**。coreはdomain/applicationだけに依存し、Mainはファイル・CLI・SSH・HTTP・SDK・Windowの実装を接続する。入口の型検査、実パスの安全性、providerプロトコル、キャッシュ管理、表示用条件はadapter/presentationに置く。

これは全動的経路・全関数の意味の数学的証明ではない。外部サービスの実課金・実AI・Browser E2Eは実行していない。161入口は静的追跡の全数であり、161操作の全分岐を実サービスで実行した数ではない。以前の未実行scenarioセルは実行済みに数えない。

## 再調査

変更前の固定snapshotを保持し、実装後はseparation-02～10で同じAST・型付きcall signature・字句callback包含・非IPC母集団の保持を繰り返した。初回iterationの失敗も上書きせず保存した。

- 最終snapshot: 471ファイル（追跡対象＋今回追加した未追跡ファイル）、382 JS/TS、294 srcモジュール、6051 JS/TS関数、4367 src関数。
- 161 IPC登録を一意なhandlerへ対応。1609関数を可能IPC経路で保持し、残る2758関数も非IPC母集団として保持。
- 14399 src call/new、4532本体解決、1444型宣言境界。動的override/注入実装/外部APIは断定せず境界として保存。
- Python 2ファイル80関数、埋込JS 2単位4関数、PowerShell 1ファイル、Shell/Batch 3ファイルも保持。Shell/Batchは字句inventory。
- parse error 0、core import違反0。残候補73件はcandidate-review.jsonに一件ずつ判定理由を記録。候補点数だけを分離漏れや完了判定に使用しない。
- source SHA-256: `ea2337c11efde7fe83e9dbeef4adbbc04fa26606b2edf43e21217cab43dbb7ae`。親PRのHEADと変更後の解析bytesを区別し、全inventoryのhashを作業ツリーと再照合した。

## 修正の対応

| 元の指摘 | coreで所有する判断 |
| --- | --- |
| F01 | Remote準備の順序、source SHA/ETag/sizeの一致、再利用、pause/failure |
| F02 | 観測済みモデルとreasoning能力の照合 |
| F03 | 現documentと追跡manifestによるThumbnail sourceの採用 |
| F04–F05 | Local unknownからの停止、offline確認と安全なdiscard |
| F06 | snapshotのsource binding、永続化後の読戻し一致、失敗cleanup |
| F07–F11 | 再照合、stop/interrupt rollback、finalize retry、instance交換、再実行 |
| F12 | Civitai統計、例の選別、所属差分 |
| F13 | PAUSED Remoteの編集停止と課金停止の実行 |
| F14 | R2 copy成功後delete、resume/source検証、pause/cancel/drain |
| F15 | Vast容量/offer採用、再確認後RENT、SSH準備順序 |
| F16–F17 | template更新と上限、credential identityと保存順序 |
| F18 | 起動拒否と受理不確定の区別、起動/背景task失敗の状態永続化 |

追加: Artifactの取込/確定/編集/Project作成、Caption生成とstale判定、AI工程対応と取込先、会話/CLIの開始再開と完了後取込、履歴の重複更新と上限、明示復旧、editor CAS、Thumbnail document削除、Workflow provenance、所在/検索/履歴、手動resetと下流archiveをcoreへ移した。

AI開始の予約は最初のawaitより前に取得し、失敗時に解放する。会話とタスクは共通のAssistantCommandsで直列化し、開始中・生成中の別操作、session切替、モデル変更を拒否する。モデルの利用可能性を観測してから保存し、拒否された選択は書き込まない。Thumbnail削除はrevisionと選択を先にcommitしてから物理cleanupし、失敗は警告として返す。legacy uploadのfingerprintを自動採用せず、provider設定も旧形式を自動移行しない。

## 検証

最終Linux runnerは終了コード0。npm testの既存61テストファイル、追加Grok CLI 2テストファイル、コア102テスト（既存84＋追加18、失敗0・skip 0）、typecheckが成功。Windowsで実行不能だったPython fcntlとfile symlinkの経路も含む。Renderer/Electron build、変更139ファイルのformat/lint、git diff --checkも終了コード0。製品buildはag-psdのutil externalization warningを出すが成功。実行コマンド・ログのSHA-256はexecuted-verification.jsonに記録した。

機械的な詳細は元ワークスペースの `review-artifacts/pr309/iterations/separation-10/` に保持する: analysis.json、files/functions/ports.csv、operation-ledger.json、operation-route-traces.json、typed-call-edges.json、non-ipc-function-roots.json、embedded-audit.json、candidate-review.json、finding-resolution.json、completion-evidence.json。台帳の担当/将来phaseは分離不足の除外理由にしていない。

## 正本索引の再照合

2026-10-08、PR #310で追加したcore 61ファイル、Mainのruntime接続、core-separationテスト、THUMBNAIL_DELETE_DOCUMENTを正本の監査ツールに登録した。テストはcore-local、削除操作はW09/G09のcommandとして扱う。共有型・template規則は主担当を一つにし、横断する検証gateはtest側に記録した。

`node docs/roadmap/web-migration-audit.cjs --write`と`--check`が成功。426コード・設定（src 309、tests 80、scripts 9）、172通信定義（161 invoke・11 notification）、8 binary asset、32仕様文書を別母集団として再照合した。上のAST調査はJS/TS・関数を中心とする別集計であり、この件数と合算しない。正本索引の未登録・hash/行番号の不一致も確認対象とし、別途作成した解析台帳だけで受入完了とは判断しない。

マージ前の別worktree/Linux再検証で、索引に作業場所固有の`.git`参照ファイルが含まれていたことを検出した。監査対象から除外し、OS依存のroot file列挙順もsortで固定して、425コード・設定へ再集計した。製品ソースの変更はなく、同じ索引をWindowsのworktreeとLinuxのGit metadataなし環境で照合した。
