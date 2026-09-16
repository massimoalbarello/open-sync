import type { DeliveryResult } from '../models/delivery';
import { validateResult } from '../models/delivery-result';
import { SyncError } from '../models/error';
import { retryDelay, type Timing } from '../models/limits';
import type { Registry } from '../models/registry';
import type { DeliveryRepository } from '../repositories/delivery/contract';

export class DeliveryService {
  constructor(
    private readonly input: { repository: DeliveryRepository; registry: Registry; timing: Timing },
  ) {}
  async execute(signal: AbortSignal): Promise<void> {
    const { repository, registry, timing } = this.input;
    const lease = repository.claim(timing.leaseMs);
    if (!lease) {
      return;
    }
    let result: DeliveryResult;
    try {
      const type = registry.destination(lease.destination.type);
      if (type.version !== lease.destination.version) {
        result = { status: 'rejected', code: 'destination_unavailable' };
      } else {
        result = validateResult(
          await type
            .create({
              scope: { actorId: lease.actorId, ownerId: lease.ownerId },
              config: structuredClone(lease.destination.config),
            })
            .deliver({ delivery: structuredClone(lease.delivery), signal }),
        );
      }
      signal.throwIfAborted();
    } catch (error) {
      result =
        error instanceof SyncError && error.code === 'destination_unavailable'
          ? { status: 'rejected', code: 'destination_unavailable' }
          : { status: 'retry', code: 'delivery_failed' };
    }
    const delay = retryDelay({
      attempt: lease.attempt,
      retryMs: timing.retryMs,
      resultDelay: result.status === 'retry' ? result.retryAfterMs : undefined,
    });
    try {
      repository.complete({ lease, result, delay });
    } catch (error) {
      if (!(error instanceof SyncError && error.code === 'lease_lost')) {
        throw error;
      }
    }
  }
}
