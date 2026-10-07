// Planning evidence only. Does not load application modules or execute CLI/services.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true })
  .flatMap((entry) => entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]).sort();
// Normalize text line endings; binary asset hashes preserve exact bytes.
const hash = (file) => crypto.createHash('sha256').update(/\.(psd|png)$/i.test(file)
  ? fs.readFileSync(path.join(root, file)) : read(file).replace(/\r\n/g, '\n')).digest('hex');
const list = (text) => text.split(/\s+/).filter(Boolean);
const packages = {
  W01: { name: '通信契約・認可境界', phase: 'P2', gate: 'G01' },
  W02: { name: 'Web shell・共通UI状態', phase: 'P3', gate: 'G02' },
  W03: { name: 'Project・Artifact永続化', phase: 'P3', gate: 'G03' },
  W04: { name: 'AI会話・工程task', phase: 'P4', gate: 'G04' },
  W05: { name: 'モデル解決・Compiler・Preflight', phase: 'P5', gate: 'G05' },
  W06: { name: '生成runtime・SSH・復旧', phase: 'P6', gate: 'G06' },
  W07: { name: 'Civitai catalog・Vast.ai操作', phase: 'P5', gate: 'G07' },
  W08: { name: 'R2転送・object管理', phase: 'P5', gate: 'G08' },
  W09: { name: '画像・Caption・成果物・Picker', phase: 'P7', gate: 'G09' },
  W10: { name: '起動・OS・Secret基盤', phase: 'P5', gate: 'G10' },
  W11: { name: 'build・起動配布・更新', phase: 'P8', gate: 'G11' },
  W12: { name: '検証・test harness', phase: 'P8', gate: 'G12' },
  W13: { name: 'schema・runtime resource', phase: 'P8', gate: 'G13' },
  W14: { name: '旧実装整理', phase: 'P9', gate: 'G14' },
};
const groups = {
  W01: list('ipc-access ipc-registration'),
  W03: list('artifact-service fs-utils project-meta project-scan project-transaction model-downstream-reset prompt-plan-patch ui-state'),
  W04: list('agent-artifact-import agent-cli-adapter agent-cli-diagnostic agent-conversation-runner agent-conversation-store agent-model-selection agent-session-state agent-workspace assistant-provider-state codex-cli-adapter codex-cli-events codex-cli-task-runner grok-cli-adapter grok-cli-events grok-cli-task-runner grok-context grok-lora-history'),
  W05: list('availability compiler image-tasks model-catalog model-file-sources model-placement-paths preflight validation workflow-api workflow-template-integrity workflow-template-paths'),
  W06: list('comfyui-client execution-coordinator execution-output execution-run local-execution remote-control-plane remote-environment-bootstrap remote-execution remote-instance-lifecycle remote-model-stager remote-worker-source remote-worker ssh-client ssh-host-keys ssh-key-pair'),
  W07: list('civitai-cache civitai-catalog civitai-client civitai-request-policy vastai-client'),
  W08: list('r2-manager r2-object-index'),
  W09: list('atomic-image-output caption-service final-artifact-image-service final-artifact-service image-dimensions image-pipeline-core image-pipeline marketplace-generation-manifest marketplace-image-service picker-selection-gate thumbnail-cache-prune thumbnail-image-cache thumbnail-picker-perf thumbnail-service tracked-output-cleanup'),
  W10: list('main app-settings civitai-config r2-config vastai-config'),
  W14: list('codex-app-server codex-artifact-turn codex-chat-state codex-file-artifact codex-model-selection codex-thread-history codex-turn-monitor grok-artifact-adapter grok-auto-artifact-watcher grok-chat-state grok-navigation-queue grok-navigation'),
};
const coreOwners = {
  'execution-record-policy': 'W06',
  'template-policy': 'W05', 'workflow-use-cases': 'W05',
  'execution-evidence': 'W06', 'execution-recovery': 'W06',
  'availability-policy': 'W05', 'model-placement': 'W05',
  'preflight': 'W05',
  'execution-resume': 'W06', 'image-pixels': 'W09',
  'execution-creation': 'W06',
  'model-editing': 'W03', 'workflow-compilation': 'W05',
  'catalog-validation': 'W03', 'canonical-artifact': 'W03',
  'artifact-types': 'W03', 'artifact-validation': 'W03', 'model-selection': 'W03', 'model-file-selection': 'W03', 'model-version-change': 'W03', 'model-impact': 'W03', 'prompt-policy': 'W05', 'workflow-graph': 'W05', 'image-tasks': 'W06', 'caption-policy': 'W09',
  'contracts': 'W01', 'artifact-policy': 'W03', 'execution-policy': 'W06', 'confirmation-policy': 'W10', 'image-policy': 'W09',
  'project-ports': 'W03', 'project-access': 'W03', 'project-use-cases': 'W03', 'execution-use-cases': 'W06',
  'agent-use-cases': 'W04', 'confirmation-use-cases': 'W10', 'platform-ports': 'W10', 'platform-use-cases': 'W10', 'core': 'W10',
};
function owner(file) {
  if (/^src\/(domain|application)\//.test(file)) {
    const assigned = coreOwners[path.basename(file, '.ts')];
    if (!assigned) throw new Error('Core owner missing: ' + file);
    return assigned;
  }
  if (file === 'scripts/check-core-boundaries.cjs') return 'W12';
  if (file.startsWith('tests/') || file === 'scripts/verify-comfyui-api.mjs') return 'W12';
  if (file.startsWith('templates/') || file.startsWith('schemas/') || file === 'src/shared/marketplace-image-targets.json') return 'W13';
  if (file.startsWith('scripts/') || file.startsWith('.github/') || !file.startsWith('src/')) return 'W11';
  if (file.startsWith('src/preload/') || /src\/main\/ipc-registration\//.test(file)) return 'W01';
  if (/^src\/(domain|application)\/execution-/.test(file)) return 'W06';
  if (file.startsWith('src/main/')) {
    const name = path.basename(file, '.ts');
    const matches = Object.keys(groups).filter((id) => groups[id].includes(name));
    if (matches.length !== 1) throw new Error(`Owner missing/overlapping: ${file}: ${matches}`);
    return matches[0];
  }
  if (file.startsWith('src/shared/')) {
    if (/\/(types|ipc)\.ts$/.test(file)) return 'W01';
    if (/r2-/.test(file)) return 'W08';
    if (/codex-/.test(file)) return 'W04';
    if (/image-size|marketplace-picker/.test(file)) return 'W09';
    if (/execution-progress/.test(file)) return 'W06';
    return 'W05';
  }
  if (file.startsWith('src/renderer/')) {
    if (/\.(css|d\.ts)$/.test(file) || /\/(App|main|StandaloneToolApp|Stage.*|ui|VirtualPickerGrid|ImagePickerGrid|editor-save-registry|use-editor-autosave)\.(tsx?|ts)$/.test(file)) return 'W02';
    if (/AssistantPane|GrokStages|GrokLoraHistory|ArtifactImportToast/.test(file)) return 'W04';
    if (/Thumbnail|Marketplace|FinalArtifact|Caption|thumbnail-image-memory/.test(file)) return 'W09';
    if (/ExecutionStages/.test(file)) return 'W06';
    if (/R2ManagerStage|R2IntegrationPanel/.test(file)) return 'W08';
    if (/Civit|VastAi/.test(file)) return 'W07';
    if (/ModelPicker|ModelFilePicker|SelectedModelCards|PromptPlanStage/.test(file)) return 'W05';
    if (/ProjectStages/.test(file)) return 'W03';
    if (/EnvironmentSettings|ServiceIntegrationsStage|HomeConnectedServices/.test(file)) return 'W10';
  }
  throw new Error(`Unclassified: ${file}`);
}
const scanRoots = ['src', 'scripts', 'tests', '.github', 'templates', 'schemas'];
const rootFiles = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isFile()
  && !['AGENTS.md', 'README.md'].includes(entry.name) && !/\.log$/.test(entry.name)).map((entry) => entry.name);
const files = [...scanRoots.flatMap(walk), ...rootFiles].sort();
const prior = JSON.parse(read('docs/roadmap/web-migration-inventory.json'));
const priorByFile = new Map(prior.files.map((row) => [row.file, row]));
const policyActions = {
  'scripts/update-release.ps1': '新版停止/更新/起動/health。schema移行・旧版自動切戻しなし',
  'src/main/civitai-config.ts': '新SecretStoreへ置換・新規登録。旧暗号化設定の移行/取得元fallback禁止',
  'src/main/r2-config.ts': '新SecretStoreへ置換・新規登録。旧暗号化設定の移行/取得元fallback禁止',
  'src/main/vastai-config.ts': '新SecretStoreへ置換・新規登録。旧暗号化設定の移行/取得元fallback禁止',
  'src/main/app-settings.ts': '新設定契約/SecretStore/dataDir。旧設定読替・値補完・取得元fallback禁止',
  'src/preload/index.cjs': '新版から非到達・最終撤去。Electron互換bridgeを作らない',
  'vite.config.ts': '同一origin proxy/static/明示route。未知routeのHTML fallback禁止',
  'src/main/workflow-template-paths.ts': '明示resourceDir/Templateを解決。不在時の別Template/cwd探索禁止',
  'src/main/thumbnail-service.ts': '新codec/font/revision契約。自動font代替/旧revision読替禁止',
  'src/main/marketplace-image-service.ts': '新codec/asset/revision/manifest契約。旧処理へのfallback禁止',
  'src/main/thumbnail-image-cache.ts': '選択済codecと認可binary配信。失敗時の別codec/元画像代用禁止',
  'src/main/fs-utils.ts': '新形式のatomic保存/検証。破損時の自動backup採用/空状態置換禁止',
  'src/main/agent-session-state.ts': '新Web session storeのみ。旧session/historyの自動継承・変換なし',
};
const rows = files.map((file) => {
  const source = read(file), lines = source.split(/\r?\n/);
  const imports = [...source.matchAll(/(?:from\s*|require\s*\(\s*|import\s*\(\s*|import\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]);
  const workPackage = owner(file);
  return {
    file, lines: lines.length, sha256: hash(file), workPackage, layer: file.startsWith('src/domain/') ? 'domain' : file.startsWith('src/application/') ? 'application' : 'existing-reference', phase: /^src\/(domain|application)\//.test(file) ? 'P1' : packages[workPackage].phase, gate: packages[workPackage].gate,
    desktopRemovalPhase: file.startsWith('src/preload/') || file.startsWith('src/main/ipc-registration') || file === 'src/shared/ipc.ts' || file === 'src/main/main.ts' || workPackage === 'W14' ? 'P9' : null,
    electronDependencyRemovalPhase: imports.includes('electron') && !['W01', 'W14'].includes(workPackage) && file !== 'src/main/main.ts' ? packages[workPackage].phase : null,
    imports: [...new Set(imports)],
    exports: [...source.matchAll(/export\s+(?:async\s+)?(?:class|function|const|interface|type|enum)\s+(\w+)/g)].map((m) => m[1]),
    bridgeCalls: [...new Set([...source.matchAll(/window\.batchStudio\.([\w.]+)/g)].map((m) => m[1]))],
    registeredChannels: [...source.matchAll(/handleIpc\(\s*IPC\.([A-Z0-9_]+)/g)].map((m) => m[1]),
    risks: lines.flatMap((line, i) => /electron|safeStorage|nativeImage|dialog\.|shell\.|webContents|screenX|Date\.now\(\) \* 1000|\.getPath\(|powershell|SystemRoot|dist-electron|process\.env|child_process/.test(line)
      ? [{ line: i + 1, text: line.trim().slice(0, 170) }] : []),
    migrationAction: workPackage === 'W14' ? '旧code/store参照を撤去。互換読込・旧データ移行なし'
      : policyActions[file] || priorByFile.get(file)?.migrationAction || '配布設定をWeb/server構成へ適合',
  };
});
// Channels are classified from actual preload direction, not name suffixes.
const preload = read('src/preload/index.cjs');
const invoked = new Set([...preload.matchAll(/ipcRenderer\.invoke\(I\.([A-Z0-9_]+)/g)].map((m) => m[1]));
const listened = new Set([...preload.matchAll(/ipcRenderer\.on\(I\.([A-Z0-9_]+)/g)].map((m) => m[1]));
const keys = [...read('src/shared/ipc.ts').matchAll(/^\s*([A-Z][A-Z0-9_]+):\s*'([^']+)'/gm)].map((m) => ({ key: m[1], channel: m[2] }));
const sets = {
  'ui-local': list('PROJECT_MENU_COMMAND CLIPBOARD_WRITE_TEXT ASSISTANT_SET_VISIBLE ASSISTANT_SET_RATIO ASSISTANT_SET_DIVIDER_X'),
  'ui-flow': list('EDITOR_FLUSH_REQUEST EDITOR_FLUSH_RESULT PROJECT_OPEN PROJECT_CLOSE ASSISTANT_SET_CONTEXT ASSISTANT_CONTEXT ASSISTANT_CONTEXT_CHANGED EXECUTION_LEAVE AVAILABILITY_OPEN_R2 THUMBNAIL_PICKER_OPEN THUMBNAIL_PICKER_CONTEXT THUMBNAIL_PICKER_PERF THUMBNAIL_PICKER_PREVIEW THUMBNAIL_PICKER_PREVIEW_RESULT THUMBNAIL_PICKER_COMMIT THUMBNAIL_PICKER_COMMIT_RESULT THUMBNAIL_PICKER_PREVIEWED THUMBNAIL_PICKER_COMMITTED THUMBNAIL_PICKER_CANCELLED MARKETPLACE_PICKER_OPEN MARKETPLACE_PICKER_CONTEXT MARKETPLACE_PICKER_PREVIEW MARKETPLACE_PICKER_PREVIEW_RESULT MARKETPLACE_PICKER_COMMIT MARKETPLACE_PICKER_COMMIT_RESULT MARKETPLACE_PICKER_PREVIEWED MARKETPLACE_PICKER_COMMITTED MARKETPLACE_PICKER_CANCELLED'),
  'native-replacement': list('APP_SETTINGS_SELECT_COMFYUI PROJECT_SELECT PROJECT_SELECT_PARENT PROJECT_OPEN_FOLDER FILE_SHOW_IN_FOLDER CATALOG_OPEN_MODEL VASTAI_SELECT_PRIVATE_KEY VASTAI_SELECT_PUBLIC_KEY FINAL_ARTIFACT_SELECT_DIRECTORY CAPTION_SELECT_SOURCE_DIRECTORY THUMBNAIL_SELECT_IMAGE THUMBNAIL_PICKER_PERF_OPEN R2_SELECT_UPLOAD_FILES'),
  'binary-query': list('FINAL_ARTIFACT_READ_IMAGE FINAL_ARTIFACT_READ_PREVIEW THUMBNAIL_READ_IMAGE THUMBNAIL_READ_PREVIEW THUMBNAIL_READ_EDITOR_IMAGE THUMBNAIL_READ_TEMPLATE MARKETPLACE_READ_SOURCE MARKETPLACE_READ_SOURCE_PREVIEW'),
  'binary-command': list('THUMBNAIL_STORE_WEBP_PREVIEW THUMBNAIL_EXPORT MARKETPLACE_RENDER_PNG MARKETPLACE_GENERATE MARKETPLACE_GENERATE_ZIP MARKETPLACE_EXPORT_CUSTOM'),
  'query': list('APP_SETTINGS_GET PROJECT_LAST PROJECT_RECENT PROJECT_SCAN ARTIFACT_READ ARTIFACT_GROK_LORA_HISTORY CATALOG_STATUS CATALOG_INTEGRATED_STATUS CATALOG_INTEGRATED_SNAPSHOT CATALOG_TEMPLATES CIVITAI_SETTINGS VASTAI_SETTINGS VASTAI_INSTANCES VASTAI_COMFYUI_TEMPLATE VASTAI_SEARCH_OFFERS VASTAI_RESOLVE_SSH AVAILABILITY_CHECK AVAILABILITY_CHECK_LORA_FILES EXECUTION_STATUS EXECUTION_STORAGE_DIAGNOSTICS EXECUTION_GET FINAL_ARTIFACT_STATUS FINAL_ARTIFACT_LIST_IMAGES CAPTION_STATUS THUMBNAIL_FONTS THUMBNAIL_LOAD THUMBNAIL_LIST_IMAGES MARKETPLACE_TARGETS MARKETPLACE_LIST_THUMBNAILS MARKETPLACE_LOAD R2_SETTINGS R2_ENVIRONMENT R2_BUCKETS R2_LIST R2_SEARCH R2_DOWNLOAD_INFO R2_BATCH_DOWNLOAD_INFO R2_PUT_URL_INFO R2_UPLOADS R2_TEMPLATES R2_METRICS ASSISTANT_GET_PROVIDER ASSISTANT_SNAPSHOT ASSISTANT_MODELS'),
  'command': list('APP_SETTINGS_SAVE PROJECT_REMOVE_RECENT PROJECT_CREATE PROJECT_SAVE_SETTINGS PROJECT_SAVE_BRIEF ARTIFACT_BEGIN_EDIT ARTIFACT_SAVE_DRAFT ARTIFACT_IMPORT_GROK ARTIFACT_CONFIRM ARTIFACT_RESET_FROM PROMPT_PLAN_SAVE CATALOG_INTEGRATED_SYNC CATALOG_LINK_PROJECT CATALOG_SAVE_TEMPLATE CATALOG_DELETE_TEMPLATE CIVITAI_SAVE_SETTINGS VASTAI_SAVE_SETTINGS VASTAI_TEST VASTAI_RENT_OFFER VASTAI_START_INSTANCE VASTAI_STOP_INSTANCE VASTAI_DESTROY_INSTANCE VASTAI_REBOOT_INSTANCE WORKFLOW_COMPILE PREFLIGHT_RUN EXECUTION_START EXECUTION_RESTORE_BACKUP EXECUTION_RECONCILE EXECUTION_STOP_FOR_EDIT EXECUTION_DISCARD_FOR_EDIT EXECUTION_STOP_SCHEDULING EXECUTION_FORCE_INTERRUPT EXECUTION_RESUME EXECUTION_RESTART_REMOTE EXECUTION_RESTART_FROM_SCRATCH CAPTION_IMPORT_GROK CAPTION_GENERATE CAPTION_SAVE_PIXIV_TITLE THUMBNAIL_RESTORE_BACKUP THUMBNAIL_INITIALIZE_CORRUPT THUMBNAIL_SAVE THUMBNAIL_DELETE_OUTPUTS MARKETPLACE_RESTORE_BACKUP MARKETPLACE_INITIALIZE_CORRUPT MARKETPLACE_SAVE R2_TEST R2_SAVE_SETTINGS R2_CREATE_BUCKET R2_DELETE_BUCKET R2_DELETE_OBJECTS R2_MOVE R2_BEGIN_UPLOAD R2_RESUME_UPLOAD R2_PAUSE_UPLOAD R2_CANCEL_UPLOAD R2_SAVE_TEMPLATE R2_DELETE_TEMPLATE ASSISTANT_SET_PROVIDER ASSISTANT_SEND ASSISTANT_STOP_TURN ASSISTANT_NEW_CONVERSATION ASSISTANT_RESTORE_CONVERSATION ASSISTANT_SELECT_MODEL AGENT_TASK_START AGENT_TASK_STOP'),
  'event': list('AGENT_EVENT AUTO_ARTIFACT_EVENT'),
};
const confirmation = new Set(list('VASTAI_RENT_OFFER VASTAI_DESTROY_INSTANCE EXECUTION_RESTORE_BACKUP EXECUTION_DISCARD_FOR_EDIT EXECUTION_RESTART_FROM_SCRATCH THUMBNAIL_RESTORE_BACKUP THUMBNAIL_INITIALIZE_CORRUPT MARKETPLACE_RESTORE_BACKUP MARKETPLACE_INITIALIZE_CORRUPT'));
const definedKeys = new Set(keys.map((item) => item.key));
for (const [kind, members] of Object.entries(sets)) {
  if (new Set(members).size !== members.length) throw new Error(`Duplicate IPC member: ${kind}`);
  for (const key of members) if (!definedKeys.has(key)) throw new Error(`Unknown IPC member: ${kind}/${key}`);
}
function ipcOwner(key) {
  if (/^(ASSISTANT|AGENT|AUTO_ARTIFACT)/.test(key)) return 'W04';
  if (/^R2_/.test(key)) return 'W08';
  if (/^(CATALOG|CIVITAI|VASTAI)/.test(key)) return 'W07';
  if (/^EXECUTION/.test(key)) return 'W06';
  if (/^(WORKFLOW|AVAILABILITY|PREFLIGHT|PROMPT_PLAN)/.test(key)) return 'W05';
  if (/^(FINAL_ARTIFACT|CAPTION|THUMBNAIL|MARKETPLACE)/.test(key)) return 'W09';
  if (/^(PROJECT|ARTIFACT)/.test(key)) return 'W03';
  if (/^APP_SETTINGS/.test(key)) return 'W10';
  return 'W02';
}
const ipc = keys.map((item) => {
  const matches = Object.keys(sets).filter((kind) => sets[kind].includes(item.key));
  if (matches.length !== 1) throw new Error(`IPC disposition missing/overlapping: ${item.key}: ${matches}`);
  if (invoked.has(item.key) === listened.has(item.key)) throw new Error(`IPC direction missing/ambiguous: ${item.key}`);
  const handlers = rows.filter((r) => r.file.startsWith('src/main/')).flatMap((r) => [...read(r.file).matchAll(/handleIpc\(\s*IPC\.([A-Z0-9_]+)/g)]
    .filter((m) => m[1] === item.key).map((m) => ({ file: r.file, line: read(r.file).slice(0, m.index).split(/\r?\n/).length })));
  const senders = rows.filter((r) => r.file.startsWith('src/main/')).flatMap((r) => [...read(r.file).matchAll(/\.send\(\s*IPC\.([A-Z0-9_]+)/g)]
    .filter((m) => m[1] === item.key).map((m) => ({ file: r.file, line: read(r.file).slice(0, m.index).split(/\r?\n/).length })));
  if (invoked.has(item.key) && handlers.length !== 1) throw new Error(`Handler coverage: ${item.key}: ${handlers.length}`);
  if (listened.has(item.key) && (!senders.length || handlers.length)) throw new Error(`Event coverage: ${item.key}`);
  const workPackage = ipcOwner(item.key);
  return { ...item, direction: invoked.has(item.key) ? 'invoke' : 'notification', disposition: matches[0], workPackage,
    phase: packages[workPackage].phase, gate: packages[workPackage].gate, handlers, senders,
    confirmation: confirmation.has(item.key),
    caveat: ['PROJECT_LAST', 'ASSISTANT_GET_PROVIDER', 'EXECUTION_STATUS', 'THUMBNAIL_LOAD', 'MARKETPLACE_LOAD', 'R2_UPLOADS'].includes(item.key)
      ? '現queryに復元・状態変更等を伴う。安全なGETとcommandへ分離して確認' : '',
  };
});
const codeByFile = new Map(rows.map((r) => [r.file, r]));
const visited = new Set();
function reach(file) {
  if (visited.has(file)) return;
  visited.add(file);
  for (const item of codeByFile.get(file)?.imports || []) {
    if (!item.startsWith('.')) continue;
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), item));
    const resolved = [base, base.replace(/\.js$/, '.ts'), `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((candidate) => codeByFile.has(candidate));
    if (resolved) reach(resolved);
  }
}
reach('src/main/main.ts'); reach('src/renderer/main.tsx');
for (const row of rows) row.entryReachable = visited.has(row.file);
const pkg = JSON.parse(read('package.json'));
const ci = walk('.github').map(read).join('\n');
const supports = new Set(list('main-process-source.cjs source-match.cjs standard-graph-fixture.cjs'));
const testCoverage = rows.filter((r) => r.file.startsWith('tests/')).map((r) => {
  const registration = supports.has(path.basename(r.file)) || r.file.startsWith('tests/core-support/') ? 'support' : pkg.scripts.test.includes(r.file) ? 'npm-test' : (pkg.scripts['test:core'] || '').includes(r.file) ? 'core-local'
    : read('.github/workflows/ci.yml').includes(r.file) ? 'CI-only' : ci.includes(r.file) ? 'CI-conditional' : 'standalone';
  const name = path.basename(r.file);
  const featurePackages = name === 'core-artifacts.cjs' ? ['W03', 'W05', 'W06', 'W09'] : name === 'core-policy.cjs' ? ['W03', 'W06', 'W09', 'W10'] : name === 'business-core.cjs' ? ['W01', 'W03', 'W04', 'W06', 'W09', 'W10'] : supports.has(name) || r.file.startsWith('tests/core-support/') ? ['W12'] : name === 'run.cjs' ? ['W03', 'W05']
    : /service-integrations/.test(name) ? ['W07', 'W08', 'W10'] : /ipc-|marketplace-write-guard/.test(name) ? ['W01']
    : /agent|codex|grok|assistant/.test(name) ? ['W04'] : /r2-/.test(name) ? ['W08']
    : /civitai|vastai/.test(name) ? ['W07'] : /remote|execution|local-comfy/.test(name) ? ['W06']
    : /model-downstream|project-|fs-utils/.test(name) ? ['W03'] : /workflow|prompt-plan|compiler|model-|anima-/.test(name) ? ['W05']
    : /thumbnail|marketplace|image-|picker|caption|final-artifact|release-201/.test(name) ? ['W09']
    : /update-release/.test(name) ? ['W11'] : ['W02'];
  return { file: r.file, registration, treatment: registration === 'support' ? 'harness/fixture移植'
    : r.imports.includes('electron') ? 'server/browser検証へ置換' : r.imports.includes('./source-match.cjs') || r.imports.includes('./main-process-source.cjs') ? '挙動検証へ置換/補完' : '契約維持・server buildへ適合',
    targetGate: 'G12', featureGates: featurePackages.map((id) => packages[id].gate),
    requiredAction: registration === 'standalone' ? 'P0のbaseline-checklistの採否に従いP4で新test経路へ接続/旧test廃止/harness修復'
      : registration === 'core-local' ? 'P1からcore単独回帰に接続済み。P2以降も必須' : registration === 'CI-conditional' ? '条件付きperformance CIを維持/置換し発火pathも更新' : 'P8までに新test実行経路へ接続' };
});
const resources = walk('thumbnail/psd-templates').filter((f) => /\.(psd|png)$/.test(f)).map((file) => ({ file, sha256: hash(file), bytes: fs.statSync(path.join(root, file)).size,
  role: file.endsWith('.psd') ? 'runtime-PSD' : 'reference-preview', workPackage: 'W13', phase: 'P8', gate: 'G13' }));
const documents = [...walk('docs').filter((f) => f.endsWith('.md') && !f.startsWith('docs/releases/') && !f.startsWith('docs/roadmap/web-migration-')),
  'README.md', 'AGENTS.md', 'thumbnail/psd-templates/README.md'].map((file) => ({ file, sha256: hash(file), workPackage: 'W11', gate: 'G11',
    treatment: file === 'AGENTS.md' ? '既存rule遵守・変更不要' : file.startsWith('docs/decisions/') ? '過去判断を保持し新判断を追記' : '移行完了時に該当仕様を更新' }));
const inventory = { date: '2026-10-06', commit: prior.commit, method: 'Regex full-text inventory; text hashes normalize CRLF to LF, binary hashes use exact bytes; actual preload invoke/event direction; exclusive ownership and explicit IPC sets. Reachability includes type imports and is not a deletion proof.',
  policy: { backwardCompatibility: false, legacyDataMigration: false, fallback: false, initialization: 'new dataDir and explicit current-schema settings', failure: 'explicit error; no automatic alternate route' },
  preExistingChanges: prior.preExistingChanges, scope: { codeRoots: scanRoots, rootFiles, resourceRoot: 'thumbnail/psd-templates',
    exclusions: ['node_modules', 'generated dist', '.git/.codex/.agents/.aws', '*.log', 'release evidence/history', 'generated planning evidence (this tool and its outputs)'] },
  workPackages: packages, files: rows, ipc, testCoverage, resources, documents };
const counts = (items, field) => Object.fromEntries([...new Set(items.map((r) => r[field]))].sort().map((value) => [value, items.filter((r) => r[field] === value).length]));
inventory.counts = { files: rows.length, source: rows.filter((r) => r.file.startsWith('src/')).length, tests: testCoverage.length,
  scripts: rows.filter((r) => r.file.startsWith('scripts/')).length, ipc: ipc.length, resources: resources.length, documents: documents.length,
  ownership: counts(rows, 'workPackage'), ipcDisposition: counts(ipc, 'disposition'), ipcDirection: counts(ipc, 'direction'), testRegistration: counts(testCoverage, 'registration') };
let md = '# Web完全移行: 全コード調査索引\n\nStatus: Planning evidence / 再照合: 2026-10-06\n\n';
md += '[移行計画](web-migration-plan.md)のW01–W14とG01–G14を正本とする。後方互換性なし・旧データマイグレーションなし・fallback禁止を全項目へ適用する。新dataDir/現行schema/明示設定で開始し、対応外・失敗はerrorとする。各code fileとIPCは主担当を一つだけ持つ。phaseは主実装受入段階。desktopRemovalPhase=P9は旧sourceの残存確認・撤去段階であり、互換adapterを提供する期間ではない。依存・横断条件は計画側を参照する。\n\n';
md += `基準commit: \`${inventory.commit}\`。公開済みv0.82.0から作成した刷新統合branchを照合する。元の作業ツリーにある未統合のCLI修正は含めない。旧P1原型は破棄済み。全${rows.length}コード・設定（src ${inventory.counts.source}、tests ${testCoverage.length}、scripts ${inventory.counts.scripts}）、${resources.length} binary asset、${documents.length}仕様文書を別母集団で管理する。生成済dist・依存package・release履歴・秘密設定は除外。全行の手動レビュー/実動作保証ではない。\n\n`;
md += '[機械可読索引](web-migration-inventory.json)にhash・import・根拠行・分類・test実行経路を保存する。[再照合ツール](web-migration-audit.cjs)は`node docs/roadmap/web-migration-audit.cjs --check`で検証し、`--write`で再生成する。現索引との差分、未分類file/IPC、主担当重複、IPC方向/handler不整合は失敗する。新file/IPCの処置をレビューしてから再生成する。\n\n';
md += '## 修正した不整合\n\n- 旧regex `[A-Z_]`はR2識別子を途中まで抽出していた。`[A-Z0-9_]`に直し、R2全handlerを実在file/行へ接続した。\n- 通知はsuffixで推測せずpreloadのinvoke/onで確定。`ui-flow`と`event`の混在をなくし、通信方向を別軸へ分離した。\n- THUMBNAIL_EXPORT、MARKETPLACE_GENERATE/EXPORT_CUSTOMをbinary処理へ、THUMBNAIL_PICKER_PERF_OPENをnative操作へ明示分類した。\n- .gitignore/.gitattributes、binary PSD/preview、仕様文書、testの未接続項目を明示した。\n- EXECUTION_LEAVEは工程移動を許可する既存queryであり、Run停止を要求しない。詳細は計画4.2参照。\n\n';
md += '## 集計（排他的な分類）\n\n| 主担当 | file数 | 完成phase | 検証gate |\n| --- | ---: | --- | --- |\n';
for (const [id, spec] of Object.entries(packages)) md += `| ${id} ${spec.name} | ${inventory.counts.ownership[id] || 0} | ${spec.phase} | ${spec.gate} |\n`;
md += '\nIPC分類: ' + Object.entries(inventory.counts.ipcDisposition).map(([key, n]) => `${key}=${n}`).join(' / ') + '。\n\n';
md += '## ファイル別処置\n\n| ファイル | 行数 | 主担当 / phase / gate | 処置 |\n| --- | ---: | --- | --- |\n';
for (const r of rows) md += `| [${r.file}](../../${r.file}) | ${r.lines} | ${r.workPackage} / ${r.phase} / ${r.gate}${r.desktopRemovalPhase ? '; Desktop撤去 P9' : ''}${r.electronDependencyRemovalPhase ? '; Electron依存置換 ' + r.electronDependencyRemovalPhase : ''} | ${r.migrationAction} |\n`;
md += '\n## IPC全定義の処置\n\nqueryは変更なしのGETを保証する名称ではない。caveat項目は復旧/選択変更等をcommandへ分離する。binary-commandはHTTP画像処理/保存job、binary-queryは認可binary取得。ui-flowはReact UIとserver sessionを接合する操作、native-replacementはOS操作の代替である。confirmは別の横断属性。\n\n| 定義 | 現方向・根拠 | 移行分類 | 主担当 / phase / gate | 補足 |\n| --- | --- | --- | --- | --- |\n';
for (const r of ipc) md += `| ${r.key} | ${r.direction}: ${(r.direction === 'invoke' ? r.handlers : r.senders).map((v) => `[${path.basename(v.file)}:${v.line}](../../${v.file}#L${v.line})`).join(', ')} | ${r.disposition} | ${r.workPackage} / ${r.phase} / ${r.gate} | ${r.confirmation ? '確認token; ' : ''}${r.caveat} |\n`;
md += '\n## Test全fileの実行経路と処置\n\n現経路は旧版調査の分類。刷新branchではCIなし・新契約のローカル検証必須。旧schema互換・移行・fallbackを前提にしたtestは新要求へ置換/廃止し、旧Desktop専用testの成功を受入条件にしない。再利用する業務testも新入力契約を検証する。feature gateは対応先であり、そのtestだけでgateを満たす意味ではない。\n\n| file | 現経路 | 処置 | 対象feature gate | 完了条件 |\n| --- | --- | --- | --- | --- |\n';
for (const r of testCoverage) md += `| [${r.file}](../../${r.file}) | ${r.registration} | ${r.treatment} | ${r.featureGates.join(', ')} | ${r.requiredAction} (${r.targetGate}) |\n`;
md += '\n## Binary resource（code fileと別母集団）\n\n| file | role | 処置 |\n| --- | --- | --- |\n';
for (const r of resources) md += `| [${r.file}](../../${r.file}) | ${r.role} | ${r.role === 'runtime-PSD' ? 'server resource配置・PSD編集/書出検証' : 'reference保持・視覚比較の採否を記録'} (${r.workPackage}/${r.gate}) |\n`;
md += '\n## 既存仕様文書（実装完了前にActive仕様を上書きしない）\n\n| file | 処置 |\n| --- | --- |\n';
for (const r of documents) md += `| [${r.file}](../../${r.file}) | ${r.treatment} (${r.workPackage}/${r.gate}) |\n`;
const outputs = { 'docs/roadmap/web-migration-inventory.json': JSON.stringify(inventory, null, 2) + '\n', 'docs/roadmap/web-migration-audit.md': md };
if (process.argv.includes('--write')) for (const [file, content] of Object.entries(outputs)) fs.writeFileSync(path.join(root, file), content);
else {
  for (const [file, content] of Object.entries(outputs)) if (read(file) !== content) throw new Error(`Stale evidence: ${file}; review and run --write`);
  for (const file of ['docs/roadmap/web-migration-plan.md', 'docs/roadmap/web-migration-audit.md']) {
    const source = read(file);
    for (const id of Object.keys(packages)) if (!source.includes(id)) throw new Error(`Missing package ${id}: ${file}`);
    for (const spec of Object.values(packages)) if (!source.includes(spec.gate)) throw new Error(`Missing gate ${spec.gate}: ${file}`);
    for (const match of source.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^(https?:|#)/.test(match[1])) continue;
      if (!fs.existsSync(path.resolve(root, path.dirname(file), match[1].split('#')[0]))) throw new Error(`Broken link ${file}: ${match[1]}`);
    }
  }
  const plan = read('docs/roadmap/web-migration-plan.md');
  for (const requirement of ['後方互換性と旧データのマイグレーションは実装しない', 'fallbackは禁止する']) {
    if (!plan.includes(requirement)) throw new Error(`Missing mandatory policy: ${requirement}`);
  }
  for (const id of Object.keys(packages)) {
    const ownerRows = [...plan.matchAll(new RegExp(`^\\| ${id} \\|.*`, 'gm'))];
    const gateRows = [...plan.matchAll(new RegExp(`^\\| ${packages[id].gate} \\| ${id} \\|.*`, 'gm'))];
    if (ownerRows.length !== 1 || gateRows.length !== 1) throw new Error(`Plan owner/gate missing or duplicated: ${id}`);
    if (!ownerRows[0][0].includes(`${packages[id].phase} / ${packages[id].gate}`)) throw new Error(`Plan phase/gate mismatch: ${id}`);
  }
}
console.log(JSON.stringify({ status: 'PASS', mode: process.argv.includes('--write') ? 'write' : 'check', ...inventory.counts }));
