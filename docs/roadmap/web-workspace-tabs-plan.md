# Web版の画面内プロジェクトタブ・ツールモーダル計画

Status: Proposed / 計画のみ（2026-10-08）

## 1. 結論と前提

1つのブラウザ画面にWorkspace Shellを置き、画面上部のアプリ内タブで複数プロジェクトを切り替える。Civitai Explorer、R2 Browser（既存のR2 File Manager）、Vast.ai管理などの共通ツールは大型モーダルで操作する。

ブラウザのタブ増設や別ウィンドウをプロジェクト操作の導線にしない。同時に表示するプロジェクトは1件だが、非表示プロジェクトの編集状態とバックエンド処理は維持する。

ユーザーが完了を報告したビジネスロジック分離を前提とする。ここでは新Web版のpresentation、UI状態、APIへの接続、受入条件を計画する。業務判断をUIへ戻さない。旧Electronとの後方互換、データマイグレーション、旧経路へのfallbackは実装しない。

## 2. 表示と操作

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Home │ Project A ● │ Project B 生成中 │ ＋     │ ツール │ 全ジョブ │
├─────────────────────────────────────────────────────────────────────┤
│ 工程navigation │ 選択Projectの工程画面     │ Codex / Grok Pane        │
│                │                          │ 会話・タスク・履歴       │
└─────────────────────────────────────────────────────────────────────┘
                  ツールから大型モーダルを開く
```

| 対象 | 表示と役割 |
| --- | --- |
| Home | 固定タブ。新規作成、プロジェクトを開く、最近使ったプロジェクト |
| Project | 1プロジェクトにつき1タブ。工程、入力、スクロール、AssistantPane状態を保持 |
| タブ操作 | 選択、閉じる、左右移動、並べ替え。多い場合は横スクロールと一覧メニュー |
| タブの印 | 未保存、生成中、AI処理中、失敗、編集不可を区別。色だけに依存しない |
| Codex / Grok | 各Projectの右Pane。provider、会話、工程context、入力、表示比率を独立保持 |
| Civitai Explorer | app-wideな大型モーダル。検索、Collection、同期、モデル詳細 |
| R2 Browser | app-wideな大型モーダル。bucket、パス、一覧、管理、転送 |
| Vast.ai・サービス連携・環境設定 | 共通のモーダル導線。設定と管理機能の責務は既存仕様を維持 |
| 画像Picker | Projectに属する選択モーダル。確定先を開いた時点のProject・slotへ固定 |
| 全ジョブ | 常時アクセスできる一覧。非表示・閉じたProjectのRun/AI/R2進捗へ戻れる |

新規作成・Openは新しいProjectタブを追加する。「現在のウィンドウ／新しいウィンドウ」の選択は廃止する。同じ登録Projectを再度開いた場合は既存タブを選択する。重複判定は表示名やブラウザ入力のrootではなく、serverがcanonicalizeしたProject IDを用いる。

現行の起動方針を引き継ぎ、初期版の再読込・起動では最後に選択した有効Projectを1件復元する。開いていた全タブの復元は初期版の要件に加えない。他のProjectの実行中ジョブはserverから取得して全ジョブに表示する。未送信draftの回復はタブ一覧の復元とは別に扱う。

## 3. 所有権と状態分離

| 所有者 | 保持する状態 | 終了条件 |
| --- | --- | --- |
| Workspace Shell | 開いているタブ、選択タブ、順序、共通ツールの表示、全ジョブ表示 | UI session終了 |
| Project UI store | Project ID、工程、draft、保存revision、エラー、選択、scroll、Pane比率・表示・会話選択 | 保存・draft回復処理を経たタブclose |
| Tool UI store | Civitai検索条件、R2 bucket/path、選択、scroll | UI session終了。モーダルcloseでは保持 |
| Modal session | tool種類、起点tab ID、Project ID、目的、選択先、世代、閉じた後のfocus先 | 確定または取消 |
| Server | Project/Artifact、編集lease、AI session/task、Execution、R2転送、資源lock | 対応use caseの終了・明示停止 |

タブIDはUIを識別し、Project IDは処理対象を識別する。認可はserverの認証sessionとProject権限で判定し、tab IDだけで許可しない。編集leaseは同じclientがタブを切り替えても維持し、生成資源lockとは分ける。

Project UIを単一の`currentProject`へ上書きして使い回さない。送信時に対象Project・revision・request ID・世代を捕捉し、非同期応答とeventをその対象のstoreへ適用する。現在選択されているタブへ流し込まない。閉じたタブへの遅延応答でタブを再生成しない。

初期構成は、軽いUI storeを全タブ分維持し、重い工程画面・画像・Canvasは選択タブだけ描画する。切替前に必要な編集状態をstoreへ退避し、再表示時に復元する。全Projectの巨大DOM・画像・timerを常時稼働させない。

共通API client/event接続はShell側に置く。選択外のProjectもRun/AI状態を受信し、タブの印と全ジョブを更新する。接続の再確立はWeb移行計画のsnapshot/replay契約に従い、履歴欠落や取得失敗を成功扱いしない。

## 4. 切替・close・処理継続

| 操作 | 保存と画面状態 | バックエンド処理 |
| --- | --- | --- |
| Projectタブ切替 | 起点Projectのeditor flush成功後に切替。失敗・競合なら起点を維持しエラー表示 | Run/AI/R2は継続 |
| 同じProjectの工程移動 | editor flush、工程state退避、既存の工程離脱制約を適用 | Runは継続 |
| Projectタブclose | 保存完了を確認。失敗時はcloseを保留し、明示的な破棄操作を提供 | 処理は継続。全ジョブから再表示可能 |
| ツールモーダルclose | ツール表示stateは保持。未確定のProject選択は取消 | 開始済み同期・転送は継続 |
| ブラウザ再読込／close | 終了イベントで保存完了を保証しない。未送信draftを端末に退避し、回復時もrevisionを検証 | serverが生存する限り処理は継続 |
| Run／AI／転送の停止 | 対象jobを明示して停止操作 | 対応use caseで停止・後処理 |
| server停止 | 別の管理操作として既存の終了契約を適用 | 明示停止とfinalizationの対象 |

タブ切替とprovider切替を混同しない。タブAのAI処理中にタブBを選択しても、Aのprovider・session・taskは変更しない。Aの成果物はAへ取り込み、Bには適用しない。

close時に実行中の処理があれば「処理は継続し全ジョブから確認できる」と表示する。タブのcloseボタンはStopを兼ねない。閉じたProjectを再度開く場合は、serverの最新状態と未送信draftのrevisionを照合する。競合時の自動上書きは禁止する。

同じLocal ComfyUI endpoint、同じVast.ai Instanceの排他、同一Projectのactive Run制約は既存の業務coreを利用する。UIが非表示になったことを理由にlockを解除しない。

## 5. モーダルの契約

- 共通Modal HostをShell直下に置き、AssistantPaneを含む画面全体を覆う。背景のProject編集・タブ操作を無効にし、背景処理は継続する。
- 主ツールモーダルは同時に1件。R2のmove/delete、設定などは内部ページまたは1段の子確認dialogに統一する。多段の無制限stackは作らない。
- 上端にツール名、Project選択用途の場合は対象Project名、close、内部navigationを表示する。大型モーダル内をscrollし、狭い画面では全画面表示する。
- focus trap、背景のinert化、キーボード操作、閉じた後のfocus復帰を実装する。Escapeは最前面のみを閉じる。入力や破壊的確認がある場合は意図しないbackdrop clickで閉じない。
- 管理モードとProject選択モードを明示する。Civitai管理の閲覧だけでProjectモデルを変更しない。Project選択モードでは確定ボタンを押した時だけ対象Projectへ結果を反映する。
- R2のProjectモデル配置確認は既存のread-only用途を維持する。管理操作は管理モードで提供し、serverでも権限を検査する。
- Pickerの確定にはsession ID、Project ID、source、slot、revision/世代を照合する。起点タブのclose・lease喪失・取消後の確定は拒否する。次に選択されたProjectへ付け替えない。
- closeは表示を閉じる操作。アップロード、SYNC、move等の開始済みjobは別に所有し、再度開くと進捗を取得する。保存前の設定form・選択はclose確認の対象とする。
- R2 Browserに既存のローカルfileパス選択をそのまま持ち込まない。Webのbrowser upload/server file選択とstreaming転送契約へ接続する。
- Civitaiモデルページなど外部サイトへの明示リンクは通常の外部navigationを許可する。Projectを別タブで操作する導線とは区別する。

## 6. 既存コードとの対応

調査対象は現在のElectron presentation。ビジネスロジック分離完了の報告を前提に、次の箇所をWeb presentationへ置換・接続する。

| 現在の箇所 | 計画する変更 |
| --- | --- |
| `src/main/main.ts`: `ProjectWindowState`、`projectWindows`、`createProjectWindow`、focus/open/close | Window所有のUI状態をWorkspace/Project UI storeへ移し、backendのProject登録・job所有と分ける |
| `src/main/ipc-registration/project.ts`、`assistant.ts`、`execution.ts` | sender/Windowから対象を推定する呼出を、明示Project IDを持つWeb APIへ接続。認可はserverで判定 |
| `src/renderer/main.tsx` | App/Assistant/standalone toolの独立renderer起動を、1つのWorkspace Shell配下へ統合 |
| `src/renderer/App.tsx` | 単一Project/stateをProject別storeへ分離。タブバー、切替・close transaction、Project content表示 |
| `src/renderer/AssistantPane.tsx` | Window context通知依存をProject contextと共通event storeへ接続。会話入力・stream・providerをProject別保持 |
| `src/renderer/editor-save-registry.ts` | Project別flushを活用し、tab切替/closeの保存transactionへ組込。WebではProject IDに統一 |
| `src/renderer/StandaloneToolApp.tsx` | ツール本体と独立Window用shellを切り分け、Modal Hostにツール本体を配置 |
| `src/renderer/CivitExplorerStage.tsx` | 共通catalog機能を維持し、UI検索状態の保持と明示的なProject選択結果の返却を追加 |
| `src/renderer/R2ManagerStage.tsx`、`r2-manager.css` | 大型モーダルへの配置、内部dialog整理、転送jobと表示timerの所有分離 |
| `src/renderer/ModelFilePicker.tsx`、`ThumbnailPickerWindow.tsx`、`MarketplaceImagePickerWindow.tsx` | 共通モーダルへ接続し、選択sessionとProject/slot/世代の照合を維持 |
| `src/main/ipc-registration/image.ts` | openerのWebContents IDに依存するPicker所有権を、Web認証sessionとProject/Picker契約へ置換 |
| `tests/multi-window.cjs`、既存navigation/離脱/Pickerテスト | Electron構造の正規表現検証をWebの動作検証へ置換。Run継続・排他・選択隔離の受入条件を保持 |
| `docs/ui/application-shell.md`、`docs/architecture/project-window-execution-runtime.md` | 実装時にWindow操作をタブ/モーダル操作へ改訂。backend runtimeの独立所有を維持 |

現行のElectron仕様文書はこの計画段階では書き換えない。Webの受入時に正本を更新し、旧経路を撤去する。

## 7. Issue・PRの分割と順序

既存の刷新統合ブランチをbaseとし、各作業を`codex/`付きの個別ブランチ・PRに分け、squash mergeする。P3着手の管理は[P3実行計画](web-migration-p3-plan.md)へ移し、親Issue #334と子Issue #335–#343を起票済み。刷新PRへのCI追加は行わず、Docker/Linuxでのローカル検証結果を各PRへ記録する。

| 順序 / Issue案 | 所管 | 完了条件 | 依存 |
| --- | --- | --- | --- |
| T1: Workspace状態とProject context契約 | W02 / P3、API境界W01 | tab/project/session ID、state所有、保存・close・modal契約を確定 | P1完了、P2 API契約 |
| T2: 画面内Projectタブと状態保持 | W02 / P3 | Home/Open/重複選択/並べ替え/切替、工程・draft・Pane状態が独立 | T1 |
| T3: background jobとAssistantPane接続 | W04/W06、shellはW02 | 切替/closeで継続、eventと成果物が正しいProjectへ到着、全ジョブから復帰 | T2、P2 event、P4/P6 API |
| T4: 共通Modal Hostとツール表示 | W02 / P3 | focus/close/内部dialog、Civitai/R2/Vast.aiの既存機能を新APIで操作 | T1、P5 API |
| T5: Project選択・画像Pickerのモーダル化 | W05/W09、R2転送W08 | 管理と選択を分離、Project/slot/世代/revisionを検証、遅延確定拒否 | T2、T4、P5/P7 API |
| T6: 統合受入とWindow経路撤去 | W12/W14、仕様W11 | 下記受入条件、旧Window/renderer/IPC経路の撤去、仕様・索引更新 | T3、T5 |

T3はjob表示用fixtureでUIを先行できるが、受入には実APIが必要。T4も見た目だけで完了とせず、P5の外部連携機能が必要。P3だけでP4/P6/P7の完了を宣言しない。

## 8. ローカル受入条件

1. A/Bで工程、入力、scroll、provider、会話が独立し、繰り返し切替しても混ざらない。
2. AのRun/AI中にBを操作・closeしてもAは継続する。Aの成果物・エラーはAに届く。
3. 起点タブclose、遅延response、再接続、Picker取消後の結果が別Projectへ適用されない。
4. 同一Projectの再Openで重複タブを作らない。他clientの編集lease、CAS競合、同一生成資源の排他をserverで拒否できる。
5. 保存失敗・409時のタブ切替/closeを保留し、明示的な破棄と未送信draft回復を検証する。再読込で保存成功を偽装しない。
6. Civitai/R2モーダルclose後もjobは継続し、再Openで一覧・検索・進捗を取得できる。
7. R2の管理・read-only、move/delete確認、内部dialogのEscape、focus復帰、キーボード操作を検証する。
8. 複数Projectの画像/Canvasを切替後に解放し、event listener・timer・画像URLが増殖しない。既存画像memory gateに加え、1/5/10タブ切替時のmemoryと応答時間を記録する。
9. 起動時は最後の有効Projectを1件復元し、無効なら明示エラーとHomeを表示する。非表示Projectのジョブも全ジョブへ表示する。
10. backendとReactの責務境界を保ち、旧Electronへのfallback、Window依存の認可、非表示を理由とするjob停止を残さない。

計画文書のみの作業であり、コード変更・テスト実行・バージョン更新・リリースは行っていない。

P3ではT1/T2とT4/T5の共通context/Modal Host部分を実装する。T3の実AI/Run接続とT4/T5の実ツール/画像Picker、T6の旧Window経路完全撤去はP4–P9で受け入れる。P3親子Issueの詳細は[P3実行計画](web-migration-p3-plan.md)を正本とする。
