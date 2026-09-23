import { abortable } from '../execution/abortable';
import type { AssetOutcome, AssetResult, DestinationAssets } from '../models/asset';
import type { DeliveryResult } from '../models/delivery';
import { validateResult } from '../models/delivery-result';
import { fail, SyncError } from '../models/error';
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
      if (lease.delivery.version === 2 && !type.acceptsAssets) {
        result = { status: 'rejected', code: 'destination_assets_unsupported' };
      } else {
        result = validateResult(
          await abortable({
            signal,
            run: () =>
              type.deliver({
                scope: { actorId: lease.actorId, ownerId: lease.ownerId },
                config: structuredClone(lease.destination.config),
                delivery: structuredClone(lease.delivery),
                signal,
                assets: destinationAssets({
                  repository: this.input.assets,
                  files: this.input.files,
                  lease,
                  signal,
                  attempts: timing.assetAttempts,
                }),
              }),
          }),
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
      return result.status === 'accepted';
    } catch (error) {
      if (!(error instanceof SyncError && error.code === 'lease_lost')) {
        throw error;
      }
      return false;
    }
  }
}

function destinationAssets(input: {
  repository: AssetRepository;
  files: AssetFiles;
  lease: DeliveryLease;
  signal: AbortSignal;
  attempts: number;
}): DestinationAssets {
  const open: DestinationAssets['open'] = async (asset) => {
    input.signal.throwIfAborted();
    const stored = input.repository.read({ lease: input.lease, asset });
    if (!stored.fileId) {
      fail('asset_content_missing');
    }
    return await input.files.open(stored.fileId!);
  };
  return {
    open,
    materialize: (build) => {
      input.signal.throwIfAborted();
      return input.repository.materialize({ lease: input.lease, build });
    },
    async transfer({ asset, upload }) {
      input.signal.throwIfAborted();
      const receipt = input.repository.receipt({ lease: input.lease, asset });
      if (receipt.outcome) {
        return receipt.outcome;
      }
      const stored = input.repository.read({ lease: input.lease, asset });
      let result: AssetResult;
      if (receipt.attempt > input.attempts) {
        result = { status: 'rejected', code: 'asset_delivery_exhausted' };
      } else if ('unavailable' in stored.asset) {
        result = { status: 'rejected', code: stored.asset.unavailable };
      } else {
        try {
          result = await upload({
            asset: stored.asset,
            idempotencyKey: receipt.key,
            open: () => open(asset),
          });
          input.signal.throwIfAborted();
          validateAssetResult(result);
        } catch {
          // A cancelled attempt may have reached the destination. Retry its stable identity.
          result = { status: 'retry', code: 'asset_delivery_failed' };
        }
      }
      const outcome = terminalOutcome({
        result,
        attempt: receipt.attempt,
        maxAttempts: input.attempts,
      });
      if (!outcome) {
        return result as Exclude<AssetResult, { status: 'accepted' }>;
      }
      input.signal.throwIfAborted();
      input.repository.recordOutcome({ lease: input.lease, asset, outcome });
      return outcome;
    },
  };
}
function validateAssetResult(result: AssetResult): void {
  validateResult(result);
  const maxReferenceBytes = 4096;
  if (
    result.status === 'accepted' &&
    (typeof result.reference !== 'string' ||
      !result.reference ||
      Buffer.byteLength(result.reference) > maxReferenceBytes)
  ) {
    fail('invalid_asset_reference');
  }
}

function terminalOutcome(input: {
  result: AssetResult;
  attempt: number;
  maxAttempts: number;
}): AssetOutcome | undefined {
  const { result } = input;
  if (result.status === 'accepted') {
    return { status: 'accepted', reference: result.reference };
  }
  if (result.status === 'rejected' || input.attempt >= input.maxAttempts) {
    return { status: 'failed', code: result.code ?? 'asset_delivery_failed' };
  }
}
