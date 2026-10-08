# Web Agent runtimeの起動・運用

Status: Accepted / P4。独立Web/serverのCLI設定・会話・工程task・復旧の運用正本。[契約](../contracts/web-agent-runtime.md)、[受入](../quality/web-p4-acceptance.md)、[Workspace起動](web-workspace.md)を参照する。

## 管理者による明示登録

Docker DesktopをLinux containersで起動する。serverを停止し、Project・server dataDirと重ならない専用local directoryを作成する。hostでCodex/GrokのCLIログインを完了しておく。provider home全体を共有せず、指定したauth.jsonだけを容器専用homeへコピーする。

```powershell
npm run build:workspace
New-Item -ItemType Directory -Path 'D:\BatchStudioWeb\agents' -Force
# 固定versionのimageを構築し、このPCで得られたimage IDを登録する。
docker build -f scripts/Dockerfile.agent -t batch-studio-agent:codex-0.155.1-grok-1.0.46 .
$env:BATCH_STUDIO_DATA_DIR = 'D:\BatchStudioWeb\data'
$env:BATCH_STUDIO_AGENT_DOCKER = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
$env:BATCH_STUDIO_AGENT_CONTEXT = 'desktop-linux'
$env:BATCH_STUDIO_AGENT_IMAGE = (docker image inspect batch-studio-agent:codex-0.155.1-grok-1.0.46 --format '{{.Id}}').Trim()
$env:BATCH_STUDIO_AGENT_DIR = 'D:\BatchStudioWeb\agents'
$env:BATCH_STUDIO_CODEX_CREDENTIAL = Join-Path $env:USERPROFILE '.codex\auth.json'
$env:BATCH_STUDIO_GROK_CREDENTIAL = Join-Path $env:USERPROFILE '.grok\auth.json'
npm run init:server-agent
npm run start:server
```

Docker executable/context、credential file、固定image ID、専用directoryを省略しない。Linux hostではそのhostの絶対path/contextに置き換える。initは新規agent-runtime.jsonだけを作成し、既存設定を上書きしない。設定変更は停止中に現行schemaの登録内容を管理者が明示変更する。未設定provider、Docker/認証/version/protocol不一致はCLI利用不可となる。host CLIの直接実行、別image/profile、別providerへの自動切替は行わない。

登録versionはCodex 0.155.1 / Grok 1.0.46。Grok binaryはDockerfile内のSHA-256を検証する。Codex catalogに実効既定modelの宣言がないため、一覧先頭を既定modelと推定しない。推論強度はCLIが宣言した選択modelの能力だけを提示する。

## 容器の権限と保存範囲

承認済みの固定profileは、容器内のCodex danger-full-access / Grok sandbox off。Docker Desktopの入れ子namespaceでCLI内sandboxのfile taskが失敗したため、2026-10-08にユーザーがCLI認証fileの読取・外部送信リスクを説明した上で承認した。エラーに応じてprofileを変更する実装ではない。

OS境界は非root・read-only root・cap-drop ALL・no-new-privilegesのDocker容器。専用provider homeと当該jobの入力/出力copyだけをmountする。Project本体、server設定/dataDir、SSH/R2秘密情報、Docker socketを容器へ渡さない。CPU 2、memory 1GiB、PID 128、tmpfs 128MiB、turn 10分、公開stream 2MiB、artifact 10MBの上限を適用する。資格情報の更新は既存host CLIで行い、serverは次の準備で指定fileを再読込する。

会話本文/公開会話ID/私有CLI IDの正本はdataDir/agents.json。CLI履歴と認証copyは専用runtime directory。会話はuser/Project/工程/provider別、100会話/scope・1MiB/会話・64MiB/storeを上限とする。上限超過・未知schema・関連が壊れたstoreは明示拒否し、削除/読み替え/旧Desktop履歴の移行を行わない。秘密値とraw reasoning、stdout/stderrは公開しない。

## ブラウザ操作

story/models/Prompt Plan/caption工程でAssistantPaneを使用する。Provider、model、推論強度、会話履歴、新規会話、chat送信、工程task、停止を操作できる。送信/task前にArtifact editorの下書きをflushする。Project・工程・provider別の入力/履歴を保持し、tabを閉じると画面の入力を解放する。CLI jobはtabのcloseや通信切断でも継続し、全ジョブから確認する。

工程taskは確認済み入力snapshotを使用し、成果物を検証してdraftへ取り込む。確定Artifactへ昇格する操作はユーザーが行う。revision競合・schema不正・権限取消・hash変更ではdraftを上書きしない。成果物の再取り込みは同じjob/hash/元revision/receiptを再検査し、競合時に現在revisionへ読み替えない。

## 通信断・不明結果・異常終了

受付応答が失われた場合、同じリクエストを再確認する。元body/idempotency keyを使い、CLIを重複起動しない。WSはWorkspaceの明示再接続を使い、snapshot/replayから現在job/historyを取得する。認証失効時は再ログインする。別user、閉じたtab、同IDの新しい世代へ遅延応答を反映しない。

server異常終了後は[Workspace復旧](web-workspace.md)のserver.lock/Project lock照合を実施して起動する。未完了jobはuncertainを保持し、自動再実行しない。「実行結果を照合」は固定container identityの不在と永続completion/取り込みreceiptを確認する。情報が不足すればuncertainのまま排他を保持する。

「未確定結果を破棄」はadmin権限と確認を要し、固定job containerの終了を検証してcancelledにする。未確定成果物は取り込まず、再launchしない。単なるtab close・再login・revision更新を排他解放の根拠にしない。強制shutdownはuncertainを維持し、後から届くCLI出力をfenceする。

## ローカル検証

通常はnpm run test:agents、npm run test:web、npm run test:server、npm run test:projects、npm run test:core、typecheck/check/索引checkを実行する。Dockerのweb-test targetはElectron binaryを導入せずLinux/Chromiumで同じ受入を実行する。

実CLIはWEB_AGENT_DOCKER / WEB_AGENT_DOCKER_CONTEXT / WEB_AGENT_IMAGE / WEB_AGENT_RUNTIME_DIR / WEB_CODEX_CREDENTIAL / WEB_GROK_CREDENTIALをすべて明示し、npm run test:agents:realを実行する。通常テストのfixture adapterと実CLIの受入は別commandであり、実CLIの失敗をfixture成功で置換しない。専用の受入directoryを使い、停止・container不在を確認してから不要な資格情報copyを管理者が削除する。
