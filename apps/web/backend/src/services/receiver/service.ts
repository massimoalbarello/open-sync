import type { ReceiverRepository } from '#backend/repositories/receiver/contract.ts';

export class ReceiverService {
  constructor(private readonly repository: ReceiverRepository) {}
  deliverables(input: Parameters<ReceiverRepository['deliverables']>[0]) {
    return this.repository.deliverables(input);
  }
  deliverable(input: Parameters<ReceiverRepository['deliverable']>[0]) {
    return this.repository.deliverable(input);
  }
  asset(input: Parameters<ReceiverRepository['asset']>[0]) {
    return this.repository.asset(input);
  }
  accept(input: Parameters<ReceiverRepository['accept']>[0]) {
    return this.repository.accept(input);
  }
}
