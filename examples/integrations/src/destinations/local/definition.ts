import type { Scope } from '@context-use/open-sync';
import { type AssetOutcome, assetKey, type DeliveryAsset } from '@context-use/open-sync/assets';
import { resolveRecordAssets } from '@context-use/open-sync/assets/references';
import type { Deliverable, DestinationType } from '@context-use/open-sync/delivery';

/** The receiver owns upload idempotency and the durable representation of resolved records. */
export function localDestination(input: {
  isPaused(scope: Scope): Promise<boolean>;
  accept(input: Scope & { delivery: Omit<Deliverable, 'openAsset'> }): Promise<boolean>;
  acceptAsset(
    input: Scope & {
      asset: DeliveryAsset;

      open(): Promise<ReadableStream<Uint8Array>>;
      syncId: string;
      signal: AbortSignal;
    },
  ): Promise<string>;
}): DestinationType {
  const paused = { status: 'retry' as const, retryAfterMs: 1000, code: 'receiver_paused' };
  return {
    name: 'Local SQLite',
    description: 'Stores records and attachments in this application.',
    configSchema: { type: 'object', additionalProperties: false },
    async deliver({ scope, deliverable, signal }) {
      signal.throwIfAborted();
      if (await input.isPaused(scope)) {
        return paused;
      }
      const outcomes = new Map<string, AssetOutcome>();
      for (const asset of deliverable.assets) {
        signal.throwIfAborted();
        outcomes.set(
          assetKey(asset),
          'unavailable' in asset
            ? { status: 'failed', code: asset.unavailable }
            : {
                status: 'accepted',
                reference: await input.acceptAsset({
                  ...scope,
                  syncId: deliverable.syncId,
                  signal,
                  asset,

                  open: () => deliverable.openAsset(asset),
                }),
              },
        );
      }
      const { openAsset: _, ...delivery } = deliverable;
      delivery.records = deliverable.records.map((record) =>
        resolveRecordAssets({
          record,
          assets: deliverable.assets,
          outcomes,
          rendering: {
            structured: ({ outcome }) =>
              outcome.status === 'accepted'
                ? outcome.reference
                : { status: 'failed', code: outcome.code },
            markdown: ({ asset, outcome }) =>
              outcome.status === 'accepted'
                ? `/api/receiver/assets/${encodeURIComponent(outcome.reference)}`
                : `Attachment unavailable: ${asset.name}`,
          },
        }),
      );
      signal.throwIfAborted();
      return (await input.accept({ ...scope, delivery })) ? { status: 'accepted' } : paused;
    },
  };
}
