const assert = require('node:assert/strict');
const { matchCode, doesNotMatchCode } = require('./source-match.cjs');
const fs = require('node:fs');
const path = require('node:path');
const repo = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(repo, p), 'utf8');

const app = read('src/renderer/App.tsx');
const settings = read('src/renderer/EnvironmentSettings.tsx');
const services = read('src/renderer/ServiceIntegrationsStage.tsx');
const homeServices = read('src/renderer/HomeConnectedServices.tsx');
const r2Panel = read('src/renderer/integrations/R2IntegrationPanel.tsx');
const civitaiPanel = read('src/renderer/integrations/CivitaiIntegrationPanel.tsx');
const vastPanel = read('src/renderer/integrations/VastAiIntegrationPanel.tsx');
const serviceCss = read('src/renderer/service-integrations.css');
const execution = read('src/renderer/ExecutionStages.tsx');
const config = read('src/main/vastai-config.ts');
const main = read('src/main/main.ts');
const standalone = read('src/renderer/StandaloneToolApp.tsx');
const ipc = read('src/shared/ipc.ts');
const preload = read('src/preload/index.cjs');
const preflight = read('src/main/preflight.ts');
const vastClient = read('src/main/vastai-client.ts');

matchCode(app, /サービス連携/);
matchCode(app, /ServiceIntegrationsStage/);
doesNotMatchCode(app, />R2 File Manager<\/button>/, 'Homeの固定R2入口を残さない');
doesNotMatchCode(app, />Civit Explorer<\/button>/, 'Homeの固定Civit入口を残さない');
matchCode(app, /HomeConnectedServices/);
matchCode(app, /tool==='vastai'/, 'HomeからVast.ai管理画面を直接開ける');
matchCode(app, /VastAiIntegrationPanel/);
doesNotMatchCode(settings, /<h3>Cloudflare R2 連携<\/h3>/, '環境設定でR2資格情報を二重管理しない');
doesNotMatchCode(settings, /<h3>Civitai 連携<\/h3>/, '環境設定でCivitai資格情報を二重管理しない');
matchCode(services, /Cloudflare R2/);
matchCode(services, /Civitai/);
matchCode(services, /クラウドインスタンス/);
matchCode(services, /Vast\.ai/);
matchCode(homeServices, /連携済みサービス/);
matchCode(
  homeServices,
  /r2\.configured\|\|r2\.secretConfigured/,
  'R2は連携済みの場合だけHomeへ表示する',
);
matchCode(homeServices, /civitai\?\.configured/, 'Civitaiは連携済みの場合だけHomeへ表示する');
matchCode(homeServices, /vastai\?\.configured/, 'Vast.aiは連携済みの場合だけHomeへ表示する');
matchCode(homeServices, /onOpenR2/);
matchCode(homeServices, /onOpenCivitai/);
matchCode(homeServices, /onOpenVastAi/);
for (const id of [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY',
  'R2_SECRET_ACCESS_KEY',
  'R2_PUBLIC_URL',
  'CLOUDFLARE_API_TOKEN',
  'BATCH_STUDIO_R2_BUCKET',
  'BATCH_STUDIO_R2_MODEL_PREFIX',
])
  matchCode(r2Panel, new RegExp(id), `R2設定に${id}を併記する`);
matchCode(civitaiPanel, /CIVIT_API_KEY/, 'Civitai API Keyに環境設定IDを併記する');
matchCode(vastPanel, /VASTAI_API_KEY/, 'Vast.ai API Keyに環境設定IDを併記する');
matchCode(vastPanel, /SSH公開鍵/, 'Vast.ai設定にSSH公開鍵選択を表示する');
matchCode(vastPanel, /selectPublicKey/, 'Rendererから公開鍵選択IPCを使用する');
matchCode(vastPanel, /sshKeyPairValid/, '秘密鍵と公開鍵のペア検証結果を表示する');
doesNotMatchCode(vastPanel, /ComfyUI Port<input/, 'ComfyUI PortをVast.ai設定で手入力させない');
matchCode(
  vastPanel,
  /Vast\.ai API応答から実行時に解決/,
  'Portは選択InstanceのAPI応答から解決する説明を表示する',
);
doesNotMatchCode(
  vastPanel,
  /Remote ComfyUI Directory/,
  'Remote ComfyUIのパスはVast.ai連携設定で管理しない',
);
matchCode(
  settings,
  /Remote ComfyUI インストール先ディレクトリ/,
  'Remote ComfyUIのパスは環境設定で管理する',
);
matchCode(
  settings,
  /BATCH_STUDIO_REMOTE_COMFYUI_INSTALL_PATH/,
  'Remote ComfyUI pathの環境設定IDを表示する',
);
for (const id of [
  'BATCH_STUDIO_PROJECT_ROOT',
  'BATCH_STUDIO_ARTIFACT_ROOT',
  'BATCH_STUDIO_CATALOG_PATH',
  'BATCH_STUDIO_R2_INDEX_PATH',
  'BATCH_STUDIO_TEMPLATE_PATH',
  'BATCH_STUDIO_MANIFEST_PATH',
])
  matchCode(settings, new RegExp(id), `環境設定に${id}を併記する`);
matchCode(vastPanel, /既存Instanceの状態確認・起動・停止・削除・再起動/);
matchCode(vastPanel, /startButtonLabel/, '起動ボタン文言は状態から導出する');
matchCode(vastPanel, /Scheduling/, 'Scheduling状態を明示表示する');
matchCode(vastPanel, /GPU割り当て待ち/, 'Schedulingの意味を画面に表示する');
matchCode(
  vastPanel,
  /instance\.status==='stopped'/,
  'API上stoppedでも外部Schedulingをキャンセルできるよう停止を有効化する',
);
matchCode(
  vastPanel,
  /停止 \/ Schedulingをキャンセル/,
  'stopped時にも停止操作の目的をツールチップで明示する',
);
matchCode(vastPanel, /statusDetail/, 'Vast.aiのraw\/intended\/cur\/nextを診断表示する');
matchCode(
  vastPanel,
  /perform\(instance,'start'\)[\s\S]*perform\(instance,'stop'\)[\s\S]*perform\(instance,'destroy'\)[\s\S]*perform\(instance,'reboot'\)/,
  '操作は起動・停止・削除・再起動の順で表示する',
);
matchCode(vastPanel, /INSTANCE_REFRESH_MS=5_000/, 'Instance状態は5秒間隔で自動更新する');
matchCode(vastPanel, /vast-instance-section/, 'Instance一覧は安定した高さを持つ専用sectionにする');
matchCode(
  serviceCss,
  /\.vast-instance-section\{min-height:138px\}/,
  'Instanceが0件でも更新時にレイアウト高が変わらないよう最低高を確保する',
);
matchCode(vastPanel, /GPU検索・RENT/, 'Vast.ai画面に検索・RENT導線を追加する');
matchCode(
  vastPanel,
  /ComfyUI Template互換・Verified・利用可能/,
  'Web版に合わせた内部検索条件を説明する',
);
matchCode(vastPanel, /rentError/, 'RENT失敗はVast.ai検索領域内で表示する');
matchCode(
  vastPanel,
  /このOfferは利用できなくなりました。検索結果への反映待ちの間は再表示しません。/,
  '失効Offerを分かりやすく通知する',
);
matchCode(
  vastPanel,
  /setSearchRevision\(value=>value\+1\)/,
  '失効Offer検知時に検索を即時再実行する',
);
matchCode(
  vastPanel,
  /setOffers\(prev=>prev\.filter\(item=>item\.id!==offer\.id\)\)/,
  '失効Offerを現在の一覧から除外する',
);
matchCode(vastPanel, /role="alert"/, 'RENTエラーを検索結果付近のalertとして表示する');
matchCode(serviceCss, /\.vast-rent-error\{/, 'RENTエラー専用のインライン表示を持つ');
matchCode(vastPanel, /DEFAULT_SEARCH:[^\n]*gpuCount:1/, 'GPU Countの初期値は1にする');
matchCode(vastPanel, /SEARCH_DEBOUNCE_MS=400/, '検索条件変更はdebounceしてリアルタイム検索する');
matchCode(vastPanel, /SEARCH_REFRESH_MS=5_000/, '検索結果を5秒ごとに再取得する');
matchCode(
  vastPanel,
  /STALE_OFFER_SUPPRESSION_MS=10\*60_000/,
  'RENT不可Offerは10分間ローカル抑止する',
);
matchCode(
  vastPanel,
  /staleOfferIdsRef\.current\.set\(offer\.id/,
  'RENT不可Offer IDを抑止リストへ登録する',
);
matchCode(
  vastPanel,
  /filter\(offer=>!staleOfferIdsRef\.current\.has\(offer\.id\)\)/,
  '検索APIが古いOfferを返しても再表示しない',
);
matchCode(vastPanel, /window\.setTimeout/, '検索は入力変更後に自動実行する');
doesNotMatchCode(vastPanel, />検索<\/button>/, '検索ボタンを置かない');
matchCode(vastPanel, /sortedOffers/, 'Rendererでも検索結果をコスト順に安定化する');
matchCode(vastPanel, /コストが低い順/, '現在のソート順をUIに明示する');
matchCode(vastPanel, /vast-search-field-title/, '検索条件のラベルと単位を同一行に揃える');
for (const label of ['Storage', 'Minimum TFLOPs', 'GPU Count', 'Reliability', '除外する国コード'])
  matchCode(vastPanel, new RegExp(label), `検索条件に${label}を表示する`);
for (const label of [
  '<label>GPU<',
  '<label>VRAM<',
  '<label>Max Price',
  '<label>Verified',
  '<label>Download Speed',
  '<label>Disk Speed',
])
  assert.ok(!vastPanel.includes(label), `検索条件に不要な項目を追加しない: ${label}`);
matchCode(
  vastPanel,
  /GPU・VRAM・料金などは結果を比較して選択/,
  '結果から比較して選ぶ設計を明示する',
);
matchCode(vastPanel, /offer\.gpuName/, '検索結果にGPU名を表示する');
matchCode(vastPanel, /formatVram\(offer\.gpuRamMb\)/, '検索結果にVRAMを表示する');
matchCode(vastPanel, /formatCost\(offer\.hourlyCost\)/, '検索結果に価格を表示する');
matchCode(vastPanel, /offer\.verification/, '検索結果にVerified情報を表示する');
matchCode(vastPanel, /offer\.internetDownMb/, '検索結果にDownload性能を表示する');
matchCode(vastPanel, /offer\.diskBandwidthMb/, '検索結果にDisk性能を表示する');
matchCode(vastClient, /type:'on-demand'/, 'Offer検索とRENTはOn-demand固定にする');
matchCode(vastClient, /verified: \{ eq: true \}/, 'Web版と同様にVerified Offerへ限定する');
matchCode(
  vastClient,
  /duration: \{ gte: WEB_DEFAULT_MIN_DURATION_SECONDS \}/,
  'Web版既定の7日以上利用可能条件を適用する',
);
matchCode(
  vastClient,
  /WEB_DEFAULT_MIN_DURATION_SECONDS = 7 \* 24 \* 60 \* 60/,
  'Web版既定durationを7日として定義する',
);
matchCode(vastClient, /order:\[\['dph_total','asc'\]\]/, 'Offer検索は時間単価の安い順を要求する');
matchCode(vastClient, /allocated_storage:search\.storageGb/, '検索価格計算へStorage容量を反映する');
matchCode(vastClient, /num_gpus:\{eq:search\.gpuCount\}/, 'GPU枚数を完全一致で検索する');
matchCode(
  vastClient,
  /total_flops=\{gte:search\.minTflops\}|body\.total_flops=\{gte:search\.minTflops\}/,
  'Minimum TFLOPsを検索へ反映する',
);
matchCode(
  vastClient,
  /geolocation=\{notin:search\.excludedCountries\}|body\.geolocation=\{notin:search\.excludedCountries\}/,
  '地域ブラックリストをnotinで検索する',
);
matchCode(
  vastClient,
  /template_hash_id:template\.hashId/,
  'RENT時にComfyUI Template hashを指定する',
);
matchCode(vastClient, /Vast\.ai API \(404\|410\)/, 'Create APIの404/410をOffer失効として扱う');
matchCode(vastClient, /disk:storageGb/, '検索時と同じStorage容量でRENTする');
matchCode(ipc, /VASTAI_SEARCH_OFFERS/);
matchCode(ipc, /VASTAI_RENT_OFFER/);
matchCode(preload, /searchOffers/);
matchCode(preload, /rentOffer/);
matchCode(main, /RENTするとVast\.aiで課金が開始されます/, '課金開始前に確認ダイアログを表示する');
matchCode(
  main,
  /rentOffer\(\{offerId,storageGb,templateHashId\},offer\)/,
  '確認済みOfferをCreateへ渡して余分な再検索を避ける',
);
matchCode(
  main,
  /openStandaloneToolWindow\('vastai'\)/,
  'WindowメニューからVast.ai専用ウィンドウを開ける',
);
matchCode(
  standalone,
  /tool==='r2'\|\|tool==='civit'\|\|tool==='vastai'/,
  '専用ウィンドウのqueryでVast.aiを受け付ける',
);
matchCode(standalone, /VastAiIntegrationPanel/, 'Vast.ai専用ウィンドウで管理画面を表示する');
matchCode(ipc, /VASTAI_DESTROY_INSTANCE/);
matchCode(ipc, /VASTAI_REBOOT_INSTANCE/);
matchCode(preload, /destroyInstance/);
matchCode(preload, /rebootInstance/);
matchCode(main, /requestStartInstance/, 'UIの起動要求はrunning到達までブロックしない');
matchCode(main, /requestStopInstance/, 'UIの停止要求はstopped到達までブロックしない');
matchCode(main, /dialog\.showMessageBox/, '削除前に明示確認する');
matchCode(main, /destroyInstance/);
matchCode(main, /requestRebootInstance/);
matchCode(execution, /remoteProvider:'vastai'/);
matchCode(execution, /remoteInstanceId/);
matchCode(execution, /SSH Host\/PortはProjectへ固定保存せず/);
matchCode(config, /VASTAI_ENVIRONMENT_VARIABLE='VASTAI_API_KEY'/);
matchCode(
  config,
  /stored\?\.schemaVersion===2\|\|stored\?\.schemaVersion===3\|\|stored\?\.schemaVersion===4\?text\(stored\.sshPublicKeyPath\):''/,
  'schema v2-v4で保存したSSH公開鍵をstatusで再読込する',
);
matchCode(preflight, /remoteTargetCheck/, 'PreflightがRemote target検証hookを持つ');
matchCode(main, /remoteTargetIssuesFor/, 'Main ProcessがVast.ai Remote targetを検証する');
matchCode(
  main,
  /runPreflight\(root,await r2LookupFor\(root\),settings\.modelsPath,\(\)=>remoteTargetIssuesFor\(root\)\)/,
  'PREFLIGHT_RUNからRemote target検証を実配線する',
);
matchCode(main, /VASTAI_SSH_KEY_MISSING/);
matchCode(main, /VASTAI_SSH_PUBLIC_KEY_REQUIRED/);
matchCode(main, /VASTAI_SSH_PUBLIC_KEY_MISSING/);
matchCode(main, /VASTAI_SSH_KEY_PAIR_MISMATCH/);
matchCode(main, /REMOTE_COMFYUI_INSTALL_PATH_REQUIRED/);
matchCode(
  main,
  /appSettings\.remoteComfyUiInstallPath/,
  'SSH endpointは環境設定のRemote ComfyUI pathを使う',
);
matchCode(
  main,
  /comfyUiPort:instance\.comfyUiPort/,
  'ComfyUI Portは選択InstanceのVast.ai API応答を使う',
);
matchCode(main, /instance\.sshPort/, 'SSH Portは選択InstanceのVast.ai API応答を使う');
matchCode(config, /schemaVersion:4/, 'Vast.ai設定schema v4ではComfyUI Portを保存しない');
matchCode(main, /ensureSshAccess/, 'SSH接続前にVast.aiへ公開鍵をprovisionする');
matchCode(main, /VASTAI_INSTANCE_LOOKUP_FAILED/);
console.log('Service integrations UI tests passed.');
