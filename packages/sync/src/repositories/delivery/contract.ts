import type {
  Delivery,
  DeliveryPage,
  DeliveryResult,
  Destination,
  QueueStatus,
} from '../../models/delivery';
import type { Resource, Scope } from '../../models/identity';

export interface DeliveryLease extends Scope {
  delivery: Delivery;
  destination: Destination;
  workerId: string;
  generation: number;
  attempt: number;
}
export interface DeliveryRepository {
  claim(leaseMs: number): DeliveryLease | undefined;
  complete(input: { lease: DeliveryLease; result: DeliveryResult; delay: number }): void;
  status(scope: Scope): QueueStatus;
  pending(input: Scope & { offset: number }): DeliveryPage;
  retry(input: Resource): void;
}
