# Web Workspaceの起動・運用

Status: Accepted / P3。Project・Artifact・Compiler・画面内タブ・共通Modal Hostの運用正本。[契約](../contracts/web-project-workspace.md)、[受入](../quality/web-p3-acceptance.md)を参照する。

## 独立起動

Node.jsとnpmを用意する。Electronの実行ファイルは不要。依存packageのinstall hookを実行せず、独立Web/serverをbuildする。

```powershell
npm ci --ignore-scripts
npm run build:workspace
$env:BATCH_STUDIO_DATA_DIR = 'D:\BatchStudioWeb\data'
$env:BATCH_STUDIO_PROJECT_ROOT = 'D:\BatchStudioWeb\projects'
$env:BATCH_STUDIO_ROOT_ID = 'local-projects'
$env:BATCH_STUDIO_ROOT_NAME = 'Local Projects'
# PROJECT_ROOTは管理者が事前に作成したlocal directoryを指定する。
# 管理者が生成した32〜128文字の英数字/_/- tokenを設定する。
$env:BATCH_STUDIO_ADMIN_TOKEN = '<新しく生成したtoken>'
npm run init:server-auth
Remove-Item Env:BATCH_STUDIO_ADMIN_TOKEN
npm run init:server-root
npm run start:server
```

Linuxでも同じ環境変数とnpm commandを使う。auth初期化は排他作成であり、既存auth.jsonを上書きしない。root追加CLIと復旧CLIはserver停止中に実行する。rootはcanonical化したlocal filesystemのみを対象にし、UNCは拒否する。検証したfilesystemはWindows NTFSとDocker DesktopのLinux container内filesystem。NAS/共有drive/別host間の排他は受入対象外。

ブラウザで http://127.0.0.1:3210/ を開き、tokenでログインする。Homeから登録rootとProject名を選び作成する。新しいProjectへのgrant反映後は再ログインを要求し、未完了のProjectを一覧へ出さない。既存の現行形式ProjectはPOST /api/v1/projects/registerで登録できる。旧Desktop Projectの読込み・変換は行わない。一般clientへ任意path/rootを公開しない。

BATCH_STUDIO_PORT（既定3210）、HOST（127.0.0.1 / ::1）、RESOURCE_DIRは[P2運用契約](../architecture/web-server-foundation.md)を参照する。WebとAPI/WSは同一origin。未知routeへのHTML fallbackなし。LAN/TLS公開は後続工程。

## 操作と保存

Homeは固定タブ。ProjectタブはIDで重複排除し、並べ替え、切替、閉じる操作を提供する。工程・本文・スクロール・Provider・Assistant入力・Pane幅はProject別。選択中のeditorだけをmountする。切替/close前に未保存本文をflushし、失敗時は元のタブと本文を保持する。明示破棄は下書きの破棄であり、server jobの停止ではない。

編集はserver時刻の60秒leaseとrevision/CASで制御し、20秒ごとにrenewする。別sessionは読み取り専用。同じmutation key/inputのreceiptは7日保持、期限後は410となりtombstoneを維持する。未完了操作の自動再送はしない。resetはtarget/revision/fingerprintを捕捉した60秒確認ticketを消費する。Artifactの検証・意味変更・下流stale・Compiler判断は共通application/domainが担当する。

IndexedDBの未送信下書きはuser/Project/工程/revisionで分離し、7日・20MiB/userまで。再読込は再認証後、最後の有効Project1件だけを開く。revisionが一致する下書きは復元を提案し、異なる場合は本文を提示して手動照合する。期限切れ・取消scope・logout時は該当下書きを破棄する。保存済み本文を未送信下書きで自動上書きしない。

WSは1接続で認可Projectのjobとrevisionを配信する。履歴不足・切断は明示し、ユーザーが再接続または新しいsnapshotへの再同期を選ぶ。認証失効は画面とモーダルを閉じ再ログインを要求する。build不一致はreloadが必要。

ツールはShell直下の大型modalで開く。検索・bucket・path・scroll条件をuser/tool別に保持し、管理と起点Project選択を分ける。背景inert、focus trap、Escapeは最前面のdialogだけを閉じる。P3ではCivitai/R2/Vast.ai実操作とAI送信を未接続として明示する。実CLIはP4、外部連携はP5、生成はP6、画像操作はP7。

## Fixture Compilerとasset

Compilerを使う場合は、現行ModelCatalog schemaのcollectionsを含むfixture JSONの絶対pathをBATCH_STUDIO_CATALOG_FILEに明示設定して起動する。未設定はDEPENDENCY_UNAVAILABLE。モデルとPrompt Planを編集・確定してWorkflowを生成する。Templateは登録済みillustrious/animaとManifest/hashを検査し、欠落/変更は拒否する。実catalog/availability/PreflightはP5。

GET /api/v1/projects/:id/assets/:assetIdはProject scope付きのbinary入口。登録Template IDはtemplate-illustrious / template-anima。Project独自assetはOS管理者がserver停止中にProject/assets以下へ配置し、web-assets.jsonに現行manifestを明示作成する。

```json
{"schema":"web-assets/1","assets":[{"id":"example","file":"example.txt","mime":"text/plain","sha256":"<実際のbytesのSHA-256: 64桁>"}]}
```

fileはassets内の相対path。認めるMIMEはPNG/JPEG/WebP/JSON/text、上限50MiB。取得ごとにrealpath/hash/型/サイズを検査し、traversal、symlink/junction置換、別Project、未知assetを拒否する。browserから任意fileを取得するAPIではない。upload/画像処理は後続工程。

## 異常終了後の明示復旧

serverを停止し、同hostのowner PIDが死亡していることと現行storeを確認する。server.lockが残った場合は先にrecover:server-lockを実行する。

```powershell
npm run recover:server-lock
$env:BATCH_STUDIO_PROJECT_ID = '<登録Project ID>'
# 未完了操作がある場合だけ、照合したoperation IDを明示指定する。
$env:BATCH_STUDIO_OPERATION_ID = '<reserved operation ID>'
npm run recover:project
Remove-Item Env:BATCH_STUDIO_OPERATION_ID
```

生存/不明owner、壊れたstore、Runを含むProjectは拒否する。未完了操作を指定すると、再実行できないtombstoneとして確定する。結果を成功扱いしたり副作用を再送したりしない。Project state保存済みのoutboxは次の起動でbrokerとevent IDを照合して配信する。外部資源や実Runの復旧はP6 adapterが必要であり、このCLIは解放しない。停電耐久性は未検証。

## ローカル受入

```powershell
npm run test:projects
npx playwright install chromium
npm run test:web
npm run test:server
npm run test:core
npm run typecheck
npm run typecheck:web
npm run check
node docs/roadmap/web-migration-audit.cjs --check
```

Docker Desktopではdocker compose build web-testの後、docker compose run --rm web-testを実行する。Linux image内のsrc/dependencies/Chromiumを使い、Electron binaryが存在しないことを確認して上記受入を実行する。Windows node_modulesをmountしない。従来Desktop検証のtest targetは独立して保持する。CIは追加しない。
