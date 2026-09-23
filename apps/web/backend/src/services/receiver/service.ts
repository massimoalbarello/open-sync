import type { Deliverable } from '@context-use/open-sync/delivery';
import type { ReceiverRepository, ReceiverScope } from '#backend/repositories/receiver/contract.ts';

export class ReceiverService {
  constructor(private readonly repository: ReceiverRepository) {}
  acceptAsset(input: Parameters<ReceiverRepository['acceptAsset']>[0]) {
    return this.repository.acceptAsset(input);
  }
  record(input: Parameters<ReceiverRepository['record']>[0]) {
    return this.repository.record(input);
  }
  assetInfo(input: ReceiverScope & { id: string }) {
    return this.repository.assetInfo(input);
  }
  asset(input: ReceiverScope & { id: string }) {
    return this.repository.asset(input);
  }
  assets(input: ReceiverScope & { syncId?: string; offset: number }) {
    return this.repository.assets(input);
  }
  isPaused(scope: ReceiverScope) {
    return this.repository.isPaused(scope);
  }
  status(scope: ReceiverScope) {
    return this.repository.status(scope);
  }
  setPaused(input: ReceiverScope & { paused: boolean }) {
    return this.repository.setPaused(input);
  }
  records(input: ReceiverScope & { syncId?: string; offset: number }) {
    return this.repository.records(input);
  }
  accept(input: ReceiverScope & { delivery: Omit<Deliverable, 'openAsset'> }) {
    return this.repository.accept(input);
  }
}
