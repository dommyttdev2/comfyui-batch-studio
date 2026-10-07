import path from 'node:path';
import {
  ExecutionCoordinator as Coordinator,
  type ExecutionRef,
  ExecutionResourceLockManager as Locks,
} from '../application/execution-coordinator.js';
export function normalizeComfyUiEndpoint(endpoint: string) {
  const value = endpoint.trim();
  if (!value) throw new Error('Local ComfyUI API endpoint is required.');
  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString().replace(/\/$/, '');
  } catch {
    return value.replace(/\/+$/, '').toLowerCase();
  }
}

export type { ExecutionRef } from '../application/execution-coordinator.js';

const canonical = (ref: ExecutionRef) => ({ ...ref, projectRoot: path.resolve(ref.projectRoot) });
export class ExecutionResourceLockManager extends Locks {
  constructor() {
    super(normalizeComfyUiEndpoint);
  }
  override acquireLocal(endpoint: string, ref: ExecutionRef) {
    return super.acquireLocal(endpoint, canonical(ref));
  }
  override acquireRemote(provider: string, instanceId: number, ref: ExecutionRef) {
    return super.acquireRemote(provider, instanceId, canonical(ref));
  }
  override release(ref: ExecutionRef) {
    return super.release(canonical(ref));
  }
}
export class ExecutionCoordinator extends Coordinator {
  constructor(locks = new ExecutionResourceLockManager()) {
    super(locks);
  }
  override hasActive(ref: ExecutionRef) {
    return super.hasActive(canonical(ref));
  }
  override retain(ref: ExecutionRef) {
    return super.retain(canonical(ref));
  }
  override reserveLocal(ref: ExecutionRef, endpoint: string) {
    return super.reserveLocal(canonical(ref), endpoint);
  }
  override reserveRemote(ref: ExecutionRef, provider: string, instanceId: number) {
    return super.reserveRemote(canonical(ref), provider, instanceId);
  }
  override releaseReservation(ref: ExecutionRef) {
    return super.releaseReservation(canonical(ref));
  }
  override waitForSettled(ref: ExecutionRef) {
    return super.waitForSettled(canonical(ref));
  }
  override startLocal(ref: ExecutionRef, endpoint: string, work: () => Promise<void>) {
    return super.startLocal(canonical(ref), endpoint, work);
  }
  override startRemote(
    ref: ExecutionRef,
    provider: string,
    instanceId: number,
    work: () => Promise<void>,
  ) {
    return super.startRemote(canonical(ref), provider, instanceId, work);
  }
}
