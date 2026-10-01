# IPC access matrix

Main Process の invoke IPC は `src/main/ipc-access.ts` の権限マトリクスを通して登録する。
`ipcMain.handle` を直接追加せず、`handleIpc` を使用する。

## Sender classes

| Sender | 用途 |
| --- | --- |
| `project-local` | Project Window の Batch Studio Renderer |
| `project-codex` | 同じProject Windowに属するローカルCodex Pane |
| `thumbnail-picker` | サムネイル画像選択専用Window |
| `marketplace-picker` | 販売サイト用画像選択専用Window |
| `tool-r2` | R2 File Manager |
| `tool-civit` | Civit Explorer |
| `tool-vastai` | Vast.ai 管理Window |
| `unknown` | 登録外WebContents。常に拒否 |

GrokのWebContentsは外部サイト用でPreloadを持たず、invoke権限を与えない。

## Policy classes

- **project-local**: Projectの選択・設定画面など、Project Windowだけが使うroot非依存操作。
- **project-local-read**: 第1引数のProject rootがSenderの現在のProjectと一致する場合のみ許可。
- **project-write**: root一致に加え、共通の`ensureProjectWritable`を実行して実行中/復旧不確定Runの編集禁止を継承。
- **picker-only**: Pickerの種類をSenderのWebContents IDから判定し、別Pickerや未登録Senderを拒否。
- **picker-write**: Picker所有Projectをwrite rootとして共通書込ガードを適用。
- **tool-global**: 対応する連携WindowとProject Rendererだけに限定。R2/Civit/Vast.ai間の横断呼出しは禁止。
- **project-codex**: ローカルCodex PaneとProject Rendererに必要な会話系操作だけを許可。

Executionの停止・再開・破棄・復旧は「実行中Runがあるため編集不可」という一般書込ガードを掛けると自己停止不能になる。
この群はroot一致を共通化し、既存のExecution専用ライフサイクル/復旧ガードを正本とする。
新規Run開始はProject書込ガードも通す。

## Image path rules

Picker由来のキャッシュ読込はSenderを先に検証し、そのPickerが所有するProject/Sourceに対して画像を再認可する。

- Thumbnail Picker: `assertFinalArtifactImage` のrealpath検証を使用し、設定済み最終成果物ディレクトリ直下の実ファイルだけを許可。
- Marketplace Picker: 既存の`assertExportedThumbnail` / `assertFinalArtifactImage`に基づくSource検証を使用。
- WebP縮小キャッシュ保存も同じPicker画像認可を通す。

任意ファイル選択ダイアログで選ばれた画像を扱う既存Editor APIは、その用途を壊さないためPicker専用スコープとは分離する。

## Adding IPC

1. `src/shared/ipc.ts` にchannelを追加する。
2. Main handlerを`handleIpc`で登録する。
3. `src/main/ipc-access.ts` に適切なpolicyを追加する。
4. Projectの永続状態を変更する場合は原則`write: true`とする。Execution制御など例外は専用ガードを明記する。
5. `tests/ipc-access.cjs`を実行する。登録handlerとpolicyの集合が完全一致しない場合は失敗する。

拒否文言には秘匿値や絶対パスを含めない。
