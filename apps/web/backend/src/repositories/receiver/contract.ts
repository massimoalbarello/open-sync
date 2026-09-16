import type { Delivery } from '@open-sync/core/delivery';
export interface ReceiverScope {
  actorId: string;
  ownerId: string;
}
export interface ReceiverStatus {
  paused: boolean;
  records: number;
  receipts: number;
}
export interface ReceiverRepository {
  status(scope: ReceiverScope): Promise<ReceiverStatus>;
  setPaused(input: ReceiverScope & { paused: boolean }): Promise<void>;
  accept(input: ReceiverScope & { delivery: Delivery }): Promise<boolean>;
}
