import {
  type AssetOutcome,
  type AssetRendering,
  type AssetResult,
  type AssetUpload,
  assetKey,
} from '../models/asset';
import { resolveRecordAssets } from '../models/asset-references';
import type { DestinationType } from '../models/delivery';
import { fail } from '../models/error';

type Input = Parameters<DestinationType['deliver']>[0];
/** Optional strategy for destinations with separate uploads. Bundle destinations implement deliver directly. */
export function assetsFirst(input: {
  upload(input: Input & AssetUpload): Promise<AssetResult>;
  rendering: AssetRendering;
  deliver(input: Input): ReturnType<DestinationType['deliver']>;
}): DestinationType['deliver'] {
  return async (context) => {
    if (!context.delivery.deliverable.assets?.length) {
      return await input.deliver(context);
    }
    const assets = context.assets;
    if (!assets) {
      return fail('asset_delivery_context_required');
    }
    const outcomes = new Map<string, AssetOutcome>();
    for (const asset of context.delivery.deliverable.assets ?? []) {
      const outcome = await assets.transfer({
        asset,
        upload: (upload) => input.upload({ ...context, ...upload }),
      });
      if (outcome.status === 'retry' || outcome.status === 'rejected') {
        return outcome;
      }
      outcomes.set(assetKey(asset), outcome);
    }
    const delivery = assets.materialize(() => ({
      ...context.delivery,
      deliverable: {
        ...context.delivery.deliverable,
        records: context.delivery.deliverable.records.map((record) =>
          resolveRecordAssets({
            record,
            assets: context.delivery.deliverable.assets ?? [],
            outcomes,
            rendering: input.rendering,
          }),
        ),
      },
    }));
    return await input.deliver({ ...context, delivery });
  };
}
