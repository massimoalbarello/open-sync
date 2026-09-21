import type { Scope } from '@context-use/open-sync';
import type { AssetUpload } from '@context-use/open-sync/assets';
import { assetsFirst } from '@context-use/open-sync/assets/delivery';
import type { Delivery, DestinationType } from '@context-use/open-sync/delivery';

/** Uses only destination contracts, even when the receiver runs in the same process. */
export function localDestination(input: {
  accept(input: Scope & { delivery: Delivery }): Promise<boolean>;
  acceptAsset(
    input: AssetUpload & {
      actorId: string;
      ownerId: string;
      sourceId: string;
      signal: AbortSignal;
    },
  ): Promise<string>;
}): DestinationType {
  return {
    name: 'Local SQLite',
    description: 'Stores records and attachments in this application.',
    version: '1',
    acceptsAssets: true,
    configSchema: { type: 'object', additionalProperties: false },
    deliver: assetsFirst({
      async upload({ scope, delivery, signal, asset, idempotencyKey, open }) {
        return {
          status: 'accepted',
          reference: await input.acceptAsset({
            ...scope,
            sourceId: delivery.sourceId,
            signal,
            asset,
            idempotencyKey,
            open,
          }),
        };
      },
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
      async deliver(delivery) {
        delivery.signal.throwIfAborted();
        return (await input.accept({ ...delivery.scope, delivery: delivery.delivery }))
          ? { status: 'accepted' }
          : { status: 'retry', retryAfterMs: 1000, code: 'receiver_paused' };
      },
    }),
  };
}
