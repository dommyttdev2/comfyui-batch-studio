import { executionArchiveTimestampJst as stamp } from '../domain/time-policy.js';
export function executionArchiveTimestampJst(value: string | Date) {
  return stamp(value instanceof Date ? value.toISOString() : value);
}
