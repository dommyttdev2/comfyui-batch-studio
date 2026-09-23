# サムネイル画像一覧の速度計測

## ログの取得

「サムネイル」工程で画像一覧Windowを開き、一覧右上の「計測ログを開く」を押してください。アプリのユーザーデータ領域の `logs` フォルダーが開きます。ファイル名は `thumbnail-picker-performance.jsonl` です。

同じ画像フォルダーについて、**初回**（キャッシュ未生成）と**2回目**（キャッシュ生成済み）の一覧Windowを開き、両方のログを比較してください。必要ならスクロール、表示サイズ「大・中・小」の切り替え、検索も操作してください。操作後にWindowを閉じてください。ログはJSON Lines形式（1行=1イベント）です。

ログの `sessionId` が同じ行は同一の画像一覧Windowに対応します。画像のファイルパス・ファイル名・画像そのものは計測ログに記録しません。ログには使用画像枚数、画像サイズ、処理時間、キャッシュ命中状態のみ記録します。8MBを超えたログは次の書き込み時に `.old` にローテーションします。

## 主なイベントと見方

| イベント | 内容 |
|---|---|
| `window_opened` | Main側でWindowを作成した時間。 |
| `renderer_loaded`, `renderer_mounted` | WindowのHTML/JS読み込みとReact起動。 |
| `context_requested` | Pickerの設定取得。 |
| `list_images` | Mainで画像一覧の状態確認(`statusMs`)・ファイル列挙(`listMs`)・合計(`totalMs`)。 |
| `list_received` | Rendererが一覧をIPC経由で受信するまでの時間(`listIpcMs`)と枚数(`count`)。 |
| `list_painted` | Reactへの一覧設定から次の描画フレームまで（目安）の時間(`renderMs`)。 |
| `preview_read` | 画像1枚のMain側読込とキャッシュ命中(`cacheHit`)。最初の40件、25件ごとのサンプル、100ms超または未命中の要求を記録。 |
| `images_loaded` | Rendererで画像読み込みが1/5/10/20/50/100...枚完了した時の経過時間・平均IPC時間・平均画像要素デコード時間。 |
| `first_image_painted` | 最初の画像の `img.onload` 後、次の描画フレームまでの概算時間。 |
| `grid_changed`, `grid_painted` | 検索・表示サイズ変更から次の描画フレームまでの概算時間。 |
| `window_closed` | Windowを閉じるまでの時間とプレビュー要求数。 |

`preview_read` の `statMs`, `diskReadMs`, `queuedMs`, `sharedMs`, `decodeMs`, `resizeMs`, `encodeMs`, `writeMs`, `fallbackMs` は各処理の時間です。Main側 `totalMs` とRenderer側 `averageIpcMs` の差にはIPC転送・Rendererでの処理・スケジューリング等が含まれます（別々のリクエストを集計した値を直接減算しないでください）。

`sinceOpenMs` はMain側のWindow作成からログ収集時点までの経過時間です。Renderer側 `sinceMountMs` はReact起動からの経過時間です。イベントの `at` はMainプロセスで記録した時刻です。計測ログへの非同期書き込み自身にも若干の負荷があります。

## 診断手順

1. 同一画像フォルダーで画像一覧を開き、最初の画像が表示されるまで待って閉じる。
2. すぐ再度開き、初回との `list_painted` と `first_image_painted` を比較する。
3. スクロールして大量の画像を表示し、`preview_read` の `cacheHit` と `queuedMs`、`images_loaded` の完了枚数を確認する。
4. 「大・中・小」と検索を試し、`grid_painted` の時間と `count` を比較する。

本計測は問題の切り分け用です。表示・画像読み込みの方式自体は変更していません。
