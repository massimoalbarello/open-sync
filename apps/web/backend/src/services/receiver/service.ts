import type { DestinationType } from '@context-use/open-sync/delivery';
import { localDestination } from '@open-sync/examples/destinations/local';
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
    return localDestination({
      accept: ({ scope, delivery }) => this.repository.accept({ ...scope, delivery }),
    });
  }
}
