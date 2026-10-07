import type {
  AvailabilityResult,
  ExecutionTarget,
  ModelAvailabilityRow,
  ValidationIssue,
} from './artifact-types.js';
export function modelAvailabilityState(
  target: ExecutionTarget,
  local: boolean,
  r2: boolean,
): ModelAvailabilityRow['state'] {
  const required = target === 'local' ? local : r2;
  const alternate = target === 'local' ? r2 : local;
  return required ? 'available' : alternate ? 'transfer-required' : 'missing';
}
export function assessModelAvailability(
  rows: ModelAvailabilityRow[],
  executionTarget: ExecutionTarget,
  localRoot: string,
  localRootExists: boolean,
): AvailabilityResult {
  const issues: ValidationIssue[] = [];
  if (executionTarget === 'local' && !localRoot)
    issues.push({
      severity: 'error',
      code: 'COMFYUI_INSTALL_PATH_REQUIRED',
      message:
        'ローカル実行にはComfyUIのインストール先設定が必要です。環境設定でComfyUIのインストール先ディレクトリを指定してください。',
    });
  else if (executionTarget === 'local' && !localRootExists)
    issues.push({
      severity: 'error',
      code: 'COMFYUI_MODELS_ROOT_MISSING',
      message: `ローカル実行のモデル確認先 ${localRoot} が見つかりません。環境設定のComfyUIインストール先を確認してください。`,
    });
  if (executionTarget === 'local' && localRootExists) {
    for (const row of rows.filter((x) => !x.local))
      issues.push({
        severity: 'error',
        code: row.r2 ? 'MODEL_LOCAL_PLACEMENT_REQUIRED' : 'MODEL_LOCAL_FILE_MISSING',
        message: row.r2
          ? `${row.fileName} はR2にありますが、ローカル実行には ${localRoot} 配下への配置が必須です。`
          : `${row.fileName} が ${localRoot} 配下に見つかりません。ローカル実行にはローカル配置が必須です。`,
        path: row.ref,
      });
  }
  if (executionTarget === 'remote') {
    for (const row of rows.filter((x) => !x.r2))
      issues.push({
        severity: 'error',
        code: row.local ? 'MODEL_R2_PLACEMENT_REQUIRED' : 'MODEL_R2_FILE_MISSING',
        message: row.local
          ? `${row.fileName} はローカルにありますが、リモート実行にはR2への配置が必須です。`
          : `${row.fileName} がR2に見つかりません。リモート実行にはR2への配置が必須です。`,
        path: row.ref,
      });
  }
  return {
    rows,
    executionTarget,
    localModelsRoot: localRoot || null,
    validation: { valid: !issues.some((i) => i.severity === 'error'), issues },
  };
}
