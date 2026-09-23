import type { Scope } from '@context-use/open-sync';
import type { AssetUpload } from '@context-use/open-sync/assets';
import { assetsFirst } from '@context-use/open-sync/assets/delivery';
import type { Delivery, DestinationType } from '@context-use/open-sync/delivery';

/** Uses only destination contracts, even when the receiver runs in the same process. */
export function localDestination(input: {
  isPaused(scope: Scope): Promise<boolean>;
  accept(input: Scope & { delivery: Delivery }): Promise<boolean>;
  acceptAsset(
    input: AssetUpload & {
      actorId: string;
      ownerId: string;
      syncId: string;
      signal: AbortSignal;
    },
  ): Promise<string>;
}): DestinationType {
  const paused = { status: 'retry' as const, retryAfterMs: 1000, code: 'receiver_paused' };
  const deliver = assetsFirst({
    async upload({ scope, delivery, signal, asset, idempotencyKey, open }) {
      return {
        status: 'accepted',
        reference: await input.acceptAsset({
          ...scope,
          syncId: delivery.syncId,
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
        : paused;
    },
  });
  return {
    name: 'Local SQLite',
    description: 'Stores records and attachments in this application.',
    acceptsAssets: true,
    configSchema: { type: 'object', additionalProperties: false },
    async deliver(context) {
      context.signal.throwIfAborted();
      return (await input.isPaused(context.scope)) ? paused : await deliver(context);
    },
  };
}
