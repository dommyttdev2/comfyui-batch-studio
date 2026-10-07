import type { ValidationIssue } from './artifact-types.js';
export interface RemoteTargetFacts {
  provider?: string;
  instanceId?: number;
  configured: boolean;
  installPath: string;
  githubPatConfigured: boolean;
  sshPrivateKeyPath: string | null;
  sshPrivateKeyExists: boolean;
  sshPublicKeyPath: string | null;
  sshPublicKeyExists: boolean;
  sshKeyPairValid: boolean;
  instance: {
    id: number;
    status: string;
    statusMessage?: string | null;
    sshHost?: string | null;
    sshPort?: number | null;
  } | null;
  lookupError: string | null;
}
export function assessRemoteTarget(facts: RemoteTargetFacts): ValidationIssue[] {
  const { provider, instanceId } = facts;
  if (provider !== 'vastai' || !Number.isInteger(instanceId) || Number(instanceId) < 1)
    return [
      {
        severity: 'error',
        code: 'REMOTE_INSTANCE_REQUIRED',
        message: 'リモート実行にはVast.ai Instanceを選択してください。',
      },
    ];
  const issues: ValidationIssue[] = [];
  if (!facts.installPath)
    issues.push({
      severity: 'error',
      code: 'REMOTE_COMFYUI_INSTALL_PATH_REQUIRED',
      message:
        'リモート実行には環境設定でRemote ComfyUIのインストール先ディレクトリを指定してください。',
    });
  if (!facts.githubPatConfigured)
    issues.push({
      severity: 'error',
      code: 'REMOTE_GITHUB_PAT_REQUIRED',
      message:
        'リモート環境のComfyUI更新に使用するGitHub PATを環境設定または BATCH_STUDIO_GITHUB_PAT / GH_TOKEN で設定してください。',
    });
  if (!facts.configured)
    issues.push({
      severity: 'error',
      code: 'VASTAI_NOT_CONFIGURED',
      message: 'サービス連携でVast.ai API Keyを設定してください。',
    });
  if (!facts.sshPrivateKeyPath)
    issues.push({
      severity: 'error',
      code: 'VASTAI_SSH_KEY_REQUIRED',
      message: 'サービス連携でVast.ai用SSH秘密鍵を指定してください。',
    });
  else if (!facts.sshPrivateKeyExists)
    issues.push({
      severity: 'error',
      code: 'VASTAI_SSH_KEY_MISSING',
      message: `Vast.ai用SSH秘密鍵が見つかりません: ${facts.sshPrivateKeyPath}`,
    });
  if (!facts.sshPublicKeyPath)
    issues.push({
      severity: 'error',
      code: 'VASTAI_SSH_PUBLIC_KEY_REQUIRED',
      message: 'サービス連携でVast.ai用SSH公開鍵を指定してください。',
    });
  else if (!facts.sshPublicKeyExists)
    issues.push({
      severity: 'error',
      code: 'VASTAI_SSH_PUBLIC_KEY_MISSING',
      message: `Vast.ai用SSH公開鍵が見つかりません: ${facts.sshPublicKeyPath}`,
    });
  else if (facts.sshPrivateKeyExists && !facts.sshKeyPairValid)
    issues.push({
      severity: 'error',
      code: 'VASTAI_SSH_KEY_PAIR_MISMATCH',
      message: '設定されたSSH秘密鍵とSSH公開鍵が同じキーペアではありません。',
    });
  const instance = facts.instance;
  if (instance && instance.id !== instanceId)
    issues.push({
      severity: 'error',
      code: 'VASTAI_INSTANCE_SCOPE_MISMATCH',
      message: 'Returned Instance does not match selected Instance.',
    });
  if (instance) {
    if (instance.status === 'error' || instance.status === 'offline')
      issues.push({
        severity: 'error',
        code: 'VASTAI_INSTANCE_UNAVAILABLE',
        message: `Vast.ai Instance ${instance.id} は ${instance.status} 状態です。${instance.statusMessage ? ` ${instance.statusMessage}` : ''}`,
      });
    else if (instance.status === 'running' && (!instance.sshHost || !instance.sshPort))
      issues.push({
        severity: 'error',
        code: 'VASTAI_SSH_ENDPOINT_MISSING',
        message: `Vast.ai Instance ${instance.id} はrunningですが公開SSH接続先を取得できません。`,
      });
    else if (['starting', 'stopping', 'scheduling', 'unknown'].includes(instance.status))
      issues.push({
        severity: 'warning',
        code: 'VASTAI_INSTANCE_TRANSITIONING',
        message: `Vast.ai Instance ${instance.id} は現在 ${instance.status} 状態です。実行開始時に状態を再確認します。`,
      });
  }
  if (facts.lookupError || (facts.configured && !instance))
    issues.push({
      severity: 'error',
      code: 'VASTAI_INSTANCE_LOOKUP_FAILED',
      message: `Vast.ai Instanceを確認できません: ${facts.lookupError ?? 'No instance returned'}`,
    });
  return issues;
}
