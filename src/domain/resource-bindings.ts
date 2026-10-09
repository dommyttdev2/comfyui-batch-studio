import { BusinessError } from './contracts.js';
export interface ResourceBindings {
  executionTarget: 'local' | 'remote';
  localRootId: string | null;
  r2Bucket: string | null;
  r2Prefix: string;
  remoteInstanceId: number | null;
}
export function resourceBindings(raw: unknown): ResourceBindings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new BusinessError('INVALID_INPUT', 'Current resource bindings required.');
  const r = raw as Record<string, unknown>,
    keys = ['executionTarget', 'localRootId', 'r2Bucket', 'r2Prefix', 'remoteInstanceId'];
  if (
    Object.keys(r).some((k) => !keys.includes(k)) ||
    keys.some((k) => !Object.hasOwn(r, k)) ||
    !['local', 'remote'].includes(String(r.executionTarget)) ||
    (r.localRootId !== null &&
      (typeof r.localRootId !== 'string' || !/^[a-f0-9]{64}$/.test(r.localRootId))) ||
    (r.r2Bucket !== null &&
      (typeof r.r2Bucket !== 'string' || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(r.r2Bucket))) ||
    typeof r.r2Prefix !== 'string' ||
    r.r2Prefix.length > 512 ||
    /[\0\r\n\\]/.test(r.r2Prefix) ||
    r.r2Prefix.startsWith('/') ||
    r.r2Prefix.endsWith('/') ||
    r.r2Prefix.split('/').some((p) => p === '.' || p === '..') ||
    r.r2Prefix.startsWith('.batch-studio/') ||
    (r.remoteInstanceId !== null &&
      (!Number.isSafeInteger(r.remoteInstanceId) || Number(r.remoteInstanceId) < 1)) ||
    (r.r2Bucket === null && r.r2Prefix !== '')
  )
    throw new BusinessError('INVALID_INPUT', 'Invalid resource bindings.');
  return { ...r } as unknown as ResourceBindings;
}
