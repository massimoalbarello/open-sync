import type { Logger } from '../execution/diagnostics';
import { bindProvider, type ProviderGateway } from '../execution/provider';
import { SyncError } from '../models/error';
import type { Timing } from '../models/limits';
import type { Registry } from '../models/registry';
import type { AcquisitionRepository, RunLease } from '../repositories/acquisition/contract';

export class AcquisitionService {
  constructor(
    private readonly input: {
      repository: AcquisitionRepository;
      registry: Registry;
      gateway?: ProviderGateway;
      timing: Timing;
      log: Logger;
    },
  ) {}
  claim() {
    return this.input.repository.claim(this.input.timing.leaseMs);
  }
  async execute(input: { lease: RunLease; signal: AbortSignal }): Promise<void> {
    const { repository, timing, log } = this.input;
    const { lease, signal } = input;
    try {
      if (!repository.hasCapacity()) {
        this.finish({ lease, state: 'waiting_for_capacity', delay: timing.retryMs });
        return;
      }
      await this.consume(input);
    } catch (error) {
      const code = signal.aborted
        ? 'cancelled'
        : error instanceof SyncError
          ? error.code
          : 'execution_failed';
      log({ code, ownerId: lease.ownerId, installationId: lease.installation.id });
      this.finish({ lease, state: code, delay: timing.retryMs });
    }
  }
  private async consume(input: { lease: RunLease; signal: AbortSignal }): Promise<void> {
    const { repository, registry, timing } = this.input;
    const { lease, signal } = input;
    const entry = registry.definition(lease.installation.definition);
    const provider = await bindProvider({
      actorId: lease.actorId,
      ownerId: lease.ownerId,
      gateway: this.input.gateway,
      connection: lease.installation.connection,
      requirements: entry.definition.provider,
      signal,
    });
    const executable = await entry.load();
    signal.throwIfAborted();
    let pages = 0;
    for await (const page of executable.run({
      config: lease.installation.config,
      checkpoint: lease.installation.checkpoint,
      sourceId: lease.installation.sourceId,
      signal,
      provider,
      log: (event) =>
        this.input.log({
          ...event,
          code: 'definition_log',
          ownerId: lease.ownerId,
          installationId: lease.installation.id,
        }),
    })) {
      signal.throwIfAborted();
      repository.commit({ lease, page, definition: entry.definition });
      pages++;
      if (page.complete) {
        return;
      }
      if (!repository.hasCapacity()) {
        this.finish({ lease, state: 'waiting_for_capacity', delay: timing.retryMs });
        return;
      }
      if (pages >= timing.maxPages) {
        this.finish({ lease, state: 'yielded', delay: 0 });
        return;
      }
    }
    throw new SyncError({
      code: 'incomplete_run',
      message: 'Definition ended without a complete page.',
    });
  }
  private finish(input: { lease: RunLease; state: string; delay: number }): void {
    try {
      this.input.repository.finish(input);
    } catch (error) {
      if (
        !(error instanceof SyncError && ['lease_lost', 'checkpoint_conflict'].includes(error.code))
      ) {
        throw error;
      }
    }
  }
}
