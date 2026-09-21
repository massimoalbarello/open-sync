import type { Scope } from '@context-use/open-sync';
import type { Delivery, DestinationType } from '@context-use/open-sync/delivery';

/** The host owns its database and persists the entire delivery atomically before accepting it. */
export function localDestination(input: {
  accept(input: Scope & { delivery: Delivery }): Promise<boolean>;
}): DestinationType {
  return {
    name: 'Local SQLite',
    description: 'Stores records in this application. Available on the Records page.',
    version: '1',
    configSchema: { type: 'object', additionalProperties: false },
    async deliver(delivery) {
      delivery.signal.throwIfAborted();
      return (await input.accept({ ...delivery.scope, delivery: delivery.delivery }))
        ? { status: 'accepted' }
        : { status: 'retry', retryAfterMs: 1000, code: 'receiver_paused' };
    },
  };
}
