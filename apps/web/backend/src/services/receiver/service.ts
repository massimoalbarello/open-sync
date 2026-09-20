import type { DestinationType } from '@context-use/open-sync/delivery';
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
  accept(input: Parameters<DestinationType['deliver']>[0]) {
    return this.repository.accept({ ...input.scope, delivery: input.delivery });
  }
}
