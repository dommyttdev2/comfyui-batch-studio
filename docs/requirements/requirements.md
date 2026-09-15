# Requirements Registry

Status: Active

この文書は要件の索引である。詳細設計をここへ重複記載せず、各要件の正本となる文書へリンクする。

## 1. Product / Scope

| ID | Status | Requirement | Owner |
| --- | --- | --- | --- |
| REQ-SCOPE-001 | Decided | Batch Studio はプロジェクト作成からPreflight、Local / Remote ComfyUIでの生成実行、成果物回収までを支援する。`READY`は実行開始可能状態、`COMPLETED`は対象Execution Runの成果物確認・回収まで完了した状態とする。 | `product/scope-and-flow.md` |
| REQ-SCOPE-002 | Decided | Grok Web はユーザーが直接操作し、Batch Studio は Grok の入力欄・添付・送信・回答取得を自動操作しない。 | `product/scope-and-flow.md` |
| REQ-SCOPE-003 | Decided | Grok の回答は下書きであり、ユーザー確認と Batch Studio の検証を経て明示保存されたファイルだけをプロジェクト成果物として扱う。 | `contracts/project-artifacts.md` |

## 2. Project / Story

| ID | Status | Requirement | Owner |
| --- | --- | --- | --- |
| REQ-PROJ-001 | Decided | 初期画面は細かなストーリー設計を要求せず、プロジェクト名・対象キャラクター・ターゲット読者・固定前提・大まかな要望を Brief として保存する。 | `ui/project-initialization.md` |
| REQ-PROJ-002 | Decided | `project.id` は表示名とは独立した filesystem-safe stable ID とし、`^[a-z0-9][a-z0-9._-]{0,63}$` を満たす。ComfyUI内の生成物保存先等の機械識別には `project.id` を使用する。Workflow JSONのファイル名だけはProject実フォルダの1階層上にある作成先フォルダ名を使用し、`LoRA_{作成先フォルダ名}.json` とする。 | `ui/project-initialization.md` / `architecture/workflow-compiler.md` |
| REQ-PROJ-003 | Implemented | app-wide の `Project root` を新規Project作成先の既定値とする。`成果物配置 root` が設定されている場合はProject作成時に `<artifactRoot>/<project.id>` を作成し、その絶対pathを `project_meta.json.settings.artifactOutputPath` に保存する。設定値は `BATCH_STUDIO_PROJECT_ROOT` / `BATCH_STUDIO_ARTIFACT_ROOT` としてruntimeへ反映する。 | `ui/project-initialization.md` / `integrations/service-integrations.md` |
| REQ-PROJ-004 | Implemented | File menuのNew Project / Open Projectでは「現在のWindow」「新しいWindow」「キャンセル」を選択できる。複数Project Windowを同時に開けるが、同一Project rootは同時に1 Windowのみとし、既に開かれている場合は既存Windowをfocusする。 | `ui/application-shell.md` / `architecture/project-window-execution-runtime.md` |
| REQ-PROJ-005 | Implemented | 通常起動時は前回最後にfocusされていた有効Projectを1件だけ復元し、終了時に開いていた全Project WindowやWindow layoutを自動復元しない。Standalone WindowからNew/Open Projectを実行する場合は最後にfocusされたProject Windowをcurrent targetとし、Project Windowが存在しなければcurrent-window openingを許可しない。 | `architecture/project-window-execution-runtime.md` / `ui/application-shell.md` |
| REQ-STORY-001 | Decided | Story の調査・案出し・詳細化は Grok に担当させ、ユーザーとの会話後に `story.md` を確定する。 | `contracts/grok-contract.md` |

## 3. Model Selection

| ID | Status | Requirement | Owner |
| --- | --- | --- | --- |
| REQ-MODEL-001 | Implemented | Model Family と基盤モデルはユーザーが Batch Studio UI で選択する。Illustrious は Checkpoint、Anima は Diffusion Model / Text Encoder / VAE を選択し、Grok は基盤モデルを変更せず LoRA 選定だけを担当する。 | `decisions/model-family-and-base-model-selection.md` / `product/scope-and-flow.md` |
| REQ-MODEL-002 | Implemented | Illustrious Checkpoint / Anima Diffusion Model は Batch Studio が同期する Civitai `model_catalog.json` からユーザーが選択する。Anima Text Encoder / VAE は Local/R2 の用途別inventoryから選択する。Grok の LoRA 選定は `model_catalog.json` を根拠に行う。 | `integrations/external-tools.md` / `decisions/model-family-and-base-model-selection.md` |
| REQ-MODEL-003 | Decided | Batch Studio は Grok の選定結果を `model_catalog.json` と照合し、存在しない Model / Version / File を確定させない。 | `quality/validation-and-security.md` |
| REQ-MODEL-004 | Implemented | カタログ内に必要LoRAがない場合、Grokは架空のidentityを作らず、Civitai公開情報で代替候補を調査し、複数LoRAの組合せまたはPrompt代替で解決可能かを評価する。カタログ外候補や代替不能要件だけを `missingRequirements` とし、Promptで解決できる要件は `promptFallbacks` として扱う。 | `contracts/grok-contract.md` |
| REQ-MODEL-005 | Decided | `models.json` はモデル選定時に使用した `model_catalog.json` の provenance として少なくとも `schemaVersion`、`generation`、`generatedAt` を記録する。現在の catalog の `generation` が異なる場合は選定済み Model / Version / File を現在の catalog に対して再検証し、generation の不一致だけでは `models.json` を無効化しない。 | `contracts/project-artifacts.md` |
| REQ-MODEL-006 | Implemented | `models.json` は Batch Studio 専用schemaを使用する。新規保存は Schema v5 とし、Schema v1〜v4 は既存Projectの読み取り・必要なWorkflow生成互換のため保持する。 | `contracts/project-artifacts.md` / `schemas/models.schema.json` |
| REQ-MODEL-007 | Decided | LoRA の推奨・基準強度を Civitai 由来の情報として取得できる場合、`models.json` にその値と provenance を保持する。Civitai に根拠となる情報がない場合は値を捏造しない。 | `contracts/project-artifacts.md` |
| REQ-MODEL-008 | Implemented | `models.json` の現行保存形式は Schema v5。Illustrious は `checkpoint.main`、Anima は `diffusion_model.main` + `textEncoder` + `vae`、共通で `loras[]` を持つ。Civitai identity、名前、URL、`trainedWords`、Grokの`reason`、任意の`strengthBaseline`を保持する。`missingRequirements` / `promptFallbacks` はDraft処理用で、確定時に前者を許可せず、後者は `._batch_studio/model_prompt_fallbacks.json` へ分離保存する。 | `contracts/project-artifacts.md` / `schemas/models.schema.json` |
| REQ-MODEL-009 | Implemented | Civitai 投稿画像の LoRA weight から `observed-usage-derived` の `strengthBaseline` を作る場合、exact `modelVersionId` の Newest 最大200画像を metadata 付きで取得し、同一 `postId` 内の有効 weight の median を1 observation としたうえで、その post median 群の median を採用する。最低5 distinct postsを要求し、追加の範囲filter / outlier除去は行わない。provenance `method` は `median-of-post-medians:newest-200`、`sampleCount` は distinct post 数とする。根拠不足時は `strengthBaseline` を生成しない。 | `contracts/project-artifacts.md` |
| REQ-MODEL-010 | Implemented | 基盤モデルまたは確定LoRA集合等、後段生成に影響するmodel inputsが変更された場合は Prompt Plan / Workflow 等の下流Artifactをresetし、古い生成物をそのまま有効扱いしない。 | `decisions/model-family-and-base-model-selection.md` / `contracts/project-artifacts.md` |

## 4. Prompt Planning

| ID | Status | Requirement | Owner |
| --- | --- | --- | --- |
| REQ-PLAN-001 | Decided | Grok から Workflow JSON を受け取らず、Common / Branch / Leaf scopeへ分類した構造化Prompt tag、Root / Branch LoRA usageをJSONで受け取る。最終Prompt文字列はBatch Studioがcompileする。 | `contracts/prompt-plan.md` |
| REQ-PLAN-002 | Decided | Grok の JSON は ComfyUI の Node ID、Link ID、`widgets_values`、`scene_matrix_json` 等の内部形式を含まない。 | `contracts/prompt-plan.md` |
| REQ-PLAN-003 | Decided | Grok から受け取り、Batch Studio の検証とユーザー承認を経て確定する構造化 Prompt Plan の標準ファイル名を `prompt_plan.json` とする。プロジェクトごとに確定版は1ファイルとし、Workflow Compiler はこのファイルを Prompt Plan の機械可読入力として使用する。確定前の回答や旧版は `prompt_plan.json` を上書きせず Draft / History 領域で管理する。 | `contracts/prompt-plan.md` |
| REQ-PLAN-004 | Decided | `prompt_plan.json` を Prompt 設計の機械可読な正本とし、人間向けの確認・編集は Batch Studio の Prompt Plan Web UI で提供する。新規プロジェクトでは `prompt_tree.md` を標準 Artifact として生成・維持せず、Workflow Compiler の入力にも使用しない。既存の `prompt_tree.md` は Legacy Artifact としてのみ扱う。 | `contracts/project-artifacts.md` |
| REQ-PLAN-005 | Decided | `prompt_plan.json` は Root / Branch で実際に適用する LoRA 強度を保持する。この値は Batch Studio の Web UI から調整可能とし、`models.json` に保存した Civitai 由来の推奨・基準値を書き換えない。 | `contracts/prompt-plan.md` |
| REQ-PLAN-006 | Decided | `prompt_plan.json` の機械可読schemaを `schemas/prompt-plan.schema.json` とする。Schema v1は既存Projectのread/edit/compile互換として維持し、新規Prompt PlanはSchema v2を使用する。Branch ID / Leaf IDはProject全体で一意、配列順を順序の正本とし、LoRA usageとstrict unknown-field policyを維持する。 | `contracts/prompt-plan.md` |
| REQ-PLAN-007 | Decided | `models.json` に Civitai 由来 `strengthBaseline.value = w` が存在し、そのbaselineを Prompt Plan の初期値に使用する場合は `strengthModel = w`、`strengthClip = w` と同値展開する。この展開は単一source scalarの機械的初期化であり、CivitaiがModel/CLIP別値を推奨した意味ではない。baselineが存在しない場合、Batch Studioは経験則による暗黙defaultを補完せず、Grokまたはユーザーが実適用値を明示する。 | `contracts/prompt-plan.md` |
| REQ-PLAN-008 | Implemented | Schema v2ではPromptを意味category別tag arrayとして保存し、Model Family quality preset、Base/Root/Branch LoRA trainedWords注入、category順、exact dedupe、最終positive/negative文字列化をBatch Studio Prompt Compilerが所有する。GrokはtrainedWordsをPrompt Planへ転記しない。 | `contracts/prompt-plan.md` / `architecture/workflow-compiler.md` |
| REQ-PLAN-009 | Implemented | Schema v2 Prompt Planをsemantic validationし、Model Family tag dialect、Positive/Negative conflict、parent/child duplicate、camera angle/framing/gaze conflict等を検出する。Prompt Plan UIではcategory編集とCompiled Prompt Previewを提供する。 | `contracts/prompt-plan.md` |

## 5. Workflow Compiler

| ID | Status | Requirement | Owner |
| --- | --- | --- | --- |
| REQ-WF-001 | Decided | 最終 ComfyUI Workflow は Batch Studio が機械的に生成する。Grok に Workflow JSON を編集・生成させない。 | `architecture/workflow-compiler.md` |
| REQ-WF-002 | Decided | 基本テンプレート Workflow は共通部と枝 Prototype 1本だけを持つ。 | `architecture/workflow-compiler.md` |
| REQ-WF-003 | Decided | `prompt_plan` の枝数に応じて Prototype を複製し、必要な枝だけを最終 Workflow に存在させる。 | `architecture/workflow-compiler.md` |
| REQ-WF-004 | Decided | 最終 Workflow に未使用枝、空の予約枝、未使用枝用 bypass ノード群を残さない。 | `architecture/workflow-compiler.md` |
| REQ-WF-005 | Decided | Compiler は枝複製時に Node ID、Link ID、関連参照、Group、座標を衝突なく再生成する。 | `architecture/workflow-compiler.md` |
| REQ-WF-006 | Decided | Root LoRA は全枝共通、Branch LoRA は当該枝だけに適用する。Root LoRA が不要なプロジェクトでは空 Stack を許容する。 | `architecture/workflow-compiler.md` |
| REQ-WF-007 | Decided | Template の可変Nodeを Node ID のコード埋め込みで特定せず、`schemas/workflow-template-manifest.schema.json` に従う Manifest の semantic role、Prototype ownership、Common→Branch boundary から解決する。Prototype内部Linkは両端Nodeのownershipから自動導出し、ManifestへLink ID一覧を重複保持しない。 | `architecture/workflow-compiler.md` |
| REQ-WF-008 | Decided | Manifest Schema v1 は Common/Branch role、`branchPrototype.nodeIds` / `groupIds`、Boundaryのrole+slot、2次元layout offset、`manifestVersion`、Template `id` / `version` / SHA-256 binding を定義する。Template hash不一致や未宣言cross-boundary LinkはCompileをBlockする。Compiler versionとManifest hashはManifest自身ではなくWorkflow build provenanceとして `project_meta.json` 側へ記録する。 | `architecture/workflow-compiler.md` |
| REQ-WF-009 | Decided | v1 の生成枚数は `1 leaf = 1 image` とし、Branch枚数は `branch.leaves.length`、Project実枚数は全leaf総数からCompilerが算出する。`project_brief.json` の `generation.target_image_count` はPrompt設計の目標値であり差分だけではCompileをBlockしない。Workflow名は `LoRA_{Project実フォルダの親フォルダ名}.json`、ComfyUI保存先は `BatchStudio/{project.id}/{branch.id}`、SceneMatrix `row_id` / `path_label` / `name` はいずれも `leaf.id` とする。`leaf.name` はBatch Studio UI上の人間向け表示名として保持する。 | `architecture/workflow-compiler.md` |
| REQ-WF-010 | Decided | Execution用にUI Workflowと対応するdeterministicなComfyUI API-format graphを生成またはTemplate contractから解決できるようにする。任意のUI Workflowを汎用変換する方式を主経路にしない。 | `architecture/remote-execution.md` |

## 6. Integrations

| ID | Status | Requirement | Owner |
| --- | --- | --- | --- |
| REQ-INT-001 | Decided | Civitai Collection同期、API key管理、`model_catalog.json`生成は Batch Studio Electron Main Process が担当し、Renderer/GrokへAPI keyを渡さない。旧 `civit-model-viewer` はStandalone/Legacyとする。 | `integrations/external-tools.md` |
| REQ-INT-002 | Decided | Cloudflare R2のバケット・object・upload・download・delete・move・signed/public URL操作は Batch Studio Electron Main Process が担当する。Remote Execution用のsigned GET / presigned PUT / Local回収も同一Integrated R2 Managerが所有し、旧 `r2-file-manager` はStandalone/Legacyとする。 | `integrations/external-tools.md` |
| REQ-INT-003 | Decided | Batch Studio は Civitai API key と R2 secret を Grok へ渡さない。R2 Secret/API TokenはProjectファイルやRendererへ平文保存せず、Electron Main ProcessのOS暗号化ストレージで保護する。 | `quality/validation-and-security.md` |
| REQ-INT-004 | Decided | Civitai 由来 LoRA strength evidence は Batch Studio が exact version の投稿metadataから決定済みpolicyで optional `strengthBaseline` と provenance を生成する。説明文解析や経験則による値を Civitai provenance として捏造しない。 | `integrations/external-tools.md` |
| REQ-INT-005 | Decided | R2一括DLはメイン一覧の削除選択と独立した選択状態を持ち、フォルダ移動・バケット内検索を跨いで最大500件を保持する。URLは最終生成時だけ発行し、URL/curl/wget/aria2cを提供する。 | `integrations/external-tools.md` |
| REQ-INT-006 | Decided | 大容量R2 uploadはMain Processからmultipartで実行し、進捗・pause/resume/cancelを提供する。未完了upload stateはapp dataへ永続化し、再起動後に再開可能とする。 | `integrations/external-tools.md` |
| REQ-INT-007 | Implemented | Projectを閉じたHomeではProject管理と「サービス連携」を主要入口とし、R2 / Civitai / Cloud Instance credential管理をサービス連携へ集約する。連携済みサービスはHome左navigation内にのみ条件付き表示し、環境設定はBatch Studio自身のローカル設定を所有する。 | `integrations/service-integrations.md` / `ui/application-shell.md` |
| REQ-INT-008 | Decided | 初期Cloud Instance ProviderをVast.aiとし、API Keyは`safeStorage`で暗号化保存し、既存runnerとの互換のため`VASTAI_API_KEY`をenvironment fallbackとして利用する。保存済みAPI KeyをRenderer/Projectへ返さない。 | `integrations/service-integrations.md` |
| REQ-INT-009 | Decided | Vast.ai連携はElectron Main ProcessからREST APIを利用し、Instance一覧、status正規化、start、stop、current public SSH endpoint解決を提供する。Python subprocess / Vast.ai CLIを必須依存としない。 | `integrations/service-integrations.md` |
| REQ-INT-010 | Decided | Remote Projectは`remoteProvider=vastai`と`remoteInstanceId`をstable selectionとして保持し、SSH Host / PortはProjectへ固定保存せず、実行時にVast.ai APIから最新値を解決する。 | `integrations/service-integrations.md` / `architecture/remote-execution.md` |
| REQ-INT-011 | Decided | Vast.ai Remote接続は公開SSH + private-key authenticationを前提とし、SSH private key contentsをapp config/ProjectへコピーせずLocal pathだけを保持する。SSH Tunnelとpassword fallbackを使用しない。 | `integrations/service-integrations.md` / `architecture/remote-execution.md` |
| REQ-INT-012 | Implemented | Civitai同期はCollection membershipを毎回正本として再取得し、Model/Version/Baseline/thumbnail metadataはTTL付きapp data cacheを再利用する。429/一時5xx/network errorはbounded retryし、API request/cache/retry/429/5xx/page/membership/elapsed metricsをCivit Explorerへ表示する。 | `integrations/external-tools.md` |
| REQ-INT-013 | Implemented | Standalone R2 File Manager は指定Object Key向けの短命presigned PUT URLとcurlコマンドを生成できる。有効期限は1秒〜7日、Content-Type固定は任意で、同名ObjectはPUTにより上書きされ得ることをUIで警告する。 | `integrations/external-tools.md` |
| REQ-INT-014 | Implemented | Electron application menu の `Window` から R2 File Manager、Civit Explorer、Vast.ai を独立した別ウィンドウで開ける。同一toolの既存windowがあれば新規作成せず再表示・focusする。 | `ui/application-shell.md` |
| REQ-INT-015 | Implemented | Vast.ai管理画面ではComfyUI Template互換のOn-demand Offerを検索・自動更新し、Storage / GPU計算性能 / GPU数 / Reliability / 除外国等の条件で絞り込み、選択Offerを確認後にRENTしてInstanceを作成できる。利用不能Offerは一時的に検索結果から抑止して再検索する。 | `integrations/service-integrations.md` |
| REQ-INT-016 | Implemented | Vast.ai Instance管理では一覧の自動更新に加え、start、stop / scheduling cancel、destroy、rebootを提供する。destroyは取消不能の破壊操作としてMain Processの確認dialogを必須とする。 | `integrations/service-integrations.md` |

## 7. Execution

| ID | Status | Requirement | Owner |
| --- | --- | --- | --- |
| REQ-EXEC-001 | Decided | `executionTarget=local` ではLocal ComfyUI APIを使用し、必要モデルのLocal配置を必須、R2配置を任意とする。 | `architecture/remote-execution.md` |
| REQ-EXEC-002 | Decided | `executionTarget=remote` ではCloud Instance Providerからcurrent SSH endpointを解決し、公開SSH endpointへの秘密鍵認証をcontrol planeとする。SSH Tunnelを使用せず、Remote WorkerがRemote host内のlocalhost ComfyUI APIを操作する。 | `architecture/remote-execution.md` |
| REQ-EXEC-003 | Decided | Remote targetの必要モデルはR2をsourceとし、public/presigned GET URLでRemote hostが直接取得する。multi-GB model binaryをSSH/SCPで転送しない。 | `architecture/remote-execution.md` |
| REQ-EXEC-004 | Decided | Scene Prompt Tools `ScenePrompterExpand` の連続生成はfrontend button操作ではなく、標準ComfyUI APIとScene Prompt Tools custom run-context APIのorchestrationで再現する。 | `architecture/remote-execution.md` |
| REQ-EXEC-005 | Decided | Remote成果物はRemoteでmanifest/package/hashを作成し、Main Processが発行する短命presigned PUT URLでR2へuploadする。R2 credentialをRemoteへ渡さない。 | `architecture/remote-execution.md` |
| REQ-EXEC-006 | Decided | Remote RunはR2へuploadした成果物をLocalへdownloadし、Local SHA-256とRemote package SHA-256が一致した後にのみ`COMPLETED`とする。 | `architecture/remote-execution.md` |
| REQ-EXEC-007 | Decided | Executionはpersistent Runとしてphase、prompt ID、artifact evidence等を保持し、既に検証済みの高コスト工程を無条件に再実行せずResume可能とする。Secretや不要なsigned URLはRun Stateへ保存しない。 | `architecture/remote-execution.md` |
| REQ-EXEC-008 | Decided | 通常停止は次promptのscheduleを止め、Force Interruptはcurrent promptへのComfyUI interruptとして分離する。他Runのqueueを変更しない。 | `architecture/remote-execution.md` |
| REQ-EXEC-009 | Decided | Vast.ai選択時はRun開始時にInstanceのcurrent stateを再取得し、stoppedならstartしてrunning/SSH endpoint readinessを確認する。Run前からrunningだったInstanceとBatch Studioが起動したInstanceを区別し、initial-state preservationを既定思想とする。 | `architecture/remote-execution.md` |
| REQ-EXEC-010 | Implemented | `LocalExecutionService` / `RemoteExecutionService` とactive worker / SSH session / runtime resource lockはProjectやProject Windowの所有物にせず、Electron Main Processのapp-wide Execution Runtimeとして管理する。Project配下にはpersistent Execution Run state/historyを保持する。 | `architecture/project-window-execution-runtime.md` |
| REQ-EXEC-011 | Implemented | Project close / Project Window closeはExecution stop/pause/discardの契機にしない。active Runが存在する場合は最後のProject Windowを閉じてもMain Processを継続し、明示的Application Quitではactive Run警告を表示する。 | `architecture/project-window-execution-runtime.md` |
| REQ-EXEC-012 | Implemented | Multi Windowからの競合実行をExecution Runtimeで排他し、同じnormalized Local ComfyUI endpointまたは同じVast.ai Instanceを複数active Runが同時利用することを禁止する。別Vast.ai Instanceのparallel Remote Runは許可する。 | `architecture/project-window-execution-runtime.md` |
| REQ-EXEC-013 | Implemented | active RunによりWindow 0枚でもMain Processを継続する場合、Applicationをsingle-instanceとして再起動操作を既存Main Processへ転送し、新しいProject Windowを生成できる。 | `architecture/project-window-execution-runtime.md` |
| REQ-EXEC-014 | Implemented | Local resource lockはLocal ComfyUIへの副作用前、Remote resource lockはVast.ai Instanceへのstart/bootstrap/staging等の副作用前に取得し、Resume時も再取得する。Window closeではreleaseせず、Localはterminal output verification/cleanup後、Remoteはartifact cleanupとInstance finalization完了後にreleaseする。 | `architecture/project-window-execution-runtime.md` |

## 8. Post-processing

| ID | Status | Requirement | Owner |
| --- | --- | --- | --- |
| REQ-POST-001 | Implemented | Execution後にユーザーが指定する最終成果物directoryを、Caption / Thumbnail / 販売サイト用画像の共通入力元とする。後工程はサムネイル生成物を最終成果物の代替sourceとして扱わない。 | `product/scope-and-flow.md` / `ui/application-shell.md` |
| REQ-POST-002 | Implemented | 販売サイト用画像工程はサムネイルの次に配置し、FANZA / DLsiteのpackage / thumbnailを独立targetとしてcrop・renderする。同寸法targetでもcrop stateやrender結果を共有しない。 | `ui/application-shell.md` / `contracts/project-artifacts.md` |
| REQ-POST-003 | Implemented | 販売サイトtargetのservice / image type / width / height / filenameはJSON catalogを正本とし、FANZA package 560×420、FANZA thumbnail 100×100、DLsite package 560×420、DLsite thumbnail 300×300を定義する。 | `contracts/project-artifacts.md` |
| REQ-POST-004 | Implemented | 販売サイト用画像はcropを元画像内へclampし、EXIF orientationを考慮し、Lanczos3でresizeする。JPEG / PNG / WebPを出力し、JPEG / WebP品質は100固定とする。WebP入力はChromiumでPNGへ正規化してMain ProcessのLanczos3 pipelineへ渡す。 | `ui/application-shell.md` / `contracts/project-artifacts.md` |

## 9. Validation / Security

| ID | Status | Requirement | Owner |
| --- | --- | --- | --- |
| REQ-VAL-001 | Decided | `story.md`、`models.json`、`prompt_plan.json`、最終 Workflow を工程ごとに検証する。 | `quality/validation-and-security.md` |
| REQ-VAL-002 | Decided | Preflight では成果物相互のモデル参照、Workflow/API graph構造、`executionTarget`に応じた必要モデル所在とLocal/Remote operational capabilityを確認する。Remoteでは少なくともCloud Provider / Instance選択をGate化し、provider/SSH capability実装に応じて検証を強化する。 | `quality/validation-and-security.md` / `architecture/remote-execution.md` |
| REQ-SEC-001 | Decided | Grok 用 WebContents とローカル UI を権限・session 境界で分離する。 | `architecture/system-architecture.md` |
| REQ-SEC-002 | Decided | `.env`、credential、R2 設定、ブラウザデータ、`.safetensors` 本体を Grok 添付候補へ出さない。 | `quality/validation-and-security.md` |
| REQ-SEC-003 | Decided | SSH private key contents、Vast.ai API Key、R2 credentialをProject/Renderer/Remoteへ配布しない。Remoteへ渡すR2 signed URLは必要object・operation・limited lifetimeに限定し、full queryを通常logへ保存しない。 | `architecture/remote-execution.md` / `integrations/service-integrations.md` |
