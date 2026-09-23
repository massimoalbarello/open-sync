import type { Deliverable, DeliveryPage, DeliveryResult, QueueStatus } from '../../models/delivery';
import type { Resource, Scope } from '../../models/identity';
import type { Sync } from '../../models/sync';

export interface DeliveryLease extends Scope {
  delivery: Omit<Deliverable, 'openAsset'>;
  destination: Sync['destination'];
  generation: number;
  attempt: number;
}
export interface DeliveryRepository {
  nextDue(): number | undefined;
  claim(leaseMs: number): DeliveryLease | undefined;
  complete(input: { lease: DeliveryLease; result: DeliveryResult; delay: number }): void;
  status(scope: Scope): QueueStatus;
  pending(input: Scope & { offset: number }): DeliveryPage;
  retry(input: Resource): void;
}
