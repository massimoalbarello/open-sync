import { abortable } from '../execution/abortable';
import type { DeliveryResult } from '../models/delivery';
import { validateResult } from '../models/delivery-result';
import { SyncError } from '../models/error';
import { retryDelay, type Timing } from '../models/limits';
import type { Registry } from '../models/registry';
import type { AssetFiles, AssetRepository } from '../repositories/assets/contract';
import type { DeliveryLease, DeliveryRepository } from '../repositories/delivery/contract';

export class DeliveryService {
  constructor(
    private readonly input: {
      repository: DeliveryRepository;
      registry: Registry;
      timing: Timing;
      assets: AssetRepository;
      files: AssetFiles;
    },
  ) {}
  claim() {
    return this.input.repository.claim(this.input.timing.leaseMs);
  }
  nextDue() {
    return this.input.repository.nextDue();
  }
  async execute(input: { lease: DeliveryLease; signal: AbortSignal }): Promise<boolean> {
    const { repository, registry, timing } = this.input;
    const { lease, signal } = input;
    let result: DeliveryResult;
    try {
      const type = registry.destination(lease.destination.type);
      result = validateResult(
        await abortable({
          signal,
          run: () =>
            type.deliver({
              scope: { actorId: lease.actorId, ownerId: lease.ownerId },
              config: structuredClone(lease.destination.config),
              deliverable: {
                ...structuredClone(lease.delivery),
                openAsset: async (asset) => {
                  signal.throwIfAborted();
                  const id = this.input.assets.read({ lease, asset });
                  return await this.input.files.open(id);
                },
              },
              signal,
            }),
        }),
      );
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
      return result.status === 'accepted';
    } catch (error) {
      if (!(error instanceof SyncError && error.code === 'lease_lost')) {
        throw error;
      }
      return false;
    }
  }
}
