import { fail } from './error';
export interface QueueLimits {
  maxPendingBytes: number;
  maxSyncPendingBytes: number;
  maxSyncPendingRecords: number;
  maxSyncAssetBytes: number;
  maxPendingRecords: number;
  maxPageBytes: number;
  maxPageRecords: number;
  maxPageAssets: number;
  maxAssetBytes: number;
  maxPendingAssetBytes: number;
}
export const defaultLimits: QueueLimits = {
  maxPendingBytes: 67_108_864,
  maxSyncPendingBytes: 16_777_216,
  maxSyncPendingRecords: 25_000,
  maxSyncAssetBytes: 268_435_456,
  maxPendingRecords: 100_000,
  maxPageBytes: 1_048_576,
  maxPageRecords: 1000,
  maxPageAssets: 1000,
  maxAssetBytes: 104_857_600,
  maxPendingAssetBytes: 1_073_741_824,
};
export const defaultTiming = {
  leaseMs: 60_000,
  timeoutMs: 30_000,
  retryMs: 30_000,
  historyLimit: 1000,
  sourceConcurrency: 4,
  deliveryConcurrency: 4,
};
export type Timing = typeof defaultTiming;
export function positive(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail('invalid_positive_integer');
  }
  return value;
}
export function retryDelay(input: {
  attempt: number;
  retryMs: number;
  resultDelay?: number;
}): number {
  const maxBackoff = 3_600_000;
  const maxRequestedDelay = 86_400_000;
  const maxExponent = 10;
  const factor = 2;
  if (input.resultDelay !== undefined) {
    return Math.min(maxRequestedDelay, input.resultDelay);
  }
  return Math.min(maxBackoff, input.retryMs * factor ** Math.min(input.attempt - 1, maxExponent));
}
