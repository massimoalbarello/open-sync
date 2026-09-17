import type { DestinationType } from '@open-sync/core/delivery';
import type { ReceiverRepository, ReceiverScope } from '#backend/repositories/receiver/contract.ts';

export class ReceiverService {
  constructor(private readonly repository: ReceiverRepository) {}
  status(scope: ReceiverScope) {
    return this.repository.status(scope);
  }
  setPaused(input: ReceiverScope & { paused: boolean }) {
    return this.repository.setPaused(input);
  }
  records(input: ReceiverScope & { sourceId?: string; offset: number }) {
    return this.repository.records(input);
  }
  destination(): DestinationType {
    return {
      name: 'Local SQLite',
      description:
        'Stores each record as JSON in this application. Accepts all record kinds and schemas.',
      version: '1',
      configSchema: { type: 'object', additionalProperties: false },
      deliver: async ({ scope, delivery, signal }) => {
        signal.throwIfAborted();
        const accepted = await this.repository.accept({ ...scope, delivery });
        return accepted
          ? { status: 'accepted' }
          : { status: 'retry', retryAfterMs: 1000, code: 'receiver_paused' };
      },
    };
  }
}
