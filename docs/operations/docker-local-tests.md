# Docker DesktopでのLinuxローカル検証

Docker DesktopのLinux containersを使い、Windowsホストからアプリのビルドとローカルtestを実行する。Web server化前の現構成では、Electronの画像検証をXvfbの仮想displayで実行する。ブラウザから操作できるWeb版の配布imageは、Web server実装後に別のruntime targetとして追加する。

## 実行

repository rootで実行する。

```powershell
docker compose run --build --rm test
```

`Dockerfile`はNode 22.12.0 / Debian bookwormをdigestで固定し、`package-lock.json`から`npm ci`でLinux依存をinstallする。Python、git、Electron用system library、Xvfb、日本語fontを含む。Electron 44のbinaryもbuild時に明示的にinstallし、`ELECTRON_OVERRIDE_DIST_PATH`でそのbinaryを指定する。実行時にbinaryが欠けていればpreflightで失敗し、自動downloadへ切り替えない。Composeは`init: true`と1GBのshared memoryを設定する。

実行順は以下のとおり。失敗時は直ちに非zeroで終了し、別経路へのfallbackや自動retryをしない。

1. Node/Python version、`fcntl`、install済みElectron binaryの存在確認。
2. `npm run check`。
3. `npm run typecheck`。
4. `npm test`。
5. `npm run build`。
6. `image-memory-benchmark.cjs`。
7. Xvfb上のElectron画像test（2048px、3584px）。

初回buildはbase image・apt package・npm依存・Electron binaryの取得にnetworkが必要。sourceとLinuxのnode_modulesをimageへコピーし、Windowsの作業folderやnode_modulesをbind mountしない。test fixtureとsymlinkはLinux filesystem内で作成する。sourceの変更後は`--build`で再ビルドする。testからの変更はホストsourceへ書き戻さない。

## 個別検証

```powershell
docker compose build test
docker compose run --rm test npm run typecheck
docker compose run --rm test npm test
docker compose run --rm test node tests/remote-control-plane.cjs
docker compose run --rm test sh
```

Composeのcommand指定でtest実行内容を明示的に選ぶ。全検証の成功とは区別する。完了したone-off containerは`--rm`で削除される。image/build cacheは次回用に保持する。

## 検証範囲

- Windowsで失敗した`fcntl`依存のRemote Worker testとsymlink検証をLinuxで実行できる。
- `tests/update-release.cjs`は既存のWindows専用testであり、Linuxでは明示的にskipする。Windows PowerShell updaterを検証するときはWindowsで`node tests/update-release.cjs`を実行する。
- 実CLI認証、実ComfyUI生成、Vast.ai課金、実R2転送、GUIの手動操作はこのtest imageの検証範囲外。実credentialや既存Projectをimageへ持ち込まない。
- ホストの`.git`、node_modules、build出力、log、release evidence、`.env`、`.aws`、エージェント設定は`.dockerignore`でcontextから除外する。
- コンテナはnodeユーザーでtestを実行する。Electron画像testの`--no-sandbox`は既存CIと同じヘッドレス検証設定であり、公開Web実行用の設定ではない。
- Dockerはローカル検証の実行環境を提供する。既存GitHub Actionsの設定は変更しない。

## 実行記録

検証対象はmain `d58e4f7`から分岐したDocker変更。WindowsホストのDocker Desktop 4.76.0 / Linux engine 29.5.2で`docker compose -p batch-studio-docker-pr --progress quiet run --build --rm test`が終了コード0で完了した。format/lint、typecheck、Linux対象の登録回帰test、build、CPU画像benchmark、Electron画像test（2048px/3584px）が成功。Windows専用updater testは既存条件で1件skipした。既存lint warning、ag-psdのutil外部化warning、D-Bus診断出力は残るが、失敗の隠蔽や追加skipはない。

参考: [Docker Compose run](https://docs.docker.com/reference/cli/docker/compose/run/)、[build contextとdockerignore](https://docs.docker.com/build/concepts/context/#dockerignore-files)。
