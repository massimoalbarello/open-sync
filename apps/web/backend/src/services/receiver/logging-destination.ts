import type { Delivery, DestinationType } from '@open-sync/core/delivery';

/** Keep the existing durable local receipt, then print for inspection. Retried logs may repeat IDs. */
export function loggingDestination(input: {
  destination: DestinationType;
  log(delivery: Delivery): void;
}): DestinationType {
  return {
    ...input.destination,
    version: `logged-${input.destination.version}`,
    create(context) {
      const receiver = input.destination.create(context);
      return {
        async deliver(attempt) {
          const result = await receiver.deliver(attempt);
          if (result.status === 'accepted') {
            input.log(attempt.delivery);
          }
          return result;
        },
      };
    },
  };
}
