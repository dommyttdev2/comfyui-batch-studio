# Web移行の開始基準と受入チェックリスト

Status: P0の計画・分類を確定 / 2026-10-06。Web版の機能受入結果ではない。

## 開始点と変更の扱い

- 公開版: v0.82.0 / `1e2614aef2ae08fa0c596fa34ac6c2a885aeb621`。
- 統合先: `codex/web-migration`。CI制御PR #301の取込後は `2d2656d2673209a3330d792520e958296a473b08`。
- 作業branch: `codex/web-migration-doc/baseline-plan`。P0は計画・索引・検証採否の整理のみで、アプリ番号を変更しない。
- 元の作業ツリーのCLI修正は保留し、自動でbaselineへ混ぜない。必要性・新契約との適合を独立Issue/PRでレビューする。
- 旧P1原型はユーザー指示により破棄済み。過去の原型の検証結果を新版の証拠に流用しない。
- 新dataDir、現行schema、明示的に選択された実行経路を使用する。旧データ移行、互換bridge、fallbackを実装しない。

## 未接続テストの採否

実行環境はWindowsホスト上のDocker Desktop/Linux container、Node v22.12.0。v0.82.0由来のアプリコードをそのまま使用した。各testを個別に実行し、終了コードと完了メッセージを確認した。全回帰テスト・実CLI認証・Web E2Eの成功を意味しない。

| Test | P0での実行結果 | 採否・後続作業 |
| --- | --- | --- |
| `tests/assistant-pane.cjs` | exit 0、完了メッセージあり | 会話履歴、再開、キャンセル、イベント、モデル保存の業務検証を採用。Electron viewとIPCの静的一致部分はP4のAPI/browser検証へ置換する。 |
| `tests/codex-snapshot-race.cjs` | exit 1、廃止済み`CodexPane.tsx`へのENOENT | 旧画面向けtestは新版で廃止。履歴閲覧がtaskを再開しないこと、送信中の二重開始防止、履歴未保存時の明示状態をP4の新契約で再検証する。 |
| `tests/codex-turn-status.cjs` | exit 1、廃止済み`CodexPane.tsx`へのENOENT | 旧App Server/画面/IPC向けtestは新版で廃止。停止、活動表示、モデル・推論強度保存、未完了成果物の取込拒否をP4へ引き継ぐ。 |
| `tests/grok-cli-adapter.cjs` | exit 0、最終完了メッセージなし | streaming/resume/cancel/auth/modelsの契約を採用するが、現testは完走未確認。未解決Promiseで終了できるharnessを修復し、全assertion到達を確認するまでは成功の証拠にしない。 |
| `tests/grok-cli-task-runner.cjs` | exit 0、完了メッセージあり | session/workspace/resume/成果物取込の業務検証を採用。P4でserver用compileと明示的なローカル実行経路へ接続する。 |

実行commandは `docker compose -p batch-studio-web-p0 --progress quiet build test` と、同test imageで各fileへの `node tests/<file>.cjs`。P0ではtest実装・packageの登録・アプリ処理を変更しない。通常登録testは索引の実行経路に従い、P1以降の変更範囲でローカル検証する。

## 受入の入力と判定

以下は各phaseで作成する新Web版の受入証拠の固定項目。実装前のため現在は未検証。UI/画像/Run/AIの成功をP0で主張しない。

| ID / gate | 再現用入力・操作 | 合格条件・残す証拠 | phase |
| --- | --- | --- | --- |
| UI-01 / G02,G03 | 空dataDirからProject作成、工程編集・保存、Project切替、tab再読込 | Webから同じ新形式データを再取得できる。未保存変更はflush完了または明示的な中止を経て移動する。browser操作記録と保存データを残す。 | P3 |
| UI-02 / G01,G02 | 同一Projectを複数tabで開き、同じrevisionを二者が保存、期限切れleaseを送る | revision競合とlease失効を明示errorにし、他方の保存を上書きしない。認証・Project scope違反を拒否する。 | P2,P3 |
| IMG-01 / G09,G13 | PNG/JPEG/WebP、縦横/EXIF/alpha、大画像、寸法不正、codec失敗のfixture | 寸法・向き・alpha・cropと明示エラーを検証。同一codecで決定的な出力はhash比較し、codecを跨ぐ一致や別codecへの代替成功は要求しない。fixtureと期待値を保存する。 | P7 |
| IMG-02 / G09,G13 | 4 PSDと4 preview、指定fontなし、resourceなし、別cwdから起動 | PSDの選択・表示・出力が新resource契約で成立。不足resource/fontは明示errorで、別resource/fontへ代替しない。 | P7,P8 |
| IMG-03 / G09 | Picker仮表示・確定・キャンセル、遅い応答、別owner、形式変更とZIP出力 | 過去世代・別ownerの応答を拒否。確定済み画像・manifestの整合性を保ち、手動変更された成果物を削除しない。 | P7 |
| RUN-01 / G05,G06 | `tests/standard-graph-fixture.cjs`のmodel/Planを参考に、新形式Runで固定seedのLocal/Remote生成 | 一画像一投入、入力snapshot固定、画像・prompt ID・hash照合が成立。実ComfyUI結果をfixture検証と分けて記録する。 | P5,P6 |
| RUN-02 / G06,G10 | submit応答喪失、server再起動、停止/中断/resume、ComfyUI消失 | 新Runの結果不明を照合まで保持し、自動再投入しない。停止状態と資源解放を確認し、確認不能は明示errorにする。 | P6 |
| RUN-03 / G06,G07,G08 | SSH trust変更、Remote準備失敗、成果物回収失敗、Vast.ai停止失敗 | 選択済経路だけで復旧・停止を実施し、課金資源を成功扱いしない。実課金・実削除の受入は対象と予算を指定して別に実施する。 | P5,P6 |
| AI-01 / G04 | Codex/Grok各々の新session、送信、停止、再開、model選択、工程task | provider/project/stage間を分離し、実CLI認証とfake adapterの結果を別記する。ブラウザ切断後もserver-owned taskが継続する。 | P4 |
| AI-02 / G04,G03 | session ID不一致、不正/欠落成果物、巨大models応答、stderr診断 | 不正成果物を取り込まず、不一致・欠落を明示errorにする。構造化stdoutを診断用マスキング・切詰めで壊さず、秘密を配信しない。 | P4 |
| AI-03 / G01,G04 | snapshot取得中のevent、重複・順序逆転、replay上限超過、二重send | sequenceで順序と重複を検証。履歴不足は明示errorにし、snapshotへの自動fallbackや二重CLI開始をしない。 | P2,P4 |
| NEW-01 / G10,G14 | 旧Project/Run/AI履歴/Secret、新schemaの必須値欠落、旧dataDir | 旧データ検出・コピー・変換・互換読込を行わず、旧形式は拒否する。旧アプリの実データを変更しない。 | P8,P9 |

既存fixtureは業務ルールの入力例として採用し、旧schemaの互換受入には使わない。codec・font・SecretStore・transport libraryの選定は対応phaseの独立判断とし、選定前に対応済みと記載しない。

## P0の受入証拠

- baselineと保留変更の扱いを固定した。
- 272コード・設定、171 IPC、73 test、8 binary asset、31既存仕様文書を再照合し、主担当Wとphase/gateを割り当てた。
- 未接続5testの採否を決め、旧仕様失敗・完走未確認を成功から区別した。
- UI/画像/Run/AIと旧形式拒否の受入項目を上表に固定した。
- `node docs/roadmap/web-migration-audit.cjs --check`と`git diff --check`で索引と文書差分を確認する。P0の計画整理とWeb機能受入を区別する。
