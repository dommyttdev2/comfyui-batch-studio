# 画像選択Windowの確定契約

サムネイルと販売サイト用画像のPickerは同じ状態遷移を使う: `idle → preview-loading → preview-ready → committing → committed`。

1. 最初のクリックでMainが画像パスを検証し、親Windowへプレビュー要求を送る。親Windowが画像を読み込み、描画フレームを経て `preview-result` を返すまでPickerは `preview-loading` のままにする。
2. 同じ画像の2回目のクリックは `preview-ready` のときだけ受理する。別画像を選ぶと旧プレビューの世代を無効化する。遅れた応答はセッションID、画像パス、世代番号で拒否する。
3. Mainは確定要求を親Windowへ送る。親Windowが編集状態の保存に成功して `commit-result` を返した時点を確定完了とし、その後にPickerを閉じる。保存失敗ならPickerを開いたまま `preview-ready` に戻し、再試行できる。
4. 確定前のWindow閉鎖は仮適用を取り消す。親WindowまたはPickerの破棄時は保留中の要求を拒否する。プレビュー応答が30秒ない場合も失敗として扱う。

この契約ではMainが両Window間の承認状態を保持し、Picker側の表示状態だけを信頼して確定しない。
