import { bindProvider, type ProviderGateway } from '../execution/provider';
import type { WorkerControl } from '../execution/worker';
import { fail } from '../models/error';
import type { Resource, Scope } from '../models/identity';
import type { CreateInstallation } from '../models/installation';
import type { JsonObject } from '../models/json';
import { positive, type QueueLimits } from '../models/limits';
import type { Registry } from '../models/registry';
import { identifier, validate } from '../models/validation';
import type { CatalogRepository } from '../repositories/catalog/contract';
import type { DeliveryRepository } from '../repositories/delivery/contract';

export class SyncManagement {
  constructor(
    private readonly input: {
      catalog: CatalogRepository;
      deliveries: DeliveryRepository;
      registry: Registry;
      worker: WorkerControl;
      gateway?: ProviderGateway;
      limits: QueueLimits;
      timeoutMs: number;
    },
  ) {}
  private guard(scope: Scope): void {
    this.input.worker.ensureOpen();
    identifier(scope.actorId);
    identifier(scope.ownerId);
  }
  definitions(scope: Scope) {
    this.guard(scope);
    return this.input.registry.definitions();
  }
  destinationTypes(scope: Scope) {
    this.guard(scope);
    return this.input.registry.destinationTypes();
  }
  runs(input: Resource & { offset?: number }) {
    this.guard(input);
    const offset = input.offset ?? 0;
    positive(offset + 1);
    return this.input.catalog.runs({ ...input, offset });
  }
  destinations(scope: Scope) {
    this.guard(scope);
    return this.input.catalog
      .destinations(scope)
      .map(({ id, type, version }) => ({ id, type, version }));
  }
  createDestination(input: Scope & { type: string; config: JsonObject }) {
    this.guard(input);
    const type = this.input.registry.destination(input.type);
    const config = validate({ value: input.config, schema: type.configSchema }) as JsonObject;
    const { id, version } = this.input.catalog.createDestination({
      ...input,
      config,
      version: type.version,
    });
    return { id, type: input.type, version };
  }
  async createInstallation(input: CreateInstallation) {
    this.guard(input);
    const { definition } = this.input.registry.definition(input.definition);
    const config = validate({ value: input.config, schema: definition.configSchema }) as JsonObject;
    if (input.intervalMs !== undefined) {
      positive(input.intervalMs);
    }
    if (definition.provider) {
      await bindProvider({
        actorId: input.actorId,
        ownerId: input.ownerId,
        connection: input.connection,
        requirements: definition.provider,
        gateway: this.input.gateway,
        signal: AbortSignal.timeout(this.input.timeoutMs),
      });
    } else if (input.connection) {
      fail('unexpected_connection');
    }
    this.guard(input);
    return this.input.catalog.createInstallation({
      ...input,
      config,
      initialCheckpoint: definition.initialCheckpoint,
    });
  }
  installations(scope: Scope) {
    this.guard(scope);
    return this.input.catalog.installations(scope);
  }
  installation(input: Resource) {
    this.guard(input);
    return this.input.catalog.installation(input);
  }
  async setEnabled(input: Resource & { enabled: boolean }) {
    this.guard(input);
    const result = this.input.catalog.setEnabled(input);
    await this.input.worker.cancel(input);
    return result;
  }
  queueRun(input: Resource & { backfill?: boolean }): void {
    this.guard(input);
    const installation = this.input.catalog.installation(input);
    const { definition } = this.input.registry.definition(installation.definition);
    this.input.catalog.queue({
      ...input,
      checkpoint: input.backfill ? definition.initialCheckpoint : undefined,
    });
  }
  status(scope: Scope) {
    this.guard(scope);
    return { queue: this.input.deliveries.status(scope), limits: { ...this.input.limits } };
  }
  deliveries(input: Scope & { offset?: number }) {
    this.guard(input);
    const offset = input.offset ?? 0;
    positive(offset + 1);
    return this.input.deliveries.pending({ ...input, offset });
  }
  retryDelivery(input: Resource): void {
    this.guard(input);
    this.input.deliveries.retry(input);
  }
}
