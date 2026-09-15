import { stat } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import workflowCustomNodes from '../shared/workflow-custom-nodes.json' with { type: 'json' };
import type {
  AppSettings,
  AppSettingsSaveInput,
  AppSettingsStatus,
  RemoteCustomNodeRepository,
} from '../shared/types.js';
import { readJson, writeJsonAtomic } from './fs-utils.js';
import { listLocalModelFiles } from './model-file-sources.js';

interface StoredAppSettingsV1 {
  schemaVersion: 1;
  comfyUiInstallPath: string;
}
interface StoredAppSettingsV2 {
  schemaVersion: 2;
  comfyUiInstallPath: string;
  catalogPath: string;
  r2Bucket: string;
  r2ModelPrefix: string;
  r2IndexPath: string;
  templatePath: string;
  manifestPath: string;
}
interface StoredAppSettingsV3 {
  schemaVersion: 3;
  comfyUiInstallPath: string;
  projectRoot: string;
  artifactRoot: string;
  catalogPath: string;
  r2Bucket: string;
  r2ModelPrefix: string;
  r2IndexPath: string;
  templatePath: string;
  manifestPath: string;
}
interface StoredAppSettingsV4 {
  schemaVersion: 4;
  comfyUiInstallPath: string;
  comfyUiApiEndpoint: string;
  projectRoot: string;
  artifactRoot: string;
  catalogPath: string;
  r2Bucket: string;
  r2ModelPrefix: string;
  r2IndexPath: string;
  templatePath: string;
  manifestPath: string;
}
interface StoredAppSettingsV5 {
  schemaVersion: 5;
  comfyUiInstallPath: string;
  remoteComfyUiInstallPath: string;
  comfyUiApiEndpoint: string;
  projectRoot: string;
  artifactRoot: string;
  catalogPath: string;
  r2Bucket: string;
  r2ModelPrefix: string;
  r2IndexPath: string;
  templatePath: string;
  manifestPath: string;
}
interface StoredAppSettingsV6 {
  schemaVersion: 6;
  comfyUiInstallPath: string;
  remoteComfyUiInstallPath: string;
  comfyUiApiEndpoint: string;
  projectRoot: string;
  artifactRoot: string;
  remoteCustomNodes: RemoteCustomNodeRepository[];
  catalogPath: string;
  r2Bucket: string;
  r2ModelPrefix: string;
  r2IndexPath: string;
  templatePath: string;
  manifestPath: string;
}
interface StoredAppSettingsV7 {
  schemaVersion: 7;
  comfyUiInstallPath: string;
  remoteComfyUiInstallPath: string;
  comfyUiApiEndpoint: string;
  projectRoot: string;
  artifactRoot: string;
  remoteCustomNodes: RemoteCustomNodeRepository[];
  catalogPath: string;
  r2Bucket: string;
  r2ModelPrefix: string;
  r2IndexPath: string;
  templatePath: string;
  manifestPath: string;
}
interface StoredGithubAuthConfig {
  schemaVersion: 1;
  encryptedPat: string;
}
type StoredAppSettings =
  | StoredAppSettingsV1
  | StoredAppSettingsV2
  | StoredAppSettingsV3
  | StoredAppSettingsV4
  | StoredAppSettingsV5
  | StoredAppSettingsV6
  | StoredAppSettingsV7;
type NormalizedAppSettings = Required<AppSettings>;
function defaultRemoteCustomNodes(): RemoteCustomNodeRepository[] {
  return normalizeRemoteCustomNodes(workflowCustomNodes.repositories);
}
const EMPTY: NormalizedAppSettings = {
  comfyUiInstallPath: '',
  remoteComfyUiInstallPath: '',
  comfyUiApiEndpoint: 'http://127.0.0.1:8188',
  projectRoot: '',
  artifactRoot: '',
  remoteCustomNodes: defaultRemoteCustomNodes(),
  catalogPath: '',
  r2Bucket: '',
  r2ModelPrefix: '',
  r2IndexPath: '',
  templatePath: '',
  manifestPath: '',
};
export const GITHUB_PAT_ENVIRONMENT_VARIABLE = 'BATCH_STUDIO_GITHUB_PAT';
const RUNTIME_ENV = {
  remoteComfyUiInstallPath: 'BATCH_STUDIO_REMOTE_COMFYUI_INSTALL_PATH',
  comfyUiApiEndpoint: 'BATCH_STUDIO_COMFYUI_API_ENDPOINT',
  projectRoot: 'BATCH_STUDIO_PROJECT_ROOT',
  artifactRoot: 'BATCH_STUDIO_ARTIFACT_ROOT',
  catalogPath: 'BATCH_STUDIO_CATALOG_PATH',
  r2Bucket: 'BATCH_STUDIO_R2_BUCKET',
  r2ModelPrefix: 'BATCH_STUDIO_R2_MODEL_PREFIX',
  r2IndexPath: 'BATCH_STUDIO_R2_INDEX_PATH',
  templatePath: 'BATCH_STUDIO_TEMPLATE_PATH',
  manifestPath: 'BATCH_STUDIO_MANIFEST_PATH',
} as const;
async function isDirectory(target: string) {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}
function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}
function endpoint(value: unknown) {
  const raw = text(value) || EMPTY.comfyUiApiEndpoint;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('ComfyUI API endpointが不正です。');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error('ComfyUI API endpointはhttpまたはhttpsで指定してください。');
  if (url.username || url.password)
    throw new Error('ComfyUI API endpointに認証情報を含めないでください。');
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/$/, '');
}
function safeStorageApi() {
  return (createRequire(import.meta.url)('electron') as typeof import('electron')).safeStorage;
}
function encryptSecret(value: string) {
  const safeStorage = safeStorageApi();
  if (!safeStorage.isEncryptionAvailable())
    throw new Error('OSの安全な暗号化ストレージを利用できないためGitHub PATを保存できません。');
  return safeStorage.encryptString(value).toString('base64');
}
function decryptSecret(value: string | undefined) {
  if (!value) return '';
  try {
    return safeStorageApi().decryptString(Buffer.from(value, 'base64'));
  } catch {
    return '';
  }
}
function normalizeGithubRepository(value: unknown) {
  const raw = text(value).replace(/\.git$/i, '');
  if (!raw) throw new Error('custom_node のGitHubリポジトリを入力してください。');
  let repository = raw;
  if (/^https?:\/\//i.test(raw)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error('custom_node のGitHubリポジトリURLが不正です。');
    }
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com')
      throw new Error(
        'custom_node は github.com のHTTPS URLまたは owner/repo 形式で指定してください。',
      );
    repository = url.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
    throw new Error('custom_node は owner/repo 形式で指定してください。');
  return repository;
}
function normalizeRemoteCustomNodes(value: unknown): RemoteCustomNodeRepository[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('Remote custom_nodes の設定が不正です。');
  if (value.length > 100) throw new Error('Remote custom_nodes は100件以内で設定してください。');
  const seen = new Set<string>(),
    destinations = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new Error(`Remote custom_nodes #${index + 1} の設定が不正です。`);
    const repository = normalizeGithubRepository((item as any).repository),
      ref = text((item as any).ref);
    const key = repository.toLowerCase();
    if (seen.has(key))
      throw new Error(`Remote custom_nodes に重複したリポジトリがあります: ${repository}`);
    seen.add(key);
    const destination = repository.split('/')[1].toLowerCase();
    if (destinations.has(destination))
      throw new Error(`Remote custom_nodes の配置先名が重複します: ${repository}`);
    destinations.add(destination);
    return ref ? { repository, ref } : { repository };
  });
}
function migrateRemoteCustomNodes(value: unknown): RemoteCustomNodeRepository[] {
  const existing = normalizeRemoteCustomNodes(value);
  const defaults = defaultRemoteCustomNodes();
  const existingByRepository = new Map(
    existing.map((node) => [node.repository.toLowerCase(), node] as const),
  );
  const defaultKeys = new Set(defaults.map((node) => node.repository.toLowerCase()));
  return [
    ...defaults.map(
      (node) => existingByRepository.get(node.repository.toLowerCase()) ?? { ...node },
    ),
    ...existing.filter((node) => !defaultKeys.has(node.repository.toLowerCase())),
  ];
}
function normalize(raw: StoredAppSettings | null): NormalizedAppSettings {
  if (raw?.schemaVersion === 1)
    return { ...EMPTY, comfyUiInstallPath: text(raw.comfyUiInstallPath) };
  if (raw?.schemaVersion === 2)
    return {
      ...EMPTY,
      comfyUiInstallPath: text(raw.comfyUiInstallPath),
      catalogPath: text(raw.catalogPath),
      r2Bucket: text(raw.r2Bucket),
      r2ModelPrefix: text(raw.r2ModelPrefix).replace(/^\/+|\/+$/g, ''),
      r2IndexPath: text(raw.r2IndexPath),
      templatePath: text(raw.templatePath),
      manifestPath: text(raw.manifestPath),
    };
  if (raw?.schemaVersion === 3)
    return {
      ...EMPTY,
      comfyUiInstallPath: text(raw.comfyUiInstallPath),
      projectRoot: text(raw.projectRoot),
      artifactRoot: text(raw.artifactRoot),
      catalogPath: text(raw.catalogPath),
      r2Bucket: text(raw.r2Bucket),
      r2ModelPrefix: text(raw.r2ModelPrefix).replace(/^\/+|\/+$/g, ''),
      r2IndexPath: text(raw.r2IndexPath),
      templatePath: text(raw.templatePath),
      manifestPath: text(raw.manifestPath),
    };
  if (raw?.schemaVersion === 4)
    return {
      ...EMPTY,
      ...raw,
      comfyUiInstallPath: text(raw.comfyUiInstallPath),
      comfyUiApiEndpoint: endpoint(raw.comfyUiApiEndpoint),
      projectRoot: text(raw.projectRoot),
      artifactRoot: text(raw.artifactRoot),
      catalogPath: text(raw.catalogPath),
      r2Bucket: text(raw.r2Bucket),
      r2ModelPrefix: text(raw.r2ModelPrefix).replace(/^\/+|\/+$/g, ''),
      r2IndexPath: text(raw.r2IndexPath),
      templatePath: text(raw.templatePath),
      manifestPath: text(raw.manifestPath),
    };
  if (raw?.schemaVersion === 5)
    return {
      ...EMPTY,
      ...raw,
      comfyUiInstallPath: text(raw.comfyUiInstallPath),
      remoteComfyUiInstallPath: text(raw.remoteComfyUiInstallPath),
      comfyUiApiEndpoint: endpoint(raw.comfyUiApiEndpoint),
      projectRoot: text(raw.projectRoot),
      artifactRoot: text(raw.artifactRoot),
      catalogPath: text(raw.catalogPath),
      r2Bucket: text(raw.r2Bucket),
      r2ModelPrefix: text(raw.r2ModelPrefix).replace(/^\/+|\/+$/g, ''),
      r2IndexPath: text(raw.r2IndexPath),
      templatePath: text(raw.templatePath),
      manifestPath: text(raw.manifestPath),
    };
  if (raw?.schemaVersion === 6)
    return {
      ...EMPTY,
      ...raw,
      comfyUiInstallPath: text(raw.comfyUiInstallPath),
      remoteComfyUiInstallPath: text(raw.remoteComfyUiInstallPath),
      comfyUiApiEndpoint: endpoint(raw.comfyUiApiEndpoint),
      projectRoot: text(raw.projectRoot),
      artifactRoot: text(raw.artifactRoot),
      remoteCustomNodes: migrateRemoteCustomNodes(raw.remoteCustomNodes),
      catalogPath: text(raw.catalogPath),
      r2Bucket: text(raw.r2Bucket),
      r2ModelPrefix: text(raw.r2ModelPrefix).replace(/^\/+|\/+$/g, ''),
      r2IndexPath: text(raw.r2IndexPath),
      templatePath: text(raw.templatePath),
      manifestPath: text(raw.manifestPath),
    };
  if (raw?.schemaVersion === 7)
    return {
      ...EMPTY,
      ...raw,
      comfyUiInstallPath: text(raw.comfyUiInstallPath),
      remoteComfyUiInstallPath: text(raw.remoteComfyUiInstallPath),
      comfyUiApiEndpoint: endpoint(raw.comfyUiApiEndpoint),
      projectRoot: text(raw.projectRoot),
      artifactRoot: text(raw.artifactRoot),
      remoteCustomNodes: normalizeRemoteCustomNodes(raw.remoteCustomNodes),
      catalogPath: text(raw.catalogPath),
      r2Bucket: text(raw.r2Bucket),
      r2ModelPrefix: text(raw.r2ModelPrefix).replace(/^\/+|\/+$/g, ''),
      r2IndexPath: text(raw.r2IndexPath),
      templatePath: text(raw.templatePath),
      manifestPath: text(raw.manifestPath),
    };
  return { ...EMPTY };
}
function applyRuntimeEnvironment(settings: NormalizedAppSettings) {
  for (const [key, envKey] of Object.entries(RUNTIME_ENV) as Array<
    [keyof typeof RUNTIME_ENV, string]
  >)
    process.env[envKey] = settings[key];
}
async function normalizeRootDirectory(label: string, value: unknown) {
  const target = text(value);
  if (!target) return '';
  if (!path.isAbsolute(target)) throw new Error(`${label}は絶対パスで指定してください。`);
  const resolved = path.resolve(target);
  if (!(await isDirectory(resolved))) throw new Error(`${label}のディレクトリが見つかりません。`);
  return resolved;
}
function normalizeRemoteComfyUiDirectory(value: unknown) {
  const target = text(value).replace(/\\/g, '/');
  if (!target) return '';
  if (!path.posix.isAbsolute(target))
    throw new Error('Remote ComfyUIのインストール先はPOSIX絶対パスで指定してください。');
  const normalized = path.posix.normalize(target);
  if (normalized === '/') throw new Error('Remote ComfyUIのインストール先に / は指定できません。');
  return normalized.replace(/\/$/, '');
}

export class AppSettingsStore {
  private readonly filePath: string;
  private readonly githubAuthPath: string;
  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'app-settings.json');
    this.githubAuthPath = path.join(userDataPath, 'github-auth.json');
  }
  private async read(): Promise<NormalizedAppSettings> {
    return normalize(await readJson<StoredAppSettings>(this.filePath));
  }
  private async readGithubAuth() {
    return readJson<StoredGithubAuthConfig>(this.githubAuthPath);
  }
  private environmentGithubPat() {
    return text(process.env[GITHUB_PAT_ENVIRONMENT_VARIABLE]) || text(process.env.GH_TOKEN);
  }
  async githubPat() {
    const environment = this.environmentGithubPat();
    if (environment) return environment;
    return decryptSecret((await this.readGithubAuth())?.encryptedPat);
  }
  async initialize() {
    const current = await this.read();
    applyRuntimeEnvironment(current);
    return this.statusFrom(current);
  }
  async values(): Promise<NormalizedAppSettings> {
    return this.read();
  }
  private async githubPatStatus() {
    const environment = this.environmentGithubPat();
    if (environment) return { githubPatConfigured: true, githubPatSource: 'environment' as const };
    const saved = decryptSecret((await this.readGithubAuth())?.encryptedPat);
    return saved
      ? { githubPatConfigured: true, githubPatSource: 'saved' as const }
      : { githubPatConfigured: false, githubPatSource: 'none' as const };
  }
  private async statusFrom(current: NormalizedAppSettings): Promise<AppSettingsStatus> {
    const installPath = current.comfyUiInstallPath,
      modelsPath = installPath ? path.join(installPath, 'models') : null;
    const [textEncoders, vae, github] = await Promise.all([
      listLocalModelFiles(modelsPath, 'text_encoder'),
      listLocalModelFiles(modelsPath, 'vae'),
      this.githubPatStatus(),
    ]);
    return {
      ...current,
      ...github,
      configured: Boolean(installPath),
      modelsPath,
      installExists: Boolean(installPath && (await isDirectory(installPath))),
      modelsExists: Boolean(modelsPath && (await isDirectory(modelsPath))),
      modelFiles: { text_encoders: textEncoders, vae },
    };
  }
  async status(): Promise<AppSettingsStatus> {
    return this.statusFrom(await this.read());
  }
  async save(input: AppSettingsSaveInput): Promise<AppSettingsStatus> {
    let comfyUiInstallPath = text(input?.comfyUiInstallPath);
    if (comfyUiInstallPath) {
      if (!path.isAbsolute(comfyUiInstallPath))
        throw new Error('ComfyUIのインストール先は絶対パスで指定してください。');
      comfyUiInstallPath = path.resolve(comfyUiInstallPath);
      if (!(await isDirectory(comfyUiInstallPath)))
        throw new Error('指定したComfyUIのインストール先ディレクトリが見つかりません。');
      const modelsPath = path.join(comfyUiInstallPath, 'models');
      if (!(await isDirectory(modelsPath)))
        throw new Error(
          '指定したディレクトリにmodelsフォルダーがありません。ComfyUIのインストール先ディレクトリを指定してください。',
        );
    }
    const [projectRoot, artifactRoot] = await Promise.all([
      normalizeRootDirectory('Project root', input?.projectRoot),
      normalizeRootDirectory('成果物配置 root', input?.artifactRoot),
    ]);
    const value: NormalizedAppSettings = {
      comfyUiInstallPath,
      remoteComfyUiInstallPath: normalizeRemoteComfyUiDirectory(input?.remoteComfyUiInstallPath),
      comfyUiApiEndpoint: endpoint(input?.comfyUiApiEndpoint),
      projectRoot,
      artifactRoot,
      remoteCustomNodes: normalizeRemoteCustomNodes(input?.remoteCustomNodes),
      catalogPath: text(input?.catalogPath),
      r2Bucket: text(input?.r2Bucket),
      r2ModelPrefix: text(input?.r2ModelPrefix).replace(/^\/+|\/+$/g, ''),
      r2IndexPath: text(input?.r2IndexPath),
      templatePath: text(input?.templatePath),
      manifestPath: text(input?.manifestPath),
    };
    await writeJsonAtomic(this.filePath, {
      schemaVersion: 7,
      ...value,
    } satisfies StoredAppSettingsV7);
    const githubPat = text(input?.githubPat);
    if (githubPat)
      await writeJsonAtomic(this.githubAuthPath, {
        schemaVersion: 1,
        encryptedPat: encryptSecret(githubPat),
      } satisfies StoredGithubAuthConfig);
    applyRuntimeEnvironment(value);
    return this.statusFrom(value);
  }
}
