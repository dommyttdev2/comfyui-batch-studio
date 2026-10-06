# Web完全移行: 全コード調査索引

Status: Planning evidence / 再照合: 2026-10-06

[移行計画](web-migration-plan.md)のW01–W14とG01–G14を正本とする。後方互換性なし・旧データマイグレーションなし・fallback禁止を全項目へ適用する。新dataDir/現行schema/明示設定で開始し、対応外・失敗はerrorとする。各code fileとIPCは主担当を一つだけ持つ。phaseは主実装受入段階。desktopRemovalPhase=P9は旧sourceの残存確認・撤去段階であり、互換adapterを提供する期間ではない。依存・横断条件は計画側を参照する。

基準commit: `2d2656d2673209a3330d792520e958296a473b08`。公開済みv0.82.0から作成した刷新統合branchを照合する。元の作業ツリーにある未統合のCLI修正は含めない。旧P1原型は破棄済み。全283コード・設定（src 172、tests 74、scripts 9）、8 binary asset、31仕様文書を別母集団で管理する。生成済dist・依存package・release履歴・秘密設定は除外。全行の手動レビュー/実動作保証ではない。

[機械可読索引](web-migration-inventory.json)にhash・import・根拠行・分類・test実行経路を保存する。[再照合ツール](web-migration-audit.cjs)は`node docs/roadmap/web-migration-audit.cjs --check`で検証し、`--write`で再生成する。現索引との差分、未分類file/IPC、主担当重複、IPC方向/handler不整合は失敗する。新file/IPCの処置をレビューしてから再生成する。

## 修正した不整合

- 旧regex `[A-Z_]`はR2識別子を途中まで抽出していた。`[A-Z0-9_]`に直し、R2全handlerを実在file/行へ接続した。
- 通知はsuffixで推測せずpreloadのinvoke/onで確定。`ui-flow`と`event`の混在をなくし、通信方向を別軸へ分離した。
- THUMBNAIL_EXPORT、MARKETPLACE_GENERATE/EXPORT_CUSTOMをbinary処理へ、THUMBNAIL_PICKER_PERF_OPENをnative操作へ明示分類した。
- .gitignore/.gitattributes、binary PSD/preview、仕様文書、testの未接続項目を明示した。
- EXECUTION_LEAVEは工程移動を許可する既存queryであり、Run停止を要求しない。詳細は計画4.2参照。

## 集計（排他的な分類）

| 主担当 | file数 | 完成phase | 検証gate |
| --- | ---: | --- | --- |
| W01 通信契約・認可境界 | 12 | P2 | G01 |
| W02 Web shell・共通UI状態 | 27 | P3 | G02 |
| W03 Project・Artifact永続化 | 12 | P3 | G03 |
| W04 AI会話・工程task | 22 | P4 | G04 |
| W05 モデル解決・Compiler・Preflight | 19 | P5 | G05 |
| W06 生成runtime・SSH・復旧 | 18 | P6 | G06 |
| W07 Civitai catalog・Vast.ai操作 | 8 | P5 | G07 |
| W08 R2転送・object管理 | 6 | P5 | G08 |
| W09 画像・Caption・成果物・Picker | 25 | P7 | G09 |
| W10 起動・OS・Secret基盤 | 10 | P5 | G10 |
| W11 build・起動配布・更新 | 25 | P8 | G11 |
| W12 検証・test harness | 76 | P8 | G12 |
| W13 schema・runtime resource | 11 | P8 | G13 |
| W14 旧実装整理 | 12 | P9 | G14 |

IPC分類: binary-command=6 / binary-query=8 / command=65 / event=2 / native-replacement=13 / query=44 / ui-flow=28 / ui-local=5。

## ファイル別処置

| ファイル | 行数 | 主担当 / phase / gate | 処置 |
| --- | ---: | --- | --- |
| [.dockerignore](../../.dockerignore) | 43 | W11 / P8 / G11 | 配布設定をWeb/server構成へ適合 |
| [.git](../../.git) | 2 | W11 / P8 / G11 | 配布設定をWeb/server構成へ適合 |
| [.gitattributes](../../.gitattributes) | 6 | W11 / P8 / G11 | 配布設定をWeb/server構成へ適合 |
| [.github/workflows/ci.yml](../../.github/workflows/ci.yml) | 42 | W11 / P8 / G11 | Windows/Linux server + browser E2E/画像検証へ |
| [.github/workflows/release-201-performance.yml](../../.github/workflows/release-201-performance.yml) | 79 | W11 / P8 / G11 | Web/server配布設定として確認 |
| [.gitignore](../../.gitignore) | 7 | W11 / P8 / G11 | 配布設定をWeb/server構成へ適合 |
| [Dockerfile](../../Dockerfile) | 23 | W11 / P8 / G11 | 配布設定をWeb/server構成へ適合 |
| [biome.json](../../biome.json) | 39 | W11 / P8 / G11 | Web/server配布設定として確認 |
| [compose.yaml](../../compose.yaml) | 12 | W11 / P8 / G11 | 配布設定をWeb/server構成へ適合 |
| [index.html](../../index.html) | 13 | W11 / P8 / G11 | Web/server配布設定として確認 |
| [package-lock.json](../../package-lock.json) | 3003 | W11 / P8 / G11 | 依存変更時に同期、今回version変更なし |
| [package.json](../../package.json) | 56 | W11 / P8 / G11 | server scripts/依存へ移行、Electron削除は最終段階 |
| [run.bat](../../run.bat) | 130 | W11 / P8 / G11 | Node serverとbrowser起動、既存server確認 |
| [schemas/caption-content.schema.json](../../schemas/caption-content.schema.json) | 130 | W13 / P8 / G13 | 内容・独立version維持、server runtimeへ配置 |
| [schemas/models.schema.json](../../schemas/models.schema.json) | 191 | W13 / P8 / G13 | 内容・独立version維持、server runtimeへ配置 |
| [schemas/prompt-plan.schema.json](../../schemas/prompt-plan.schema.json) | 395 | W13 / P8 / G13 | 内容・独立version維持、server runtimeへ配置 |
| [schemas/workflow-template-manifest.schema.json](../../schemas/workflow-template-manifest.schema.json) | 61 | W13 / P8 / G13 | 内容・独立version維持、server runtimeへ配置 |
| [scripts/check-core-boundaries.cjs](../../scripts/check-core-boundaries.cjs) | 53 | W12 / P8 / G12 | 配布設定をWeb/server構成へ適合 |
| [scripts/check-running-batch-studio.cjs](../../scripts/check-running-batch-studio.cjs) | 62 | W11 / P8 / G11 | server lock/health/build ID確認へ |
| [scripts/copy-runtime.cjs](../../scripts/copy-runtime.cjs) | 23 | W11 / P8 / G11 | server resources/Web staticの配置へ |
| [scripts/create_thumbnail_psd_templates.py](../../scripts/create_thumbnail_psd_templates.py) | 331 | W11 / P8 / G11 | 生成/検証ツール維持、新resource配置を確認 |
| [scripts/docker-test.sh](../../scripts/docker-test.sh) | 17 | W11 / P8 / G11 | 配布設定をWeb/server構成へ適合 |
| [scripts/generate-preload-ipc.cjs](../../scripts/generate-preload-ipc.cjs) | 43 | W11 / P8 / G11 | Web API契約検証へ置換 |
| [scripts/make_psd_text_editable.cjs](../../scripts/make_psd_text_editable.cjs) | 112 | W11 / P8 / G11 | 生成/検証ツール維持、新resource配置を確認 |
| [scripts/update-release.ps1](../../scripts/update-release.ps1) | 116 | W11 / P8 / G11 | 新版停止/更新/起動/health。schema移行・旧版自動切戻しなし |
| [scripts/verify-comfyui-api.mjs](../../scripts/verify-comfyui-api.mjs) | 162 | W12 / P8 / G12 | 生成/検証ツール維持、新resource配置を確認 |
| [src/application/platform-ports.ts](../../src/application/platform-ports.ts) | 23 | W10 / P1 / G10 | 配布設定をWeb/server構成へ適合 |
| [src/application/project-access.ts](../../src/application/project-access.ts) | 84 | W03 / P1 / G03 | 配布設定をWeb/server構成へ適合 |
| [src/application/project-ports.ts](../../src/application/project-ports.ts) | 62 | W03 / P1 / G03 | 配布設定をWeb/server構成へ適合 |
| [src/domain/artifact-policy.ts](../../src/domain/artifact-policy.ts) | 36 | W03 / P1 / G03 | 配布設定をWeb/server構成へ適合 |
| [src/domain/confirmation-policy.ts](../../src/domain/confirmation-policy.ts) | 47 | W10 / P1 / G10 | 配布設定をWeb/server構成へ適合 |
| [src/domain/contracts.ts](../../src/domain/contracts.ts) | 80 | W01 / P1 / G01 | 配布設定をWeb/server構成へ適合 |
| [src/domain/execution-policy.ts](../../src/domain/execution-policy.ts) | 115 | W06 / P1 / G06 | 配布設定をWeb/server構成へ適合 |
| [src/domain/image-policy.ts](../../src/domain/image-policy.ts) | 31 | W09 / P1 / G09 | 配布設定をWeb/server構成へ適合 |
| [src/main/agent-artifact-import.ts](../../src/main/agent-artifact-import.ts) | 178 | W04 / P4 / G04 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/agent-cli-adapter.ts](../../src/main/agent-cli-adapter.ts) | 31 | W04 / P4 / G04 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/agent-cli-diagnostic.ts](../../src/main/agent-cli-diagnostic.ts) | 39 | W04 / P4 / G04 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/agent-conversation-runner.ts](../../src/main/agent-conversation-runner.ts) | 219 | W04 / P4 / G04 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/agent-conversation-store.ts](../../src/main/agent-conversation-store.ts) | 113 | W04 / P4 / G04 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/agent-model-selection.ts](../../src/main/agent-model-selection.ts) | 78 | W04 / P4 / G04 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/agent-session-state.ts](../../src/main/agent-session-state.ts) | 133 | W04 / P4 / G04 | 新Web session storeのみ。旧session/historyの自動継承・変換なし |
| [src/main/agent-workspace.ts](../../src/main/agent-workspace.ts) | 273 | W04 / P4 / G04 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/app-settings.ts](../../src/main/app-settings.ts) | 407 | W10 / P5 / G10; Electron依存置換 P5 | 新設定契約/SecretStore/dataDir。旧設定読替・値補完・取得元fallback禁止 |
| [src/main/artifact-service.ts](../../src/main/artifact-service.ts) | 639 | W03 / P3 / G03 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/assistant-provider-state.ts](../../src/main/assistant-provider-state.ts) | 143 | W04 / P4 / G04 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/atomic-image-output.ts](../../src/main/atomic-image-output.ts) | 106 | W09 / P7 / G09 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/availability.ts](../../src/main/availability.ts) | 185 | W05 / P5 / G05 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/caption-service.ts](../../src/main/caption-service.ts) | 456 | W09 / P7 / G09 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/civitai-cache.ts](../../src/main/civitai-cache.ts) | 149 | W07 / P5 / G07 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/civitai-catalog.ts](../../src/main/civitai-catalog.ts) | 881 | W07 / P5 / G07 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/civitai-client.ts](../../src/main/civitai-client.ts) | 168 | W07 / P5 / G07 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/civitai-config.ts](../../src/main/civitai-config.ts) | 58 | W10 / P5 / G10; Electron依存置換 P5 | 新SecretStoreへ置換・新規登録。旧暗号化設定の移行/取得元fallback禁止 |
| [src/main/civitai-request-policy.ts](../../src/main/civitai-request-policy.ts) | 304 | W07 / P5 / G07 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/codex-app-server.ts](../../src/main/codex-app-server.ts) | 160 | W14 / P9 / G14; Desktop撤去 P9 | 旧code/store参照を撤去。互換読込・旧データ移行なし |
| [src/main/codex-artifact-turn.ts](../../src/main/codex-artifact-turn.ts) | 54 | W14 / P9 / G14; Desktop撤去 P9 | 旧code/store参照を撤去。互換読込・旧データ移行なし |
| [src/main/codex-chat-state.ts](../../src/main/codex-chat-state.ts) | 81 | W14 / P9 / G14; Desktop撤去 P9 | 旧code/store参照を撤去。互換読込・旧データ移行なし |
| [src/main/codex-cli-adapter.ts](../../src/main/codex-cli-adapter.ts) | 570 | W04 / P4 / G04 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/codex-cli-events.ts](../../src/main/codex-cli-events.ts) | 192 | W04 / P4 / G04 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/codex-cli-task-runner.ts](../../src/main/codex-cli-task-runner.ts) | 313 | W04 / P4 / G04 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/codex-file-artifact.ts](../../src/main/codex-file-artifact.ts) | 160 | W14 / P9 / G14; Desktop撤去 P9 | 旧code/store参照を撤去。互換読込・旧データ移行なし |
| [src/main/codex-model-selection.ts](../../src/main/codex-model-selection.ts) | 51 | W14 / P9 / G14; Desktop撤去 P9 | 旧code/store参照を撤去。互換読込・旧データ移行なし |
| [src/main/codex-thread-history.ts](../../src/main/codex-thread-history.ts) | 68 | W14 / P9 / G14; Desktop撤去 P9 | 旧code/store参照を撤去。互換読込・旧データ移行なし |
| [src/main/codex-turn-monitor.ts](../../src/main/codex-turn-monitor.ts) | 177 | W14 / P9 / G14; Desktop撤去 P9 | 旧code/store参照を撤去。互換読込・旧データ移行なし |
| [src/main/comfyui-client.ts](../../src/main/comfyui-client.ts) | 174 | W06 / P6 / G06 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/compiler.ts](../../src/main/compiler.ts) | 141 | W05 / P5 / G05 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/execution-coordinator.ts](../../src/main/execution-coordinator.ts) | 132 | W06 / P6 / G06 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/execution-output.ts](../../src/main/execution-output.ts) | 8 | W06 / P6 / G06 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/execution-run.ts](../../src/main/execution-run.ts) | 954 | W06 / P6 / G06 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/final-artifact-image-service.ts](../../src/main/final-artifact-image-service.ts) | 167 | W09 / P7 / G09 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/final-artifact-service.ts](../../src/main/final-artifact-service.ts) | 48 | W09 / P7 / G09 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/fs-utils.ts](../../src/main/fs-utils.ts) | 301 | W03 / P3 / G03 | 新形式のatomic保存/検証。破損時の自動backup採用/空状態置換禁止 |
| [src/main/grok-artifact-adapter.ts](../../src/main/grok-artifact-adapter.ts) | 94 | W14 / P9 / G14; Desktop撤去 P9 | 旧code/store参照を撤去。互換読込・旧データ移行なし |
| [src/main/grok-auto-artifact-watcher.ts](../../src/main/grok-auto-artifact-watcher.ts) | 232 | W14 / P9 / G14; Desktop撤去 P9 | 旧code/store参照を撤去。互換読込・旧データ移行なし |
| [src/main/grok-chat-state.ts](../../src/main/grok-chat-state.ts) | 40 | W14 / P9 / G14; Desktop撤去 P9 | 旧code/store参照を撤去。互換読込・旧データ移行なし |
| [src/main/grok-cli-adapter.ts](../../src/main/grok-cli-adapter.ts) | 486 | W04 / P4 / G04 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/grok-cli-events.ts](../../src/main/grok-cli-events.ts) | 172 | W04 / P4 / G04 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/grok-cli-task-runner.ts](../../src/main/grok-cli-task-runner.ts) | 263 | W04 / P4 / G04 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/grok-context.ts](../../src/main/grok-context.ts) | 457 | W04 / P4 / G04 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/grok-lora-history.ts](../../src/main/grok-lora-history.ts) | 81 | W04 / P4 / G04 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/grok-navigation-queue.ts](../../src/main/grok-navigation-queue.ts) | 90 | W14 / P9 / G14; Desktop撤去 P9 | 旧code/store参照を撤去。互換読込・旧データ移行なし |
| [src/main/grok-navigation.ts](../../src/main/grok-navigation.ts) | 61 | W14 / P9 / G14; Desktop撤去 P9 | 旧code/store参照を撤去。互換読込・旧データ移行なし |
| [src/main/image-dimensions.ts](../../src/main/image-dimensions.ts) | 62 | W09 / P7 / G09 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/image-pipeline-core.ts](../../src/main/image-pipeline-core.ts) | 283 | W09 / P7 / G09 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/image-pipeline.ts](../../src/main/image-pipeline.ts) | 77 | W09 / P7 / G09; Electron依存置換 P7 | nativeImageコーデック置換、画像契約/キャッシュ/出力維持 |
| [src/main/image-tasks.ts](../../src/main/image-tasks.ts) | 300 | W05 / P5 / G05 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/ipc-access.ts](../../src/main/ipc-access.ts) | 312 | W01 / P2 / G01 | 認証sessionのProject/File権限へ再設計 |
| [src/main/ipc-registration.ts](../../src/main/ipc-registration.ts) | 19 | W01 / P2 / G01; Desktop撤去 P9 | main.tsへの依存型逆参照を解消しHTTP service境界へ |
| [src/main/ipc-registration/assistant.ts](../../src/main/ipc-registration/assistant.ts) | 271 | W01 / P2 / G01; Desktop撤去 P9 | handler内業務ロジックをserviceへ抽出、HTTP入力/認可/確認tokenへ |
| [src/main/ipc-registration/execution.ts](../../src/main/ipc-registration/execution.ts) | 489 | W01 / P2 / G01; Desktop撤去 P9 | handler内業務ロジックをserviceへ抽出、HTTP入力/認可/確認tokenへ |
| [src/main/ipc-registration/image.ts](../../src/main/ipc-registration/image.ts) | 705 | W01 / P2 / G01; Desktop撤去 P9 | handler内業務ロジックをserviceへ抽出、HTTP入力/認可/確認tokenへ |
| [src/main/ipc-registration/integration.ts](../../src/main/ipc-registration/integration.ts) | 167 | W01 / P2 / G01; Desktop撤去 P9 | handler内業務ロジックをserviceへ抽出、HTTP入力/認可/確認tokenへ |
| [src/main/ipc-registration/project.ts](../../src/main/ipc-registration/project.ts) | 270 | W01 / P2 / G01; Desktop撤去 P9 | handler内業務ロジックをserviceへ抽出、HTTP入力/認可/確認tokenへ |
| [src/main/ipc-registration/storage.ts](../../src/main/ipc-registration/storage.ts) | 124 | W01 / P2 / G01; Desktop撤去 P9 | handler内業務ロジックをserviceへ抽出、HTTP入力/認可/確認tokenへ |
| [src/main/local-execution.ts](../../src/main/local-execution.ts) | 633 | W06 / P6 / G06 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/main.ts](../../src/main/main.ts) | 2402 | W10 / P5 / G10; Desktop撤去 P9 | composition root・runtime recovery・session・UI shellへ分解 |
| [src/main/marketplace-generation-manifest.ts](../../src/main/marketplace-generation-manifest.ts) | 128 | W09 / P7 / G09 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/marketplace-image-service.ts](../../src/main/marketplace-image-service.ts) | 737 | W09 / P7 / G09; Electron依存置換 P7 | 新codec/asset/revision/manifest契約。旧処理へのfallback禁止 |
| [src/main/model-catalog.ts](../../src/main/model-catalog.ts) | 173 | W05 / P5 / G05 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/model-downstream-reset.ts](../../src/main/model-downstream-reset.ts) | 330 | W03 / P3 / G03 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/model-file-sources.ts](../../src/main/model-file-sources.ts) | 49 | W05 / P5 / G05 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/model-placement-paths.ts](../../src/main/model-placement-paths.ts) | 82 | W05 / P5 / G05 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/picker-selection-gate.ts](../../src/main/picker-selection-gate.ts) | 83 | W09 / P7 / G09 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/preflight.ts](../../src/main/preflight.ts) | 187 | W05 / P5 / G05 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/project-meta.ts](../../src/main/project-meta.ts) | 105 | W03 / P3 / G03 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/project-scan.ts](../../src/main/project-scan.ts) | 190 | W03 / P3 / G03 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/project-transaction.ts](../../src/main/project-transaction.ts) | 272 | W03 / P3 / G03 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/prompt-plan-patch.ts](../../src/main/prompt-plan-patch.ts) | 235 | W03 / P3 / G03 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/r2-config.ts](../../src/main/r2-config.ts) | 190 | W10 / P5 / G10; Electron依存置換 P5 | 新SecretStoreへ置換・新規登録。旧暗号化設定の移行/取得元fallback禁止 |
| [src/main/r2-manager.ts](../../src/main/r2-manager.ts) | 1248 | W08 / P5 / G08 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/r2-object-index.ts](../../src/main/r2-object-index.ts) | 139 | W08 / P5 / G08 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/remote-control-plane.ts](../../src/main/remote-control-plane.ts) | 161 | W06 / P6 / G06 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/remote-environment-bootstrap.ts](../../src/main/remote-environment-bootstrap.ts) | 114 | W06 / P6 / G06 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/remote-execution.ts](../../src/main/remote-execution.ts) | 1077 | W06 / P6 / G06 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/remote-instance-lifecycle.ts](../../src/main/remote-instance-lifecycle.ts) | 283 | W06 / P6 / G06 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/remote-model-stager.ts](../../src/main/remote-model-stager.ts) | 412 | W06 / P6 / G06 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/remote-worker-source.ts](../../src/main/remote-worker-source.ts) | 821 | W06 / P6 / G06 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/remote-worker.ts](../../src/main/remote-worker.ts) | 119 | W06 / P6 / G06 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/ssh-client.ts](../../src/main/ssh-client.ts) | 127 | W06 / P6 / G06 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/ssh-host-keys.ts](../../src/main/ssh-host-keys.ts) | 71 | W06 / P6 / G06 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/ssh-key-pair.ts](../../src/main/ssh-key-pair.ts) | 37 | W06 / P6 / G06 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/thumbnail-cache-prune.ts](../../src/main/thumbnail-cache-prune.ts) | 180 | W09 / P7 / G09 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/thumbnail-image-cache.ts](../../src/main/thumbnail-image-cache.ts) | 258 | W09 / P7 / G09; Electron依存置換 P7 | 選択済codecと認可binary配信。失敗時の別codec/元画像代用禁止 |
| [src/main/thumbnail-picker-perf.ts](../../src/main/thumbnail-picker-perf.ts) | 55 | W09 / P7 / G09 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/thumbnail-service.ts](../../src/main/thumbnail-service.ts) | 512 | W09 / P7 / G09; Electron依存置換 P7 | 新codec/font/revision契約。自動font代替/旧revision読替禁止 |
| [src/main/tracked-output-cleanup.ts](../../src/main/tracked-output-cleanup.ts) | 33 | W09 / P7 / G09 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/ui-state.ts](../../src/main/ui-state.ts) | 98 | W03 / P3 / G03 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/validation.ts](../../src/main/validation.ts) | 1272 | W05 / P5 / G05 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/vastai-client.ts](../../src/main/vastai-client.ts) | 720 | W07 / P5 / G07 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/vastai-config.ts](../../src/main/vastai-config.ts) | 159 | W10 / P5 / G10; Electron依存置換 P5 | 新SecretStoreへ置換・新規登録。旧暗号化設定の移行/取得元fallback禁止 |
| [src/main/workflow-api.ts](../../src/main/workflow-api.ts) | 206 | W05 / P5 / G05 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/workflow-template-integrity.ts](../../src/main/workflow-template-integrity.ts) | 12 | W05 / P5 / G05 | Node処理再利用、dataDir/権限/排他/復旧との接合を検証 |
| [src/main/workflow-template-paths.ts](../../src/main/workflow-template-paths.ts) | 33 | W05 / P5 / G05 | 明示resourceDir/Templateを解決。不在時の別Template/cwd探索禁止 |
| [src/preload/index.cjs](../../src/preload/index.cjs) | 433 | W01 / P2 / G01; Desktop撤去 P9 | 新版から非到達・最終撤去。Electron互換bridgeを作らない |
| [src/renderer/App.tsx](../../src/renderer/App.tsx) | 971 | W02 / P3 / G02 | React内Pane/session/route/保存・離脱を変更 |
| [src/renderer/ArtifactImportToast.tsx](../../src/renderer/ArtifactImportToast.tsx) | 102 | W04 / P4 / G04 | Web再利用、import/配信を確認 |
| [src/renderer/AssistantPane.tsx](../../src/renderer/AssistantPane.tsx) | 471 | W04 / P4 / G04 | API注入・埋込表示・再接続へ |
| [src/renderer/CaptionStage.tsx](../../src/renderer/CaptionStage.tsx) | 255 | W09 / P7 / G09 | React再利用、bridgeをAPI clientへ |
| [src/renderer/CivitExplorerStage.tsx](../../src/renderer/CivitExplorerStage.tsx) | 375 | W07 / P5 / G07 | React再利用、bridgeをAPI clientへ |
| [src/renderer/EnvironmentSettings.tsx](../../src/renderer/EnvironmentSettings.tsx) | 321 | W10 / P5 / G10 | 管理ホスト設定とbrowser File操作を区別 |
| [src/renderer/ExecutionStages.tsx](../../src/renderer/ExecutionStages.tsx) | 1238 | W06 / P6 / G06 | React再利用、bridgeをAPI clientへ |
| [src/renderer/FinalArtifactStage.tsx](../../src/renderer/FinalArtifactStage.tsx) | 83 | W09 / P7 / G09 | React再利用、bridgeをAPI clientへ |
| [src/renderer/GrokLoraHistory.tsx](../../src/renderer/GrokLoraHistory.tsx) | 179 | W04 / P4 / G04 | React再利用、bridgeをAPI clientへ |
| [src/renderer/GrokStages.tsx](../../src/renderer/GrokStages.tsx) | 1200 | W04 / P4 / G04 | React再利用、bridgeをAPI clientへ |
| [src/renderer/HomeConnectedServices.tsx](../../src/renderer/HomeConnectedServices.tsx) | 71 | W10 / P5 / G10 | React再利用、bridgeをAPI clientへ |
| [src/renderer/ImagePickerGrid.tsx](../../src/renderer/ImagePickerGrid.tsx) | 354 | W02 / P3 / G02 | Web再利用、import/配信を確認 |
| [src/renderer/MarketplaceImagePickerWindow.tsx](../../src/renderer/MarketplaceImagePickerWindow.tsx) | 76 | W09 / P7 / G09 | 所有session付Picker/dialogへ |
| [src/renderer/MarketplaceImageStage.tsx](../../src/renderer/MarketplaceImageStage.tsx) | 1157 | W09 / P7 / G09 | API/画像URL/Picker/保存を変更、Canvas維持 |
| [src/renderer/ModelFilePicker.tsx](../../src/renderer/ModelFilePicker.tsx) | 226 | W05 / P5 / G05 | React再利用、bridgeをAPI clientへ |
| [src/renderer/ModelPicker.tsx](../../src/renderer/ModelPicker.tsx) | 315 | W05 / P5 / G05 | React再利用、bridgeをAPI clientへ |
| [src/renderer/ProjectStages.tsx](../../src/renderer/ProjectStages.tsx) | 175 | W03 / P3 / G03 | React再利用、bridgeをAPI clientへ |
| [src/renderer/PromptPlanStage.tsx](../../src/renderer/PromptPlanStage.tsx) | 1043 | W05 / P5 / G05 | React再利用、bridgeをAPI clientへ |
| [src/renderer/R2ManagerStage.tsx](../../src/renderer/R2ManagerStage.tsx) | 1453 | W08 / P5 / G08 | API/transfer job、browser Fileとserver fileを区別 |
| [src/renderer/SelectedModelCards.tsx](../../src/renderer/SelectedModelCards.tsx) | 365 | W05 / P5 / G05 | React再利用、bridgeをAPI clientへ |
| [src/renderer/ServiceIntegrationsStage.tsx](../../src/renderer/ServiceIntegrationsStage.tsx) | 134 | W10 / P5 / G10 | React再利用、bridgeをAPI clientへ |
| [src/renderer/StageErrorBoundary.tsx](../../src/renderer/StageErrorBoundary.tsx) | 42 | W02 / P3 / G02 | Web再利用、import/配信を確認 |
| [src/renderer/StageResetMenu.tsx](../../src/renderer/StageResetMenu.tsx) | 284 | W02 / P3 / G02 | Web再利用、import/配信を確認 |
| [src/renderer/StandaloneToolApp.tsx](../../src/renderer/StandaloneToolApp.tsx) | 65 | W02 / P3 / G02 | route/dialogへ統合 |
| [src/renderer/ThumbnailPickerWindow.tsx](../../src/renderer/ThumbnailPickerWindow.tsx) | 154 | W09 / P7 / G09 | 所有session付Picker/dialogへ |
| [src/renderer/ThumbnailStage.tsx](../../src/renderer/ThumbnailStage.tsx) | 1380 | W09 / P7 / G09 | API/画像URL/フォント/保存を変更、PSD/Canvas維持 |
| [src/renderer/VirtualPickerGrid.tsx](../../src/renderer/VirtualPickerGrid.tsx) | 129 | W02 / P3 / G02 | Web再利用、import/配信を確認 |
| [src/renderer/assets.d.ts](../../src/renderer/assets.d.ts) | 2 | W02 / P3 / G02 | Web再利用、import/配信を確認 |
| [src/renderer/assistant-pane.css](../../src/renderer/assistant-pane.css) | 393 | W02 / P3 / G02 | Web再利用、import/配信を確認 |
| [src/renderer/civit-explorer.css](../../src/renderer/civit-explorer.css) | 371 | W02 / P3 / G02 | Web再利用、import/配信を確認 |
| [src/renderer/divider.css](../../src/renderer/divider.css) | 34 | W02 / P3 / G02 | Web再利用、import/配信を確認 |
| [src/renderer/editor-save-registry.ts](../../src/renderer/editor-save-registry.ts) | 17 | W02 / P3 / G02 | navigation flushと未保存回復へ |
| [src/renderer/env.d.ts](../../src/renderer/env.d.ts) | 22 | W02 / P3 / G02 | Desktop global API型の廃止/重複解消 |
| [src/renderer/environment-settings.css](../../src/renderer/environment-settings.css) | 61 | W02 / P3 / G02 | Web再利用、import/配信を確認 |
| [src/renderer/global.d.ts](../../src/renderer/global.d.ts) | 22 | W02 / P3 / G02 | Desktop global API型の廃止/重複解消 |
| [src/renderer/home.css](../../src/renderer/home.css) | 123 | W02 / P3 / G02 | Web再利用、import/配信を確認 |
| [src/renderer/integrations/CivitaiIntegrationPanel.tsx](../../src/renderer/integrations/CivitaiIntegrationPanel.tsx) | 77 | W07 / P5 / G07 | React再利用、bridgeをAPI clientへ |
| [src/renderer/integrations/R2IntegrationPanel.tsx](../../src/renderer/integrations/R2IntegrationPanel.tsx) | 185 | W08 / P5 / G08 | React再利用、bridgeをAPI clientへ |
| [src/renderer/integrations/VastAiIntegrationPanel.tsx](../../src/renderer/integrations/VastAiIntegrationPanel.tsx) | 850 | W07 / P5 / G07 | React再利用、bridgeをAPI clientへ |
| [src/renderer/main.tsx](../../src/renderer/main.tsx) | 23 | W02 / P3 / G02 | Web初期化・API adapter・routeへ |
| [src/renderer/marketplace-image-stage.css](../../src/renderer/marketplace-image-stage.css) | 187 | W02 / P3 / G02 | Web再利用、import/配信を確認 |
| [src/renderer/model-selection.css](../../src/renderer/model-selection.css) | 514 | W02 / P3 / G02 | Web再利用、import/配信を確認 |
| [src/renderer/prompt-plan-modal.css](../../src/renderer/prompt-plan-modal.css) | 148 | W02 / P3 / G02 | Web再利用、import/配信を確認 |
| [src/renderer/r2-manager.css](../../src/renderer/r2-manager.css) | 466 | W02 / P3 / G02 | Web再利用、import/配信を確認 |
| [src/renderer/scrollbars.css](../../src/renderer/scrollbars.css) | 33 | W02 / P3 / G02 | Web再利用、import/配信を確認 |
| [src/renderer/service-integrations.css](../../src/renderer/service-integrations.css) | 347 | W02 / P3 / G02 | Web再利用、import/配信を確認 |
| [src/renderer/stage-reset.css](../../src/renderer/stage-reset.css) | 85 | W02 / P3 / G02 | Web再利用、import/配信を確認 |
| [src/renderer/styles.css](../../src/renderer/styles.css) | 1097 | W02 / P3 / G02 | Web再利用、import/配信を確認 |
| [src/renderer/thumbnail-image-memory-cache.ts](../../src/renderer/thumbnail-image-memory-cache.ts) | 59 | W09 / P7 / G09 | Web再利用、import/配信を確認 |
| [src/renderer/thumbnail-stage.css](../../src/renderer/thumbnail-stage.css) | 427 | W02 / P3 / G02 | Web再利用、import/配信を確認 |
| [src/renderer/ui.tsx](../../src/renderer/ui.tsx) | 143 | W02 / P3 / G02 | Web再利用、import/配信を確認 |
| [src/renderer/use-editor-autosave.ts](../../src/renderer/use-editor-autosave.ts) | 191 | W02 / P3 / G02 | 時刻採番をserver revision/CASへ |
| [src/shared/codex-activity.ts](../../src/shared/codex-activity.ts) | 230 | W04 / P4 / G04 | 共通型/純粋処理/定数を再利用 |
| [src/shared/execution-progress.ts](../../src/shared/execution-progress.ts) | 73 | W06 / P6 / G06 | 共通型/純粋処理/定数を再利用 |
| [src/shared/image-size-limits.ts](../../src/shared/image-size-limits.ts) | 70 | W09 / P7 / G09 | 共通型/純粋処理/定数を再利用 |
| [src/shared/ipc.ts](../../src/shared/ipc.ts) | 174 | W01 / P2 / G01; Desktop撤去 P9 | 全173定義を下表で分類、最終廃止 |
| [src/shared/marketplace-image-targets.json](../../src/shared/marketplace-image-targets.json) | 42 | W13 / P8 / G13 | 共通型/純粋処理/定数を再利用 |
| [src/shared/marketplace-picker-generation.ts](../../src/shared/marketplace-picker-generation.ts) | 45 | W09 / P7 / G09 | 共通型/純粋処理/定数を再利用 |
| [src/shared/model-file-selection.ts](../../src/shared/model-file-selection.ts) | 40 | W05 / P5 / G05 | 共通型/純粋処理/定数を再利用 |
| [src/shared/model-selection.ts](../../src/shared/model-selection.ts) | 81 | W05 / P5 / G05 | 共通型/純粋処理/定数を再利用 |
| [src/shared/model-version-change.ts](../../src/shared/model-version-change.ts) | 81 | W05 / P5 / G05 | 共通型/純粋処理/定数を再利用 |
| [src/shared/prompt-policy.ts](../../src/shared/prompt-policy.ts) | 251 | W05 / P5 / G05 | 共通型/純粋処理/定数を再利用 |
| [src/shared/r2-download-utils.ts](../../src/shared/r2-download-utils.ts) | 39 | W08 / P5 / G08 | 共通型/純粋処理/定数を再利用 |
| [src/shared/r2-manager-utils.ts](../../src/shared/r2-manager-utils.ts) | 91 | W08 / P5 / G08 | 共通型/純粋処理/定数を再利用 |
| [src/shared/types.ts](../../src/shared/types.ts) | 1669 | W01 / P2 / G01 | domain型維持、API DTOとDesktop global API型を分離 |
| [templates/anima-scene-batch/manifest.json](../../templates/anima-scene-batch/manifest.json) | 10 | W13 / P8 / G13 | 内容・独立version維持、server runtimeへ配置 |
| [templates/anima-scene-batch/template.json](../../templates/anima-scene-batch/template.json) | 14 | W13 / P8 / G13 | 内容・独立version維持、server runtimeへ配置 |
| [templates/default-scene-batch/manifest.json](../../templates/default-scene-batch/manifest.json) | 10 | W13 / P8 / G13 | 内容・独立version維持、server runtimeへ配置 |
| [templates/default-scene-batch/template.json](../../templates/default-scene-batch/template.json) | 14 | W13 / P8 / G13 | 内容・独立version維持、server runtimeへ配置 |
| [templates/illustrious-scene-batch/manifest.json](../../templates/illustrious-scene-batch/manifest.json) | 10 | W13 / P8 / G13 | 内容・独立version維持、server runtimeへ配置 |
| [templates/illustrious-scene-batch/template.json](../../templates/illustrious-scene-batch/template.json) | 14 | W13 / P8 / G13 | 内容・独立version維持、server runtimeへ配置 |
| [tests/agent-artifact-auto.cjs](../../tests/agent-artifact-auto.cjs) | 281 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/agent-foundation.cjs](../../tests/agent-foundation.cjs) | 148 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/agent-phase7-regression.cjs](../../tests/agent-phase7-regression.cjs) | 151 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/anima-vae-placement.cjs](../../tests/anima-vae-placement.cjs) | 114 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/assistant-pane.cjs](../../tests/assistant-pane.cjs) | 331 | W12 / P8 / G12 | source照合の前提を更新、service/API/E2Eの挙動を検証 |
| [tests/assistant-provider.cjs](../../tests/assistant-provider.cjs) | 291 | W12 / P8 / G12 | source照合の前提を更新、service/API/E2Eの挙動を検証 |
| [tests/atomic-image-output.cjs](../../tests/atomic-image-output.cjs) | 148 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/caption-stage.cjs](../../tests/caption-stage.cjs) | 123 | W12 / P8 / G12 | source照合の前提を更新、service/API/E2Eの挙動を検証 |
| [tests/caption-stale.cjs](../../tests/caption-stale.cjs) | 232 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/civitai-catalog.cjs](../../tests/civitai-catalog.cjs) | 503 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/civitai-rate-limit.cjs](../../tests/civitai-rate-limit.cjs) | 156 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/codex-cli-adapter.cjs](../../tests/codex-cli-adapter.cjs) | 553 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/codex-cli-task-runner.cjs](../../tests/codex-cli-task-runner.cjs) | 257 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/codex-snapshot-race.cjs](../../tests/codex-snapshot-race.cjs) | 63 | W12 / P8 / G12 | source照合の前提を更新、service/API/E2Eの挙動を検証 |
| [tests/codex-turn-status.cjs](../../tests/codex-turn-status.cjs) | 353 | W12 / P8 / G12 | source照合の前提を更新、service/API/E2Eの挙動を検証 |
| [tests/compiler-lora-mode.cjs](../../tests/compiler-lora-mode.cjs) | 110 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/core-policy.cjs](../../tests/core-policy.cjs) | 68 | W12 / P8 / G12 | 配布設定をWeb/server構成へ適合 |
| [tests/execution-coordinator.cjs](../../tests/execution-coordinator.cjs) | 95 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/execution-run.cjs](../../tests/execution-run.cjs) | 551 | W12 / P8 / G12 | source照合の前提を更新、service/API/E2Eの挙動を検証 |
| [tests/execution-safe-exit.cjs](../../tests/execution-safe-exit.cjs) | 105 | W12 / P8 / G12 | source照合の前提を更新、service/API/E2Eの挙動を検証 |
| [tests/final-artifact-stage.cjs](../../tests/final-artifact-stage.cjs) | 166 | W12 / P8 / G12 | source照合の前提を更新、service/API/E2Eの挙動を検証 |
| [tests/fs-utils.cjs](../../tests/fs-utils.cjs) | 216 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/grok-cli-adapter.cjs](../../tests/grok-cli-adapter.cjs) | 601 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/grok-cli-task-runner.cjs](../../tests/grok-cli-task-runner.cjs) | 315 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/grok-file-return-ui.cjs](../../tests/grok-file-return-ui.cjs) | 72 | W12 / P8 / G12 | source照合の前提を更新、service/API/E2Eの挙動を検証 |
| [tests/grok-lora-fallback.cjs](../../tests/grok-lora-fallback.cjs) | 224 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/grok-lora-selection-summary.cjs](../../tests/grok-lora-selection-summary.cjs) | 110 | W12 / P8 / G12 | source照合の前提を更新、service/API/E2Eの挙動を検証 |
| [tests/grok-output-contract.cjs](../../tests/grok-output-contract.cjs) | 269 | W12 / P8 / G12 | source照合の前提を更新、service/API/E2Eの挙動を検証 |
| [tests/grok-response-persistence.cjs](../../tests/grok-response-persistence.cjs) | 67 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/image-memory-benchmark.cjs](../../tests/image-memory-benchmark.cjs) | 59 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/image-memory-electron.cjs](../../tests/image-memory-electron.cjs) | 217 | W12 / P8 / G12; Electron依存置換 P8 | Electron testをserver/browser検証へ置換 |
| [tests/image-pipeline-core.cjs](../../tests/image-pipeline-core.cjs) | 192 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/ipc-access.cjs](../../tests/ipc-access.cjs) | 123 | W12 / P8 / G12 | source照合の前提を更新、service/API/E2Eの挙動を検証 |
| [tests/ipc-contract.cjs](../../tests/ipc-contract.cjs) | 102 | W12 / P8 / G12 | source照合の前提を更新、service/API/E2Eの挙動を検証 |
| [tests/ipc-registration-modules.cjs](../../tests/ipc-registration-modules.cjs) | 100 | W12 / P8 / G12 | source照合の前提を更新、service/API/E2Eの挙動を検証 |
| [tests/local-comfyui-execution.cjs](../../tests/local-comfyui-execution.cjs) | 661 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/main-process-source.cjs](../../tests/main-process-source.cjs) | 23 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/marketplace-generation-manifest.cjs](../../tests/marketplace-generation-manifest.cjs) | 172 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/marketplace-image-stage.cjs](../../tests/marketplace-image-stage.cjs) | 300 | W12 / P8 / G12 | source照合の前提を更新、service/API/E2Eの挙動を検証 |
| [tests/marketplace-picker-generation.cjs](../../tests/marketplace-picker-generation.cjs) | 121 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/marketplace-write-guard.cjs](../../tests/marketplace-write-guard.cjs) | 64 | W12 / P8 / G12 | source照合の前提を更新、service/API/E2Eの挙動を検証 |
| [tests/model-downstream-reset.cjs](../../tests/model-downstream-reset.cjs) | 608 | W12 / P8 / G12 | source照合の前提を更新、service/API/E2Eの挙動を検証 |
| [tests/model-file-selection.cjs](../../tests/model-file-selection.cjs) | 95 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/model-placement.cjs](../../tests/model-placement.cjs) | 171 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/model-selection.cjs](../../tests/model-selection.cjs) | 564 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/multi-window.cjs](../../tests/multi-window.cjs) | 134 | W12 / P8 / G12 | source照合の前提を更新、service/API/E2Eの挙動を検証 |
| [tests/navigation.cjs](../../tests/navigation.cjs) | 582 | W12 / P8 / G12 | source照合の前提を更新、service/API/E2Eの挙動を検証 |
| [tests/picker-selection-gate.cjs](../../tests/picker-selection-gate.cjs) | 59 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/project-meta-serialization.cjs](../../tests/project-meta-serialization.cjs) | 80 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/project-roots.cjs](../../tests/project-roots.cjs) | 102 | W12 / P8 / G12 | source照合の前提を更新、service/API/E2Eの挙動を検証 |
| [tests/prompt-plan-v2.cjs](../../tests/prompt-plan-v2.cjs) | 259 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/prompt-plan-warning-location.cjs](../../tests/prompt-plan-warning-location.cjs) | 56 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/r2-manager-parity.cjs](../../tests/r2-manager-parity.cjs) | 488 | W12 / P8 / G12 | source照合の前提を更新、service/API/E2Eの挙動を検証 |
| [tests/r2-object-index.cjs](../../tests/r2-object-index.cjs) | 120 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/release-201-compare.cjs](../../tests/release-201-compare.cjs) | 96 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/release-201-picker-benchmark.cjs](../../tests/release-201-picker-benchmark.cjs) | 464 | W12 / P8 / G12; Electron依存置換 P8 | Electron testをserver/browser検証へ置換 |
| [tests/remote-artifact-retrieval.cjs](../../tests/remote-artifact-retrieval.cjs) | 433 | W12 / P8 / G12 | source照合の前提を更新、service/API/E2Eの挙動を検証 |
| [tests/remote-control-plane.cjs](../../tests/remote-control-plane.cjs) | 129 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/remote-environment-bootstrap.cjs](../../tests/remote-environment-bootstrap.cjs) | 239 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/remote-image-execution.cjs](../../tests/remote-image-execution.cjs) | 563 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/remote-instance-lifecycle.cjs](../../tests/remote-instance-lifecycle.cjs) | 521 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/remote-model-staging.cjs](../../tests/remote-model-staging.cjs) | 589 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/run.cjs](../../tests/run.cjs) | 569 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/service-integrations-ui.cjs](../../tests/service-integrations-ui.cjs) | 289 | W12 / P8 / G12 | source照合の前提を更新、service/API/E2Eの挙動を検証 |
| [tests/source-match.cjs](../../tests/source-match.cjs) | 41 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/stage-load-recovery.cjs](../../tests/stage-load-recovery.cjs) | 55 | W12 / P8 / G12 | source照合の前提を更新、service/API/E2Eの挙動を検証 |
| [tests/standard-graph-fixture.cjs](../../tests/standard-graph-fixture.cjs) | 42 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/thumbnail-cache-prune.cjs](../../tests/thumbnail-cache-prune.cjs) | 103 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/thumbnail-stage.cjs](../../tests/thumbnail-stage.cjs) | 526 | W12 / P8 / G12 | source照合の前提を更新、service/API/E2Eの挙動を検証 |
| [tests/ui-state.cjs](../../tests/ui-state.cjs) | 66 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/vastai-client.cjs](../../tests/vastai-client.cjs) | 534 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/workflow-api-graph.cjs](../../tests/workflow-api-graph.cjs) | 262 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/workflow-model-family.cjs](../../tests/workflow-model-family.cjs) | 142 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tests/workflow-template-line-endings.cjs](../../tests/workflow-template-line-endings.cjs) | 110 | W12 / P8 / G12 | 回帰契約維持、compile先/import/resource前提を更新 |
| [tsconfig.core.json](../../tsconfig.core.json) | 21 | W11 / P8 / G11 | 配布設定をWeb/server構成へ適合 |
| [tsconfig.electron.json](../../tsconfig.electron.json) | 16 | W11 / P8 / G11 | server tsconfigへ置換、test参照も更新 |
| [tsconfig.json](../../tsconfig.json) | 21 | W11 / P8 / G11 | Web/server配布設定として確認 |
| [update.bat](../../update.bat) | 8 | W11 / P8 / G11 | 新server更新手順へ接続 |
| [vite.config.ts](../../vite.config.ts) | 12 | W11 / P8 / G11 | 同一origin proxy/static/明示route。未知routeのHTML fallback禁止 |

## IPC全定義の処置

queryは変更なしのGETを保証する名称ではない。caveat項目は復旧/選択変更等をcommandへ分離する。binary-commandはHTTP画像処理/保存job、binary-queryは認可binary取得。ui-flowはReact UIとserver sessionを接合する操作、native-replacementはOS操作の代替である。confirmは別の横断属性。

| 定義 | 現方向・根拠 | 移行分類 | 主担当 / phase / gate | 補足 |
| --- | --- | --- | --- | --- |
| APP_SETTINGS_GET | invoke: [project.ts:61](../../src/main/ipc-registration/project.ts#L61) | query | W10 / P5 / G10 |  |
| APP_SETTINGS_SELECT_COMFYUI | invoke: [project.ts:62](../../src/main/ipc-registration/project.ts#L62) | native-replacement | W10 / P5 / G10 |  |
| APP_SETTINGS_SAVE | invoke: [project.ts:69](../../src/main/ipc-registration/project.ts#L69) | command | W10 / P5 / G10 |  |
| PROJECT_SELECT | invoke: [project.ts:74](../../src/main/ipc-registration/project.ts#L74) | native-replacement | W03 / P3 / G03 |  |
| PROJECT_LAST | invoke: [project.ts:103](../../src/main/ipc-registration/project.ts#L103) | query | W03 / P3 / G03 | 現queryに復元・状態変更等を伴う。安全なGETとcommandへ分離して確認 |
| PROJECT_RECENT | invoke: [project.ts:128](../../src/main/ipc-registration/project.ts#L128) | query | W03 / P3 / G03 |  |
| PROJECT_REMOVE_RECENT | invoke: [project.ts:137](../../src/main/ipc-registration/project.ts#L137) | command | W03 / P3 / G03 |  |
| PROJECT_OPEN | invoke: [project.ts:142](../../src/main/ipc-registration/project.ts#L142) | ui-flow | W03 / P3 / G03 |  |
| PROJECT_CLOSE | invoke: [project.ts:154](../../src/main/ipc-registration/project.ts#L154) | ui-flow | W03 / P3 / G03 |  |
| PROJECT_SELECT_PARENT | invoke: [project.ts:167](../../src/main/ipc-registration/project.ts#L167) | native-replacement | W03 / P3 / G03 |  |
| PROJECT_CREATE | invoke: [project.ts:177](../../src/main/ipc-registration/project.ts#L177) | command | W03 / P3 / G03 |  |
| PROJECT_MENU_COMMAND | notification: [main.ts:533](../../src/main/main.ts#L533), [main.ts:797](../../src/main/main.ts#L797), [main.ts:814](../../src/main/main.ts#L814), [main.ts:832](../../src/main/main.ts#L832) | ui-local | W03 / P3 / G03 |  |
| EDITOR_FLUSH_REQUEST | notification: [main.ts:1417](../../src/main/main.ts#L1417) | ui-flow | W02 / P3 / G02 |  |
| EDITOR_FLUSH_RESULT | invoke: [project.ts:51](../../src/main/ipc-registration/project.ts#L51) | ui-flow | W02 / P3 / G02 |  |
| PROJECT_SCAN | invoke: [project.ts:195](../../src/main/ipc-registration/project.ts#L195) | query | W03 / P3 / G03 |  |
| PROJECT_OPEN_FOLDER | invoke: [project.ts:199](../../src/main/ipc-registration/project.ts#L199) | native-replacement | W03 / P3 / G03 |  |
| PROJECT_SAVE_SETTINGS | invoke: [project.ts:204](../../src/main/ipc-registration/project.ts#L204) | command | W03 / P3 / G03 |  |
| PROJECT_SAVE_BRIEF | invoke: [project.ts:210](../../src/main/ipc-registration/project.ts#L210) | command | W03 / P3 / G03 |  |
| ARTIFACT_READ | invoke: [project.ts:216](../../src/main/ipc-registration/project.ts#L216) | query | W03 / P3 / G03 |  |
| ARTIFACT_BEGIN_EDIT | invoke: [project.ts:220](../../src/main/ipc-registration/project.ts#L220) | command | W03 / P3 / G03 |  |
| ARTIFACT_SAVE_DRAFT | invoke: [project.ts:225](../../src/main/ipc-registration/project.ts#L225) | command | W03 / P3 / G03 |  |
| ARTIFACT_IMPORT_GROK | invoke: [project.ts:231](../../src/main/ipc-registration/project.ts#L231) | command | W03 / P3 / G03 |  |
| ARTIFACT_CONFIRM | invoke: [project.ts:242](../../src/main/ipc-registration/project.ts#L242) | command | W03 / P3 / G03 |  |
| ARTIFACT_GROK_LORA_HISTORY | invoke: [project.ts:248](../../src/main/ipc-registration/project.ts#L248) | query | W03 / P3 / G03 |  |
| ARTIFACT_RESET_FROM | invoke: [project.ts:252](../../src/main/ipc-registration/project.ts#L252) | command | W03 / P3 / G03 |  |
| PROMPT_PLAN_SAVE | invoke: [project.ts:259](../../src/main/ipc-registration/project.ts#L259) | command | W05 / P5 / G05 |  |
| FILE_SHOW_IN_FOLDER | invoke: [project.ts:264](../../src/main/ipc-registration/project.ts#L264) | native-replacement | W02 / P3 / G02 |  |
| CATALOG_STATUS | invoke: [integration.ts:32](../../src/main/ipc-registration/integration.ts#L32) | query | W07 / P5 / G07 |  |
| CATALOG_INTEGRATED_STATUS | invoke: [integration.ts:36](../../src/main/ipc-registration/integration.ts#L36) | query | W07 / P5 / G07 |  |
| CATALOG_INTEGRATED_SNAPSHOT | invoke: [integration.ts:37](../../src/main/ipc-registration/integration.ts#L37) | query | W07 / P5 / G07 |  |
| CATALOG_INTEGRATED_SYNC | invoke: [integration.ts:38](../../src/main/ipc-registration/integration.ts#L38) | command | W07 / P5 / G07 |  |
| CATALOG_LINK_PROJECT | invoke: [integration.ts:42](../../src/main/ipc-registration/integration.ts#L42) | command | W07 / P5 / G07 |  |
| CATALOG_TEMPLATES | invoke: [integration.ts:46](../../src/main/ipc-registration/integration.ts#L46) | query | W07 / P5 / G07 |  |
| CATALOG_SAVE_TEMPLATE | invoke: [integration.ts:47](../../src/main/ipc-registration/integration.ts#L47) | command | W07 / P5 / G07 |  |
| CATALOG_DELETE_TEMPLATE | invoke: [integration.ts:50](../../src/main/ipc-registration/integration.ts#L50) | command | W07 / P5 / G07 |  |
| CATALOG_OPEN_MODEL | invoke: [integration.ts:54](../../src/main/ipc-registration/integration.ts#L54) | native-replacement | W07 / P5 / G07 |  |
| CIVITAI_SETTINGS | invoke: [integration.ts:58](../../src/main/ipc-registration/integration.ts#L58) | query | W07 / P5 / G07 |  |
| CIVITAI_SAVE_SETTINGS | invoke: [integration.ts:59](../../src/main/ipc-registration/integration.ts#L59) | command | W07 / P5 / G07 |  |
| VASTAI_SETTINGS | invoke: [integration.ts:66](../../src/main/ipc-registration/integration.ts#L66) | query | W07 / P5 / G07 |  |
| VASTAI_SAVE_SETTINGS | invoke: [integration.ts:67](../../src/main/ipc-registration/integration.ts#L67) | command | W07 / P5 / G07 |  |
| VASTAI_TEST | invoke: [integration.ts:70](../../src/main/ipc-registration/integration.ts#L70) | command | W07 / P5 / G07 |  |
| VASTAI_SELECT_PRIVATE_KEY | invoke: [integration.ts:79](../../src/main/ipc-registration/integration.ts#L79) | native-replacement | W07 / P5 / G07 |  |
| VASTAI_SELECT_PUBLIC_KEY | invoke: [integration.ts:86](../../src/main/ipc-registration/integration.ts#L86) | native-replacement | W07 / P5 / G07 |  |
| VASTAI_INSTANCES | invoke: [integration.ts:97](../../src/main/ipc-registration/integration.ts#L97) | query | W07 / P5 / G07 |  |
| VASTAI_COMFYUI_TEMPLATE | invoke: [integration.ts:98](../../src/main/ipc-registration/integration.ts#L98) | query | W07 / P5 / G07 |  |
| VASTAI_SEARCH_OFFERS | invoke: [integration.ts:99](../../src/main/ipc-registration/integration.ts#L99) | query | W07 / P5 / G07 |  |
| VASTAI_RENT_OFFER | invoke: [integration.ts:102](../../src/main/ipc-registration/integration.ts#L102) | command | W07 / P5 / G07 | 確認token;  |
| VASTAI_START_INSTANCE | invoke: [integration.ts:136](../../src/main/ipc-registration/integration.ts#L136) | command | W07 / P5 / G07 |  |
| VASTAI_STOP_INSTANCE | invoke: [integration.ts:139](../../src/main/ipc-registration/integration.ts#L139) | command | W07 / P5 / G07 |  |
| VASTAI_DESTROY_INSTANCE | invoke: [integration.ts:142](../../src/main/ipc-registration/integration.ts#L142) | command | W07 / P5 / G07 | 確認token;  |
| VASTAI_REBOOT_INSTANCE | invoke: [integration.ts:158](../../src/main/ipc-registration/integration.ts#L158) | command | W07 / P5 / G07 |  |
| VASTAI_RESOLVE_SSH | invoke: [integration.ts:161](../../src/main/ipc-registration/integration.ts#L161) | query | W07 / P5 / G07 |  |
| WORKFLOW_COMPILE | invoke: [execution.ts:49](../../src/main/ipc-registration/execution.ts#L49) | command | W05 / P5 / G05 |  |
| AVAILABILITY_CHECK | invoke: [execution.ts:54](../../src/main/ipc-registration/execution.ts#L54) | query | W05 / P5 / G05 |  |
| AVAILABILITY_CHECK_LORA_FILES | invoke: [execution.ts:59](../../src/main/ipc-registration/execution.ts#L59) | query | W05 / P5 / G05 |  |
| AVAILABILITY_OPEN_R2 | invoke: [execution.ts:66](../../src/main/ipc-registration/execution.ts#L66) | ui-flow | W05 / P5 / G05 |  |
| PREFLIGHT_RUN | invoke: [execution.ts:67](../../src/main/ipc-registration/execution.ts#L67) | command | W05 / P5 / G05 |  |
| EXECUTION_START | invoke: [execution.ts:71](../../src/main/ipc-registration/execution.ts#L71) | command | W06 / P6 / G06 |  |
| EXECUTION_STATUS | invoke: [execution.ts:78](../../src/main/ipc-registration/execution.ts#L78) | query | W06 / P6 / G06 | 現queryに復元・状態変更等を伴う。安全なGETとcommandへ分離して確認 |
| EXECUTION_STORAGE_DIAGNOSTICS | invoke: [execution.ts:83](../../src/main/ipc-registration/execution.ts#L83) | query | W06 / P6 / G06 |  |
| EXECUTION_RESTORE_BACKUP | invoke: [execution.ts:89](../../src/main/ipc-registration/execution.ts#L89) | command | W06 / P6 / G06 | 確認token;  |
| EXECUTION_RECONCILE | invoke: [execution.ts:144](../../src/main/ipc-registration/execution.ts#L144) | command | W06 / P6 / G06 |  |
| EXECUTION_LEAVE | invoke: [execution.ts:110](../../src/main/ipc-registration/execution.ts#L110) | ui-flow | W06 / P6 / G06 |  |
| EXECUTION_STOP_FOR_EDIT | invoke: [execution.ts:118](../../src/main/ipc-registration/execution.ts#L118) | command | W06 / P6 / G06 |  |
| EXECUTION_DISCARD_FOR_EDIT | invoke: [execution.ts:126](../../src/main/ipc-registration/execution.ts#L126) | command | W06 / P6 / G06 | 確認token;  |
| EXECUTION_GET | invoke: [execution.ts:176](../../src/main/ipc-registration/execution.ts#L176) | query | W06 / P6 / G06 |  |
| EXECUTION_STOP_SCHEDULING | invoke: [execution.ts:181](../../src/main/ipc-registration/execution.ts#L181) | command | W06 / P6 / G06 |  |
| EXECUTION_FORCE_INTERRUPT | invoke: [execution.ts:226](../../src/main/ipc-registration/execution.ts#L226) | command | W06 / P6 / G06 |  |
| EXECUTION_RESUME | invoke: [execution.ts:272](../../src/main/ipc-registration/execution.ts#L272) | command | W06 / P6 / G06 |  |
| EXECUTION_RESTART_REMOTE | invoke: [execution.ts:349](../../src/main/ipc-registration/execution.ts#L349) | command | W06 / P6 / G06 |  |
| EXECUTION_RESTART_FROM_SCRATCH | invoke: [execution.ts:383](../../src/main/ipc-registration/execution.ts#L383) | command | W06 / P6 / G06 | 確認token;  |
| FINAL_ARTIFACT_STATUS | invoke: [image.ts:83](../../src/main/ipc-registration/image.ts#L83) | query | W09 / P7 / G09 |  |
| FINAL_ARTIFACT_SELECT_DIRECTORY | invoke: [image.ts:87](../../src/main/ipc-registration/image.ts#L87) | native-replacement | W09 / P7 / G09 |  |
| FINAL_ARTIFACT_LIST_IMAGES | invoke: [image.ts:92](../../src/main/ipc-registration/image.ts#L92) | query | W09 / P7 / G09 |  |
| FINAL_ARTIFACT_READ_IMAGE | invoke: [image.ts:96](../../src/main/ipc-registration/image.ts#L96) | binary-query | W09 / P7 / G09 |  |
| FINAL_ARTIFACT_READ_PREVIEW | invoke: [image.ts:101](../../src/main/ipc-registration/image.ts#L101) | binary-query | W09 / P7 / G09 |  |
| CAPTION_STATUS | invoke: [image.ts:106](../../src/main/ipc-registration/image.ts#L106) | query | W09 / P7 / G09 |  |
| CAPTION_SELECT_SOURCE_DIRECTORY | invoke: [image.ts:110](../../src/main/ipc-registration/image.ts#L110) | native-replacement | W09 / P7 / G09 |  |
| CAPTION_IMPORT_GROK | invoke: [image.ts:116](../../src/main/ipc-registration/image.ts#L116) | command | W09 / P7 / G09 |  |
| CAPTION_GENERATE | invoke: [image.ts:122](../../src/main/ipc-registration/image.ts#L122) | command | W09 / P7 / G09 |  |
| CAPTION_SAVE_PIXIV_TITLE | invoke: [image.ts:127](../../src/main/ipc-registration/image.ts#L127) | command | W09 / P7 / G09 |  |
| THUMBNAIL_FONTS | invoke: [image.ts:132](../../src/main/ipc-registration/image.ts#L132) | query | W09 / P7 / G09 |  |
| THUMBNAIL_LOAD | invoke: [image.ts:133](../../src/main/ipc-registration/image.ts#L133) | query | W09 / P7 / G09 | 現queryに復元・状態変更等を伴う。安全なGETとcommandへ分離して確認 |
| THUMBNAIL_RESTORE_BACKUP | invoke: [image.ts:137](../../src/main/ipc-registration/image.ts#L137) | command | W09 / P7 / G09 | 確認token;  |
| THUMBNAIL_INITIALIZE_CORRUPT | invoke: [image.ts:154](../../src/main/ipc-registration/image.ts#L154) | command | W09 / P7 / G09 | 確認token;  |
| THUMBNAIL_SAVE | invoke: [image.ts:171](../../src/main/ipc-registration/image.ts#L171) | command | W09 / P7 / G09 |  |
| THUMBNAIL_SELECT_IMAGE | invoke: [image.ts:176](../../src/main/ipc-registration/image.ts#L176) | native-replacement | W09 / P7 / G09 |  |
| THUMBNAIL_LIST_IMAGES | invoke: [image.ts:188](../../src/main/ipc-registration/image.ts#L188) | query | W09 / P7 / G09 |  |
| THUMBNAIL_READ_IMAGE | invoke: [image.ts:208](../../src/main/ipc-registration/image.ts#L208) | binary-query | W09 / P7 / G09 |  |
| THUMBNAIL_READ_PREVIEW | invoke: [image.ts:212](../../src/main/ipc-registration/image.ts#L212) | binary-query | W09 / P7 / G09 |  |
| THUMBNAIL_READ_EDITOR_IMAGE | invoke: [image.ts:270](../../src/main/ipc-registration/image.ts#L270) | binary-query | W09 / P7 / G09 |  |
| THUMBNAIL_STORE_WEBP_PREVIEW | invoke: [image.ts:277](../../src/main/ipc-registration/image.ts#L277) | binary-command | W09 / P7 / G09 |  |
| THUMBNAIL_READ_TEMPLATE | invoke: [image.ts:282](../../src/main/ipc-registration/image.ts#L282) | binary-query | W09 / P7 / G09 |  |
| THUMBNAIL_EXPORT | invoke: [image.ts:424](../../src/main/ipc-registration/image.ts#L424) | binary-command | W09 / P7 / G09 |  |
| THUMBNAIL_DELETE_OUTPUTS | invoke: [image.ts:436](../../src/main/ipc-registration/image.ts#L436) | command | W09 / P7 / G09 |  |
| THUMBNAIL_PICKER_OPEN | invoke: [image.ts:288](../../src/main/ipc-registration/image.ts#L288) | ui-flow | W09 / P7 / G09 |  |
| THUMBNAIL_PICKER_CONTEXT | invoke: [image.ts:312](../../src/main/ipc-registration/image.ts#L312) | ui-flow | W09 / P7 / G09 |  |
| THUMBNAIL_PICKER_PERF | invoke: [image.ts:331](../../src/main/ipc-registration/image.ts#L331) | ui-flow | W09 / P7 / G09 |  |
| THUMBNAIL_PICKER_PERF_OPEN | invoke: [image.ts:324](../../src/main/ipc-registration/image.ts#L324) | native-replacement | W09 / P7 / G09 |  |
| THUMBNAIL_PICKER_PREVIEW | invoke: [image.ts:351](../../src/main/ipc-registration/image.ts#L351) | ui-flow | W09 / P7 / G09 |  |
| THUMBNAIL_PICKER_PREVIEW_RESULT | invoke: [image.ts:366](../../src/main/ipc-registration/image.ts#L366) | ui-flow | W09 / P7 / G09 |  |
| THUMBNAIL_PICKER_COMMIT | invoke: [image.ts:393](../../src/main/ipc-registration/image.ts#L393) | ui-flow | W09 / P7 / G09 |  |
| THUMBNAIL_PICKER_COMMIT_RESULT | invoke: [image.ts:408](../../src/main/ipc-registration/image.ts#L408) | ui-flow | W09 / P7 / G09 |  |
| THUMBNAIL_PICKER_PREVIEWED | notification: [image.ts:358](../../src/main/ipc-registration/image.ts#L358) | ui-flow | W09 / P7 / G09 |  |
| THUMBNAIL_PICKER_COMMITTED | notification: [image.ts:399](../../src/main/ipc-registration/image.ts#L399) | ui-flow | W09 / P7 / G09 |  |
| THUMBNAIL_PICKER_CANCELLED | notification: [main.ts:663](../../src/main/main.ts#L663) | ui-flow | W09 / P7 / G09 |  |
| MARKETPLACE_TARGETS | invoke: [image.ts:498](../../src/main/ipc-registration/image.ts#L498) | query | W09 / P7 / G09 |  |
| MARKETPLACE_LIST_THUMBNAILS | invoke: [image.ts:443](../../src/main/ipc-registration/image.ts#L443) | query | W09 / P7 / G09 |  |
| MARKETPLACE_READ_SOURCE | invoke: [image.ts:447](../../src/main/ipc-registration/image.ts#L447) | binary-query | W09 / P7 / G09 |  |
| MARKETPLACE_READ_SOURCE_PREVIEW | invoke: [image.ts:459](../../src/main/ipc-registration/image.ts#L459) | binary-query | W09 / P7 / G09 |  |
| MARKETPLACE_LOAD | invoke: [image.ts:499](../../src/main/ipc-registration/image.ts#L499) | query | W09 / P7 / G09 | 現queryに復元・状態変更等を伴う。安全なGETとcommandへ分離して確認 |
| MARKETPLACE_RESTORE_BACKUP | invoke: [image.ts:503](../../src/main/ipc-registration/image.ts#L503) | command | W09 / P7 / G09 | 確認token;  |
| MARKETPLACE_INITIALIZE_CORRUPT | invoke: [image.ts:520](../../src/main/ipc-registration/image.ts#L520) | command | W09 / P7 / G09 | 確認token;  |
| MARKETPLACE_SAVE | invoke: [image.ts:537](../../src/main/ipc-registration/image.ts#L537) | command | W09 / P7 / G09 |  |
| MARKETPLACE_GENERATE | invoke: [image.ts:542](../../src/main/ipc-registration/image.ts#L542) | binary-command | W09 / P7 / G09 |  |
| MARKETPLACE_GENERATE_ZIP | invoke: [image.ts:559](../../src/main/ipc-registration/image.ts#L559) | binary-command | W09 / P7 / G09 |  |
| MARKETPLACE_EXPORT_CUSTOM | invoke: [image.ts:567](../../src/main/ipc-registration/image.ts#L567) | binary-command | W09 / P7 / G09 |  |
| MARKETPLACE_RENDER_PNG | invoke: [image.ts:580](../../src/main/ipc-registration/image.ts#L580) | binary-command | W09 / P7 / G09 |  |
| MARKETPLACE_PICKER_OPEN | invoke: [image.ts:614](../../src/main/ipc-registration/image.ts#L614) | ui-flow | W09 / P7 / G09 |  |
| MARKETPLACE_PICKER_CONTEXT | invoke: [image.ts:624](../../src/main/ipc-registration/image.ts#L624) | ui-flow | W09 / P7 / G09 |  |
| MARKETPLACE_PICKER_PREVIEW | invoke: [image.ts:633](../../src/main/ipc-registration/image.ts#L633) | ui-flow | W09 / P7 / G09 |  |
| MARKETPLACE_PICKER_PREVIEW_RESULT | invoke: [image.ts:647](../../src/main/ipc-registration/image.ts#L647) | ui-flow | W09 / P7 / G09 |  |
| MARKETPLACE_PICKER_COMMIT | invoke: [image.ts:674](../../src/main/ipc-registration/image.ts#L674) | ui-flow | W09 / P7 / G09 |  |
| MARKETPLACE_PICKER_COMMIT_RESULT | invoke: [image.ts:688](../../src/main/ipc-registration/image.ts#L688) | ui-flow | W09 / P7 / G09 |  |
| MARKETPLACE_PICKER_PREVIEWED | notification: [image.ts:640](../../src/main/ipc-registration/image.ts#L640) | ui-flow | W09 / P7 / G09 |  |
| MARKETPLACE_PICKER_COMMITTED | notification: [image.ts:680](../../src/main/ipc-registration/image.ts#L680) | ui-flow | W09 / P7 / G09 |  |
| MARKETPLACE_PICKER_CANCELLED | notification: [main.ts:749](../../src/main/main.ts#L749) | ui-flow | W09 / P7 / G09 |  |
| R2_SETTINGS | invoke: [storage.ts:7](../../src/main/ipc-registration/storage.ts#L7) | query | W08 / P5 / G08 |  |
| R2_ENVIRONMENT | invoke: [storage.ts:8](../../src/main/ipc-registration/storage.ts#L8) | query | W08 / P5 / G08 |  |
| R2_TEST | invoke: [storage.ts:9](../../src/main/ipc-registration/storage.ts#L9) | command | W08 / P5 / G08 |  |
| R2_SAVE_SETTINGS | invoke: [storage.ts:10](../../src/main/ipc-registration/storage.ts#L10) | command | W08 / P5 / G08 |  |
| R2_BUCKETS | invoke: [storage.ts:17](../../src/main/ipc-registration/storage.ts#L17) | query | W08 / P5 / G08 |  |
| R2_CREATE_BUCKET | invoke: [storage.ts:18](../../src/main/ipc-registration/storage.ts#L18) | command | W08 / P5 / G08 |  |
| R2_DELETE_BUCKET | invoke: [storage.ts:25](../../src/main/ipc-registration/storage.ts#L25) | command | W08 / P5 / G08 |  |
| R2_LIST | invoke: [storage.ts:32](../../src/main/ipc-registration/storage.ts#L32) | query | W08 / P5 / G08 |  |
| R2_SEARCH | invoke: [storage.ts:36](../../src/main/ipc-registration/storage.ts#L36) | query | W08 / P5 / G08 |  |
| R2_DOWNLOAD_INFO | invoke: [storage.ts:40](../../src/main/ipc-registration/storage.ts#L40) | query | W08 / P5 / G08 |  |
| R2_BATCH_DOWNLOAD_INFO | invoke: [storage.ts:44](../../src/main/ipc-registration/storage.ts#L44) | query | W08 / P5 / G08 |  |
| R2_PUT_URL_INFO | invoke: [storage.ts:52](../../src/main/ipc-registration/storage.ts#L52) | query | W08 / P5 / G08 |  |
| R2_DELETE_OBJECTS | invoke: [storage.ts:66](../../src/main/ipc-registration/storage.ts#L66) | command | W08 / P5 / G08 |  |
| R2_MOVE | invoke: [storage.ts:77](../../src/main/ipc-registration/storage.ts#L77) | command | W08 / P5 / G08 |  |
| R2_SELECT_UPLOAD_FILES | invoke: [storage.ts:85](../../src/main/ipc-registration/storage.ts#L85) | native-replacement | W08 / P5 / G08 |  |
| R2_BEGIN_UPLOAD | invoke: [storage.ts:92](../../src/main/ipc-registration/storage.ts#L92) | command | W08 / P5 / G08 |  |
| R2_UPLOADS | invoke: [storage.ts:97](../../src/main/ipc-registration/storage.ts#L97) | query | W08 / P5 / G08 | 現queryに復元・状態変更等を伴う。安全なGETとcommandへ分離して確認 |
| R2_RESUME_UPLOAD | invoke: [storage.ts:98](../../src/main/ipc-registration/storage.ts#L98) | command | W08 / P5 / G08 |  |
| R2_PAUSE_UPLOAD | invoke: [storage.ts:102](../../src/main/ipc-registration/storage.ts#L102) | command | W08 / P5 / G08 |  |
| R2_CANCEL_UPLOAD | invoke: [storage.ts:106](../../src/main/ipc-registration/storage.ts#L106) | command | W08 / P5 / G08 |  |
| R2_TEMPLATES | invoke: [storage.ts:110](../../src/main/ipc-registration/storage.ts#L110) | query | W08 / P5 / G08 |  |
| R2_SAVE_TEMPLATE | invoke: [storage.ts:113](../../src/main/ipc-registration/storage.ts#L113) | command | W08 / P5 / G08 |  |
| R2_DELETE_TEMPLATE | invoke: [storage.ts:114](../../src/main/ipc-registration/storage.ts#L114) | command | W08 / P5 / G08 |  |
| R2_METRICS | invoke: [storage.ts:118](../../src/main/ipc-registration/storage.ts#L118) | query | W08 / P5 / G08 |  |
| CLIPBOARD_WRITE_TEXT | invoke: [storage.ts:119](../../src/main/ipc-registration/storage.ts#L119) | ui-local | W02 / P3 / G02 |  |
| ASSISTANT_GET_PROVIDER | invoke: [assistant.ts:83](../../src/main/ipc-registration/assistant.ts#L83) | query | W04 / P4 / G04 | 現queryに復元・状態変更等を伴う。安全なGETとcommandへ分離して確認 |
| ASSISTANT_SET_PROVIDER | invoke: [assistant.ts:104](../../src/main/ipc-registration/assistant.ts#L104) | command | W04 / P4 / G04 |  |
| ASSISTANT_SET_CONTEXT | invoke: [assistant.ts:112](../../src/main/ipc-registration/assistant.ts#L112) | ui-flow | W04 / P4 / G04 |  |
| ASSISTANT_CONTEXT | invoke: [assistant.ts:122](../../src/main/ipc-registration/assistant.ts#L122) | ui-flow | W04 / P4 / G04 |  |
| ASSISTANT_CONTEXT_CHANGED | notification: [assistant.ts:78](../../src/main/ipc-registration/assistant.ts#L78), [main.ts:1805](../../src/main/main.ts#L1805) | ui-flow | W04 / P4 / G04 |  |
| ASSISTANT_SNAPSHOT | invoke: [assistant.ts:126](../../src/main/ipc-registration/assistant.ts#L126) | query | W04 / P4 / G04 |  |
| ASSISTANT_SEND | invoke: [assistant.ts:129](../../src/main/ipc-registration/assistant.ts#L129) | command | W04 / P4 / G04 |  |
| ASSISTANT_STOP_TURN | invoke: [assistant.ts:145](../../src/main/ipc-registration/assistant.ts#L145) | command | W04 / P4 / G04 |  |
| ASSISTANT_NEW_CONVERSATION | invoke: [assistant.ts:150](../../src/main/ipc-registration/assistant.ts#L150) | command | W04 / P4 / G04 |  |
| ASSISTANT_RESTORE_CONVERSATION | invoke: [assistant.ts:163](../../src/main/ipc-registration/assistant.ts#L163) | command | W04 / P4 / G04 |  |
| ASSISTANT_MODELS | invoke: [assistant.ts:177](../../src/main/ipc-registration/assistant.ts#L177) | query | W04 / P4 / G04 |  |
| ASSISTANT_SELECT_MODEL | invoke: [assistant.ts:181](../../src/main/ipc-registration/assistant.ts#L181) | command | W04 / P4 / G04 |  |
| ASSISTANT_SET_VISIBLE | invoke: [assistant.ts:192](../../src/main/ipc-registration/assistant.ts#L192) | ui-local | W04 / P4 / G04 |  |
| ASSISTANT_SET_RATIO | invoke: [assistant.ts:198](../../src/main/ipc-registration/assistant.ts#L198) | ui-local | W04 / P4 / G04 |  |
| ASSISTANT_SET_DIVIDER_X | invoke: [assistant.ts:205](../../src/main/ipc-registration/assistant.ts#L205) | ui-local | W04 / P4 / G04 |  |
| AGENT_TASK_START | invoke: [assistant.ts:242](../../src/main/ipc-registration/assistant.ts#L242) | command | W04 / P4 / G04 |  |
| AGENT_TASK_STOP | invoke: [assistant.ts:260](../../src/main/ipc-registration/assistant.ts#L260) | command | W04 / P4 / G04 |  |
| AGENT_EVENT | notification: [main.ts:1866](../../src/main/main.ts#L1866), [main.ts:1873](../../src/main/main.ts#L1873) | event | W04 / P4 / G04 |  |
| AUTO_ARTIFACT_EVENT | notification: [main.ts:1952](../../src/main/main.ts#L1952), [main.ts:1953](../../src/main/main.ts#L1953) | event | W04 / P4 / G04 |  |

## Test全fileの実行経路と処置

現経路は旧版調査の分類。刷新branchではCIなし・新契約のローカル検証必須。旧schema互換・移行・fallbackを前提にしたtestは新要求へ置換/廃止し、旧Desktop専用testの成功を受入条件にしない。再利用する業務testも新入力契約を検証する。feature gateは対応先であり、そのtestだけでgateを満たす意味ではない。

| file | 現経路 | 処置 | 対象feature gate | 完了条件 |
| --- | --- | --- | --- | --- |
| [tests/agent-artifact-auto.cjs](../../tests/agent-artifact-auto.cjs) | npm-test | 契約維持・server buildへ適合 | G04 | P8までに新test実行経路へ接続 (G12) |
| [tests/agent-foundation.cjs](../../tests/agent-foundation.cjs) | npm-test | 契約維持・server buildへ適合 | G04 | P8までに新test実行経路へ接続 (G12) |
| [tests/agent-phase7-regression.cjs](../../tests/agent-phase7-regression.cjs) | npm-test | 契約維持・server buildへ適合 | G04 | P8までに新test実行経路へ接続 (G12) |
| [tests/anima-vae-placement.cjs](../../tests/anima-vae-placement.cjs) | npm-test | 契約維持・server buildへ適合 | G05 | P8までに新test実行経路へ接続 (G12) |
| [tests/assistant-pane.cjs](../../tests/assistant-pane.cjs) | standalone | 挙動検証へ置換/補完 | G04 | P0のbaseline-checklistの採否に従いP4で新test経路へ接続/旧test廃止/harness修復 (G12) |
| [tests/assistant-provider.cjs](../../tests/assistant-provider.cjs) | npm-test | 挙動検証へ置換/補完 | G04 | P8までに新test実行経路へ接続 (G12) |
| [tests/atomic-image-output.cjs](../../tests/atomic-image-output.cjs) | npm-test | 契約維持・server buildへ適合 | G09 | P8までに新test実行経路へ接続 (G12) |
| [tests/caption-stage.cjs](../../tests/caption-stage.cjs) | npm-test | 挙動検証へ置換/補完 | G09 | P8までに新test実行経路へ接続 (G12) |
| [tests/caption-stale.cjs](../../tests/caption-stale.cjs) | npm-test | 契約維持・server buildへ適合 | G09 | P8までに新test実行経路へ接続 (G12) |
| [tests/civitai-catalog.cjs](../../tests/civitai-catalog.cjs) | npm-test | 契約維持・server buildへ適合 | G07 | P8までに新test実行経路へ接続 (G12) |
| [tests/civitai-rate-limit.cjs](../../tests/civitai-rate-limit.cjs) | npm-test | 契約維持・server buildへ適合 | G07 | P8までに新test実行経路へ接続 (G12) |
| [tests/codex-cli-adapter.cjs](../../tests/codex-cli-adapter.cjs) | npm-test | 契約維持・server buildへ適合 | G04 | P8までに新test実行経路へ接続 (G12) |
| [tests/codex-cli-task-runner.cjs](../../tests/codex-cli-task-runner.cjs) | npm-test | 契約維持・server buildへ適合 | G04 | P8までに新test実行経路へ接続 (G12) |
| [tests/codex-snapshot-race.cjs](../../tests/codex-snapshot-race.cjs) | standalone | 挙動検証へ置換/補完 | G04 | P0のbaseline-checklistの採否に従いP4で新test経路へ接続/旧test廃止/harness修復 (G12) |
| [tests/codex-turn-status.cjs](../../tests/codex-turn-status.cjs) | standalone | 挙動検証へ置換/補完 | G04 | P0のbaseline-checklistの採否に従いP4で新test経路へ接続/旧test廃止/harness修復 (G12) |
| [tests/compiler-lora-mode.cjs](../../tests/compiler-lora-mode.cjs) | npm-test | 契約維持・server buildへ適合 | G05 | P8までに新test実行経路へ接続 (G12) |
| [tests/core-policy.cjs](../../tests/core-policy.cjs) | core-local | 契約維持・server buildへ適合 | G03, G06, G09, G10 | P1からcore単独回帰に接続済み。P2以降も必須 (G12) |
| [tests/execution-coordinator.cjs](../../tests/execution-coordinator.cjs) | npm-test | 契約維持・server buildへ適合 | G06 | P8までに新test実行経路へ接続 (G12) |
| [tests/execution-run.cjs](../../tests/execution-run.cjs) | npm-test | 挙動検証へ置換/補完 | G06 | P8までに新test実行経路へ接続 (G12) |
| [tests/execution-safe-exit.cjs](../../tests/execution-safe-exit.cjs) | npm-test | 挙動検証へ置換/補完 | G06 | P8までに新test実行経路へ接続 (G12) |
| [tests/final-artifact-stage.cjs](../../tests/final-artifact-stage.cjs) | npm-test | 挙動検証へ置換/補完 | G09 | P8までに新test実行経路へ接続 (G12) |
| [tests/fs-utils.cjs](../../tests/fs-utils.cjs) | npm-test | 契約維持・server buildへ適合 | G03 | P8までに新test実行経路へ接続 (G12) |
| [tests/grok-cli-adapter.cjs](../../tests/grok-cli-adapter.cjs) | standalone | 契約維持・server buildへ適合 | G04 | P0のbaseline-checklistの採否に従いP4で新test経路へ接続/旧test廃止/harness修復 (G12) |
| [tests/grok-cli-task-runner.cjs](../../tests/grok-cli-task-runner.cjs) | standalone | 契約維持・server buildへ適合 | G04 | P0のbaseline-checklistの採否に従いP4で新test経路へ接続/旧test廃止/harness修復 (G12) |
| [tests/grok-file-return-ui.cjs](../../tests/grok-file-return-ui.cjs) | npm-test | 挙動検証へ置換/補完 | G04 | P8までに新test実行経路へ接続 (G12) |
| [tests/grok-lora-fallback.cjs](../../tests/grok-lora-fallback.cjs) | npm-test | 契約維持・server buildへ適合 | G04 | P8までに新test実行経路へ接続 (G12) |
| [tests/grok-lora-selection-summary.cjs](../../tests/grok-lora-selection-summary.cjs) | npm-test | 挙動検証へ置換/補完 | G04 | P8までに新test実行経路へ接続 (G12) |
| [tests/grok-output-contract.cjs](../../tests/grok-output-contract.cjs) | npm-test | 挙動検証へ置換/補完 | G04 | P8までに新test実行経路へ接続 (G12) |
| [tests/grok-response-persistence.cjs](../../tests/grok-response-persistence.cjs) | npm-test | 契約維持・server buildへ適合 | G04 | P8までに新test実行経路へ接続 (G12) |
| [tests/image-memory-benchmark.cjs](../../tests/image-memory-benchmark.cjs) | CI-only | 契約維持・server buildへ適合 | G09 | P8までに新test実行経路へ接続 (G12) |
| [tests/image-memory-electron.cjs](../../tests/image-memory-electron.cjs) | CI-only | server/browser検証へ置換 | G09 | P8までに新test実行経路へ接続 (G12) |
| [tests/image-pipeline-core.cjs](../../tests/image-pipeline-core.cjs) | npm-test | 契約維持・server buildへ適合 | G09 | P8までに新test実行経路へ接続 (G12) |
| [tests/ipc-access.cjs](../../tests/ipc-access.cjs) | npm-test | 挙動検証へ置換/補完 | G01 | P8までに新test実行経路へ接続 (G12) |
| [tests/ipc-contract.cjs](../../tests/ipc-contract.cjs) | npm-test | 挙動検証へ置換/補完 | G01 | P8までに新test実行経路へ接続 (G12) |
| [tests/ipc-registration-modules.cjs](../../tests/ipc-registration-modules.cjs) | npm-test | 挙動検証へ置換/補完 | G01 | P8までに新test実行経路へ接続 (G12) |
| [tests/local-comfyui-execution.cjs](../../tests/local-comfyui-execution.cjs) | npm-test | 契約維持・server buildへ適合 | G06 | P8までに新test実行経路へ接続 (G12) |
| [tests/main-process-source.cjs](../../tests/main-process-source.cjs) | support | harness/fixture移植 | G12 | P8までに新test実行経路へ接続 (G12) |
| [tests/marketplace-generation-manifest.cjs](../../tests/marketplace-generation-manifest.cjs) | npm-test | 契約維持・server buildへ適合 | G09 | P8までに新test実行経路へ接続 (G12) |
| [tests/marketplace-image-stage.cjs](../../tests/marketplace-image-stage.cjs) | npm-test | 挙動検証へ置換/補完 | G09 | P8までに新test実行経路へ接続 (G12) |
| [tests/marketplace-picker-generation.cjs](../../tests/marketplace-picker-generation.cjs) | npm-test | 契約維持・server buildへ適合 | G09 | P8までに新test実行経路へ接続 (G12) |
| [tests/marketplace-write-guard.cjs](../../tests/marketplace-write-guard.cjs) | npm-test | 挙動検証へ置換/補完 | G01 | P8までに新test実行経路へ接続 (G12) |
| [tests/model-downstream-reset.cjs](../../tests/model-downstream-reset.cjs) | npm-test | 挙動検証へ置換/補完 | G03 | P8までに新test実行経路へ接続 (G12) |
| [tests/model-file-selection.cjs](../../tests/model-file-selection.cjs) | npm-test | 契約維持・server buildへ適合 | G05 | P8までに新test実行経路へ接続 (G12) |
| [tests/model-placement.cjs](../../tests/model-placement.cjs) | npm-test | 契約維持・server buildへ適合 | G05 | P8までに新test実行経路へ接続 (G12) |
| [tests/model-selection.cjs](../../tests/model-selection.cjs) | npm-test | 契約維持・server buildへ適合 | G05 | P8までに新test実行経路へ接続 (G12) |
| [tests/multi-window.cjs](../../tests/multi-window.cjs) | npm-test | 挙動検証へ置換/補完 | G02 | P8までに新test実行経路へ接続 (G12) |
| [tests/navigation.cjs](../../tests/navigation.cjs) | npm-test | 挙動検証へ置換/補完 | G02 | P8までに新test実行経路へ接続 (G12) |
| [tests/picker-selection-gate.cjs](../../tests/picker-selection-gate.cjs) | npm-test | 契約維持・server buildへ適合 | G09 | P8までに新test実行経路へ接続 (G12) |
| [tests/project-meta-serialization.cjs](../../tests/project-meta-serialization.cjs) | npm-test | 契約維持・server buildへ適合 | G03 | P8までに新test実行経路へ接続 (G12) |
| [tests/project-roots.cjs](../../tests/project-roots.cjs) | npm-test | 挙動検証へ置換/補完 | G03 | P8までに新test実行経路へ接続 (G12) |
| [tests/prompt-plan-v2.cjs](../../tests/prompt-plan-v2.cjs) | npm-test | 契約維持・server buildへ適合 | G05 | P8までに新test実行経路へ接続 (G12) |
| [tests/prompt-plan-warning-location.cjs](../../tests/prompt-plan-warning-location.cjs) | npm-test | 契約維持・server buildへ適合 | G05 | P8までに新test実行経路へ接続 (G12) |
| [tests/r2-manager-parity.cjs](../../tests/r2-manager-parity.cjs) | npm-test | 挙動検証へ置換/補完 | G08 | P8までに新test実行経路へ接続 (G12) |
| [tests/r2-object-index.cjs](../../tests/r2-object-index.cjs) | npm-test | 契約維持・server buildへ適合 | G08 | P8までに新test実行経路へ接続 (G12) |
| [tests/release-201-compare.cjs](../../tests/release-201-compare.cjs) | CI-conditional | 契約維持・server buildへ適合 | G09 | 条件付きperformance CIを維持/置換し発火pathも更新 (G12) |
| [tests/release-201-picker-benchmark.cjs](../../tests/release-201-picker-benchmark.cjs) | CI-conditional | server/browser検証へ置換 | G09 | 条件付きperformance CIを維持/置換し発火pathも更新 (G12) |
| [tests/remote-artifact-retrieval.cjs](../../tests/remote-artifact-retrieval.cjs) | npm-test | 挙動検証へ置換/補完 | G06 | P8までに新test実行経路へ接続 (G12) |
| [tests/remote-control-plane.cjs](../../tests/remote-control-plane.cjs) | npm-test | 契約維持・server buildへ適合 | G06 | P8までに新test実行経路へ接続 (G12) |
| [tests/remote-environment-bootstrap.cjs](../../tests/remote-environment-bootstrap.cjs) | npm-test | 契約維持・server buildへ適合 | G06 | P8までに新test実行経路へ接続 (G12) |
| [tests/remote-image-execution.cjs](../../tests/remote-image-execution.cjs) | npm-test | 契約維持・server buildへ適合 | G06 | P8までに新test実行経路へ接続 (G12) |
| [tests/remote-instance-lifecycle.cjs](../../tests/remote-instance-lifecycle.cjs) | npm-test | 契約維持・server buildへ適合 | G06 | P8までに新test実行経路へ接続 (G12) |
| [tests/remote-model-staging.cjs](../../tests/remote-model-staging.cjs) | npm-test | 契約維持・server buildへ適合 | G06 | P8までに新test実行経路へ接続 (G12) |
| [tests/run.cjs](../../tests/run.cjs) | npm-test | 契約維持・server buildへ適合 | G03, G05 | P8までに新test実行経路へ接続 (G12) |
| [tests/service-integrations-ui.cjs](../../tests/service-integrations-ui.cjs) | npm-test | 挙動検証へ置換/補完 | G07, G08, G10 | P8までに新test実行経路へ接続 (G12) |
| [tests/source-match.cjs](../../tests/source-match.cjs) | support | harness/fixture移植 | G12 | P8までに新test実行経路へ接続 (G12) |
| [tests/stage-load-recovery.cjs](../../tests/stage-load-recovery.cjs) | npm-test | 挙動検証へ置換/補完 | G02 | P8までに新test実行経路へ接続 (G12) |
| [tests/standard-graph-fixture.cjs](../../tests/standard-graph-fixture.cjs) | support | harness/fixture移植 | G12 | P8までに新test実行経路へ接続 (G12) |
| [tests/thumbnail-cache-prune.cjs](../../tests/thumbnail-cache-prune.cjs) | npm-test | 契約維持・server buildへ適合 | G09 | P8までに新test実行経路へ接続 (G12) |
| [tests/thumbnail-stage.cjs](../../tests/thumbnail-stage.cjs) | npm-test | 挙動検証へ置換/補完 | G09 | P8までに新test実行経路へ接続 (G12) |
| [tests/ui-state.cjs](../../tests/ui-state.cjs) | npm-test | 契約維持・server buildへ適合 | G02 | P8までに新test実行経路へ接続 (G12) |
| [tests/vastai-client.cjs](../../tests/vastai-client.cjs) | npm-test | 契約維持・server buildへ適合 | G07 | P8までに新test実行経路へ接続 (G12) |
| [tests/workflow-api-graph.cjs](../../tests/workflow-api-graph.cjs) | npm-test | 契約維持・server buildへ適合 | G05 | P8までに新test実行経路へ接続 (G12) |
| [tests/workflow-model-family.cjs](../../tests/workflow-model-family.cjs) | npm-test | 契約維持・server buildへ適合 | G05 | P8までに新test実行経路へ接続 (G12) |
| [tests/workflow-template-line-endings.cjs](../../tests/workflow-template-line-endings.cjs) | npm-test | 契約維持・server buildへ適合 | G05 | P8までに新test実行経路へ接続 (G12) |

## Binary resource（code fileと別母集団）

| file | role | 処置 |
| --- | --- | --- |
| [thumbnail/psd-templates/thumbnail-template-3-images-preview.png](../../thumbnail/psd-templates/thumbnail-template-3-images-preview.png) | reference-preview | reference保持・視覚比較の採否を記録 (W13/G13) |
| [thumbnail/psd-templates/thumbnail-template-3-images.psd](../../thumbnail/psd-templates/thumbnail-template-3-images.psd) | runtime-PSD | server resource配置・PSD編集/書出検証 (W13/G13) |
| [thumbnail/psd-templates/thumbnail-template-4-images-left-split-preview.png](../../thumbnail/psd-templates/thumbnail-template-4-images-left-split-preview.png) | reference-preview | reference保持・視覚比較の採否を記録 (W13/G13) |
| [thumbnail/psd-templates/thumbnail-template-4-images-left-split.psd](../../thumbnail/psd-templates/thumbnail-template-4-images-left-split.psd) | runtime-PSD | server resource配置・PSD編集/書出検証 (W13/G13) |
| [thumbnail/psd-templates/thumbnail-template-4-images-right-split-preview.png](../../thumbnail/psd-templates/thumbnail-template-4-images-right-split-preview.png) | reference-preview | reference保持・視覚比較の採否を記録 (W13/G13) |
| [thumbnail/psd-templates/thumbnail-template-4-images-right-split.psd](../../thumbnail/psd-templates/thumbnail-template-4-images-right-split.psd) | runtime-PSD | server resource配置・PSD編集/書出検証 (W13/G13) |
| [thumbnail/psd-templates/thumbnail-template-5-images-both-split-preview.png](../../thumbnail/psd-templates/thumbnail-template-5-images-both-split-preview.png) | reference-preview | reference保持・視覚比較の採否を記録 (W13/G13) |
| [thumbnail/psd-templates/thumbnail-template-5-images-both-split.psd](../../thumbnail/psd-templates/thumbnail-template-5-images-both-split.psd) | runtime-PSD | server resource配置・PSD編集/書出検証 (W13/G13) |

## 既存仕様文書（実装完了前にActive仕様を上書きしない）

| file | 処置 |
| --- | --- |
| [docs/README.md](../../docs/README.md) | 移行完了時に該当仕様を更新 (W11/G11) |
| [docs/architecture/atomic-persistence.md](../../docs/architecture/atomic-persistence.md) | 移行完了時に該当仕様を更新 (W11/G11) |
| [docs/architecture/ipc-access.md](../../docs/architecture/ipc-access.md) | 移行完了時に該当仕様を更新 (W11/G11) |
| [docs/architecture/ipc-contract.md](../../docs/architecture/ipc-contract.md) | 移行完了時に該当仕様を更新 (W11/G11) |
| [docs/architecture/picker-selection.md](../../docs/architecture/picker-selection.md) | 移行完了時に該当仕様を更新 (W11/G11) |
| [docs/architecture/project-window-execution-runtime.md](../../docs/architecture/project-window-execution-runtime.md) | 移行完了時に該当仕様を更新 (W11/G11) |
| [docs/architecture/remote-execution.md](../../docs/architecture/remote-execution.md) | 移行完了時に該当仕様を更新 (W11/G11) |
| [docs/architecture/standard-image-execution.md](../../docs/architecture/standard-image-execution.md) | 移行完了時に該当仕様を更新 (W11/G11) |
| [docs/architecture/system-architecture.md](../../docs/architecture/system-architecture.md) | 移行完了時に該当仕様を更新 (W11/G11) |
| [docs/architecture/workflow-compiler.md](../../docs/architecture/workflow-compiler.md) | 移行完了時に該当仕様を更新 (W11/G11) |
| [docs/contracts/agent-contract.md](../../docs/contracts/agent-contract.md) | 移行完了時に該当仕様を更新 (W11/G11) |
| [docs/contracts/project-artifacts.md](../../docs/contracts/project-artifacts.md) | 移行完了時に該当仕様を更新 (W11/G11) |
| [docs/contracts/prompt-plan.md](../../docs/contracts/prompt-plan.md) | 移行完了時に該当仕様を更新 (W11/G11) |
| [docs/decisions/decision-log.md](../../docs/decisions/decision-log.md) | 過去判断を保持し新判断を追記 (W11/G11) |
| [docs/decisions/model-family-and-base-model-selection.md](../../docs/decisions/model-family-and-base-model-selection.md) | 過去判断を保持し新判断を追記 (W11/G11) |
| [docs/integrations/external-tools.md](../../docs/integrations/external-tools.md) | 移行完了時に該当仕様を更新 (W11/G11) |
| [docs/integrations/service-integrations.md](../../docs/integrations/service-integrations.md) | 移行完了時に該当仕様を更新 (W11/G11) |
| [docs/operations/docker-local-tests.md](../../docs/operations/docker-local-tests.md) | 移行完了時に該当仕様を更新 (W11/G11) |
| [docs/operations/thumbnail-picker-performance-logs.md](../../docs/operations/thumbnail-picker-performance-logs.md) | 移行完了時に該当仕様を更新 (W11/G11) |
| [docs/operations/versioning.md](../../docs/operations/versioning.md) | 移行完了時に該当仕様を更新 (W11/G11) |
| [docs/product/scope-and-flow.md](../../docs/product/scope-and-flow.md) | 移行完了時に該当仕様を更新 (W11/G11) |
| [docs/quality/standard-image-execution-validation.md](../../docs/quality/standard-image-execution-validation.md) | 移行完了時に該当仕様を更新 (W11/G11) |
| [docs/quality/validation-and-security.md](../../docs/quality/validation-and-security.md) | 移行完了時に該当仕様を更新 (W11/G11) |
| [docs/requirements/requirements.md](../../docs/requirements/requirements.md) | 移行完了時に該当仕様を更新 (W11/G11) |
| [docs/roadmap/implementation-phases.md](../../docs/roadmap/implementation-phases.md) | 移行完了時に該当仕様を更新 (W11/G11) |
| [docs/ui/application-shell.md](../../docs/ui/application-shell.md) | 移行完了時に該当仕様を更新 (W11/G11) |
| [docs/ui/japanese-ux-design.md](../../docs/ui/japanese-ux-design.md) | 移行完了時に該当仕様を更新 (W11/G11) |
| [docs/ui/project-initialization.md](../../docs/ui/project-initialization.md) | 移行完了時に該当仕様を更新 (W11/G11) |
| [README.md](../../README.md) | 移行完了時に該当仕様を更新 (W11/G11) |
| [AGENTS.md](../../AGENTS.md) | 既存rule遵守・変更不要 (W11/G11) |
| [thumbnail/psd-templates/README.md](../../thumbnail/psd-templates/README.md) | 移行完了時に該当仕様を更新 (W11/G11) |
