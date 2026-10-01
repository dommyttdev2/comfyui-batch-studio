# IPC contract

ComfyUI Batch Studio の IPC channel 名の正本は `src/shared/ipc.ts` の `IPC` です。

## 追加・変更手順

1. `src/shared/ipc.ts` の `IPC` だけを編集する。
2. `npm run ipc:generate` を実行し、`src/preload/index.cjs` の generated block を更新する。
3. Main 側へ invoke handler、または Main → Renderer event sender を実装する。
4. `npm run ipc:check` と `npm test` を実行する。

Preload の `BEGIN GENERATED IPC CHANNELS` ～ `END GENERATED IPC CHANNELS` は直接編集しない。
ビルドとテストは generated block が正本と一致しない場合に失敗する。

## Direction contract

`tests/ipc-contract.cjs` はコード上の利用方向を全件照合する。

- `ipcRenderer.invoke(I.X)` は Main の `ipcMain.handle(IPC.X)` を必須とする。
- `ipcRenderer.on(I.X)` は Main の `.send(IPC.X)` を必須とし、invoke handler との兼用を禁止する。
- Main / Preload が未知の IPC key を使うと失敗する。
- 正本にあるが Main / Preload のどちらからも使われない channel も失敗する。

この検査は channel 名の二重管理、handler の追加漏れ、event/invoke の方向取り違えを CI で検出するためのものです。
