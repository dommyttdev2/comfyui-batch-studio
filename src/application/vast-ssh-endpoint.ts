import type { VastAiInstance } from '../domain/artifact-types.js';
import type { VastAiSshEndpoint } from '../domain/integration-types.js';
export interface VastSshPorts {
  instance(id: number): Promise<VastAiInstance>;
  settings(): Promise<{
    sshPrivateKeyPath: string;
    sshPrivateKeyExists: boolean;
    sshPublicKeyPath: string;
    sshPublicKeyExists: boolean;
    sshUser: string;
  }>;
  installPath(): Promise<string>;
  publicKey(privateKey: string, publicKey: string): Promise<string>;
  provision(id: number, key: string): Promise<unknown>;
}
export async function resolveVastSshEndpoint(
  ports: VastSshPorts,
  instanceId: number,
): Promise<VastAiSshEndpoint> {
  const instance = await ports.instance(instanceId),
    settings = await ports.settings(),
    directory = await ports.installPath();
  if (instance.id !== instanceId) throw new Error('Vast.ai Instance identity mismatch.');
  if (instance.status !== 'running')
    throw new Error(`Vast.ai Instance ${instanceId} はrunningではありません。`);
  if (!instance.sshHost || !instance.sshPort)
    throw new Error(`Vast.ai Instance ${instanceId} の公開SSH接続先を取得できません。`);
  if (!instance.comfyUiPort)
    throw new Error(
      `Vast.ai Instance ${instanceId} のComfyUI Portをportsから解決できません。18188/tcp または 8188/tcp の公開設定を確認してください。`,
    );
  if (!settings.sshPrivateKeyPath || !settings.sshPrivateKeyExists)
    throw new Error('Vast.ai連携設定でSSH秘密鍵を指定してください。');
  if (!settings.sshPublicKeyPath || !settings.sshPublicKeyExists)
    throw new Error('Vast.ai連携設定でSSH公開鍵を指定してください。');
  if (!directory)
    throw new Error('環境設定でRemote ComfyUIのインストール先ディレクトリを指定してください。');
  const key = await ports.publicKey(settings.sshPrivateKeyPath, settings.sshPublicKeyPath);
  await ports.provision(instanceId, key);
  return {
    provider: 'vastai',
    instanceId,
    host: instance.sshHost,
    port: instance.sshPort,
    user: settings.sshUser,
    privateKeyPath: settings.sshPrivateKeyPath,
    publicKeyPath: settings.sshPublicKeyPath,
    comfyUiDirectory: directory,
    comfyUiPort: instance.comfyUiPort,
  };
}
