import type { DeliveryResult } from './delivery';
import { fail } from './error';
import { identifier } from './validation';
export function validateResult(result: DeliveryResult): DeliveryResult {
  if (!['accepted', 'retry', 'rejected'].includes(result?.status)) {
    fail('invalid_delivery_result');
  }
  if (result.status !== 'accepted' && result.code !== undefined) {
    identifier(result.code);
  }
  if (result.status === 'rejected' && !result.code) {
    fail('invalid_delivery_result');
  }
  if (
    result.status === 'retry' &&
    result.retryAfterMs !== undefined &&
    (!Number.isSafeInteger(result.retryAfterMs) || result.retryAfterMs < 0)
  ) {
    fail('invalid_delivery_result');
  }
  return result;
}
