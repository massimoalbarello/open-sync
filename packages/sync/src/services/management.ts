import { bindProvider, type ProviderGateway } from '../execution/provider';
import type { WorkerControl } from '../execution/worker';
import type { ConnectionRef } from '../models/definition';
import { fail } from '../models/error';
import type { Resource, Scope } from '../models/identity';
import type { JsonObject } from '../models/json';
import { positive, type QueueLimits } from '../models/limits';
import type { Registry } from '../models/registry';
import { type CreateSync, summarizeSync } from '../models/sync';
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
    return this.input.registry
      .definitions()
      .map(({ id, name, description, configSchema, provider }) => ({
        id,
        name,
        description,
        configSchema,
        provider,
      }));
  }
  destinationTypes(scope: Scope) {
    this.guard(scope);
    return this.input.registry.destinationTypes();
  }
  private async prepareDestination(input: Scope & { destination: CreateSync['destination'] }) {
    const scope = { actorId: input.actorId, ownerId: input.ownerId };
    const type = this.input.registry.destination(input.destination.type);
    const values = validate({
      value: input.destination.input,
      schema: type.setup?.schema ?? type.configSchema,
    }) as JsonObject;
    let prepared = values;
    if (type.setup) {
      try {
        prepared = await type.setup.prepare({ scope: { ...scope }, input: values });
      } catch {
        fail('destination_setup_failed');
      }
    }
    this.guard(scope);
    const config = validate({ value: prepared, schema: type.configSchema }) as JsonObject;
    return { type: input.destination.type, config };
  }
  async createSync(input: CreateSync) {
    this.guard(input);
    const { definition } = this.input.registry.definition(input.definition);
    const config = validate({ value: input.config, schema: definition.configSchema }) as JsonObject;
    if (input.intervalMs !== undefined) {
      positive(input.intervalMs);
    }
    if (definition.provider && (input.connection || input.enabled !== false)) {
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
    const destination = await this.prepareDestination(input);
    const sync = this.input.catalog.createSync({
      ...input,
      config,
      destination,
      initialCheckpoint: definition.initialCheckpoint,
    });
    this.input.worker.wake();
    return summarizeSync(sync);
  }
  syncs(scope: Scope) {
    this.guard(scope);
    return this.input.catalog.syncs(scope).map(summarizeSync);
  }
  sync(input: Resource) {
    this.guard(input);
    return summarizeSync(this.input.catalog.sync(input));
  }
  /** Latest 20 polling iterations, newest first, including the current scan. */
  polls(input: Resource) {
    this.guard(input);
    return this.input.catalog.polls(input);
  }
  async connectSync(input: Resource & { connection: ConnectionRef }) {
    this.guard(input);
    const sync = this.input.catalog.sync(input);
    if (sync.connection || sync.enabled) {
      fail('already_connected');
    }
    const { definition } = this.input.registry.definition(sync.definition);
    if (!definition.provider) {
      fail('unexpected_connection');
    }
    await bindProvider({
      ...input,
      requirements: definition.provider,
      gateway: this.input.gateway,
      signal: AbortSignal.timeout(this.input.timeoutMs),
    });
    this.guard(input);
    const connected = this.input.catalog.connectSync(input);
    this.input.worker.wake();
    return summarizeSync(connected);
  }
  async setEnabled(input: Resource & { enabled: boolean }) {
    this.guard(input);
    const sync = this.input.catalog.sync(input);
    if (sync.enabled === input.enabled) {
      return summarizeSync(sync);
    }
    if (input.enabled && !sync.connection) {
      const { definition } = this.input.registry.definition(sync.definition);
      if (definition.provider) {
        fail('connection_required');
      }
    }
    const result = this.input.catalog.setEnabled(input);
    await this.input.worker.cancelAcquisition(input);
    return summarizeSync(result);
  }
  runNow(input: Resource): void {
    this.guard(input);
    this.input.catalog.runNow(input);
    this.input.worker.wake();
  }
  async resync(input: Resource): Promise<void> {
    this.guard(input);
    const sync = this.input.catalog.sync(input);
    const { definition } = this.input.registry.definition(sync.definition);
    this.input.catalog.resync({ ...input, checkpoint: definition.initialCheckpoint });
    await this.input.worker.cancelAcquisition(input);
  }
  async removeSync(input: Resource): Promise<void> {
    this.guard(input);
    this.input.catalog.removeSync(input);
    await this.input.worker.cancelSync(input);
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
    this.input.worker.wake();
  }
}
