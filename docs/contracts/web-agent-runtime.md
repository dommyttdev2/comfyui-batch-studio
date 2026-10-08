# Web Agent runtime契約

Status: Accepted / P4。[受入matrix](../quality/web-p4-acceptance.md)と[運用正本](../operations/web-agent-runtime.md)を参照する。

## 所有権と予約

会話scopeはuserId/ProjectId/stage/provider。stageはstory/models/promptPlan/caption、providerはcodex/grok。job排他はProject/stage/providerでchat/task共通。serverがsessionとturnを発行し、clientは公開会話IDだけを選択する。P2 browser認証sessionとCLI sessionは別IDである。

開始は認可と入力検証→idempotency照合→durable reserved保存→model/認証/入力snapshot/workspace準備→launch。外部await前に排他を確定する。重複requestは同じjobを返し、入力変更は409。準備失敗は副作用がない場合failed、起動後の不明結果はuncertain。未知schemaを読み替えない。

## APIと公開情報

/api/v1/projects/:projectId/agents/:stage/:providerを基点にavailability/models、preferences、history、conversations/new・restore、chat、task、job artifact importを扱う。GETはread、開始/stopはexecute、preferences/draft取込はedit、reconcileはadmin。全変更にCSRF/idempotency keyと必要なrevisionを要求する。任意CLI path/argv/env、filesystem path、CLI session ID、roleの指定を認めない。

HTTPは受付jobを返す。job状態はP2 registryを正本とする。公開履歴/eventはassistant本文、user入力、状態、公開IDだけ。raw stdout/stderr、認証情報、内部path、reasoning本文を公開しない。履歴はuser/scope別、会話100件・本文1MiB/会話・保存総量64MiBを上限とし超過は明示拒否する。処理中の本文も上限を適用する。

## 隔離とCLI

管理者が固定Docker image digestとcredential fileを明示登録する。既存ログインはauth.jsonだけを専用runtime homeへ準備し、元home全体・config・MCP・pluginsをmountしない。実行容器にはscopeの入力/出力workspaceと専用provider homeだけをmountする。Project本体、server dataDir、Docker socket、SSH/R2 secretはmountしない。非root・cap-drop・no-new-privileges・read-only root・資源/時間制限を適用する。CLIへのprovider credential公開は認証に必要な権限として明示し、他サービスsecretとの隔離を受入で検証する。

Codex exec JSON、Grok headless streaming-jsonを使用。version/protocol/auth/modelsをprobeし未設定/不一致は利用不可。容器をOS隔離境界とする。Docker Desktopの入れ子namespace制約により、容器内でCodex danger-full-access/Grok offを固定指定する。CLI認証fileを読取・外部送信できるリスクを説明し、ユーザーが2026-10-08に明示承認した。非root・read-only root・mount制限は維持する。host実行や失敗検知後の別profileへのfallbackは禁止。Grok new sessionは--session-id、resumeは--resumeで区別する。resume結果のsession不一致は失敗し別会話へ保存しない。

## 継続・停止・復旧

tab切替/close、HTTP/WS切断は取消ではない。取消は明示job stop。container全体の終了を確認してからcancelledにする。shutdown drain/stop/forceはP2契約に従い、期限超過はuncertainとownership保持。再起動で未完了jobはuncertainへ変える。明示reconcileはcontainerと永続completionを照合し、再launchしない。late outputはjob/turn/generationでfenceする。

## taskとdraft

P1 task plannerが確認済みProject入力と登録resourceから生成する。snapshot revision/hashと参照内容を予約jobに永続化し、CLIにはcopyだけを渡す。成果物は出力directory内の許可名・通常file・realpath・上限・hash・scope/session/turnを検証する。import前に現行権限とProject revisionを再照合する。確認済みartifactを直接変更しない。draft/event/receiptはProjectRepository transactionで保存し、重複importは同じreceiptへ収束する。古い/無効/不確定な成果物はdraftを上書きせず明示エラーとして保持する。

## presentation境界

AssistantPaneはProject/stage/provider別に入力/model/history/公開会話IDを保持する。送信/task前にeditor flushを完了する。UIはP1のplanning/schema/業務判断を複製しない。eventはscopeへ適用し閉じたtabを再作成しない。再接続はP3の明示snapshot/replay契約、replay不足をfallbackで隠さない。

## 検証

P4-8でWindows/Linux/Chromiumと両実CLIのローカル受入を実施済み。models/chat/task/resume/stop、並行開始、切断、再起動uncertain、別scope/session拒否、入力/成果物のpath/hash/revision、他service secret不可視を含める。契約だけでG04 acceptedにしない。
