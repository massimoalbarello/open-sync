import type { Logger } from '../execution/diagnostics';
import { bindProvider, type ProviderGateway } from '../execution/provider';
import type { SourceAssets } from '../models/asset';
import { SyncError } from '../models/error';
import { retryDelay, type Timing } from '../models/limits';
import type { Registry } from '../models/registry';
import { identifier } from '../models/validation';
import type { AcquisitionRepository, RunLease } from '../repositories/acquisition/contract';
import type { AssetFiles, AssetRepository } from '../repositories/assets/contract';

export class AcquisitionService {
  constructor(
    private readonly input: {
      repository: AcquisitionRepository;
      assets: AssetRepository;
      files: AssetFiles;
      maxAssetBytes: number;
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
    const { repository, timing } = this.input;
    const { lease } = input;
    try {
      if (!repository.hasCapacity()) {
        this.finish({ lease, state: 'waiting_for_capacity', delay: timing.retryMs });
        return;
      }
      await this.consume(input);
    } catch (error) {
      this.failed({ ...input, error });
    }
  }
  private failed(input: { lease: RunLease; signal: AbortSignal; error: unknown }): void {
    const { timing, log } = this.input;
    const { lease, signal, error } = input;
    const code = signal.aborted
      ? abortCode(signal)
      : error instanceof SyncError
        ? error.code
        : 'execution_failed';
    const failed = !['paused', 'interrupted', 'waiting_for_capacity'].includes(code);
    const failureCount = failed ? lease.failureCount + 1 : lease.failureCount;
    const cooldown = error instanceof SyncError ? error.retryAfterMs : undefined;
    const delay = failed
      ? Math.max(retryDelay({ attempt: failureCount, retryMs: timing.retryMs }), cooldown ?? 0)
      : timing.retryMs;
    log({
      code,
      ownerId: lease.ownerId,
      installationId: lease.installation.id,
      fields: {
        ...(error instanceof SyncError ? error.diagnostics : {}),
        failureCount,
        retryAfterMs: delay,
      },
    });
    this.finish({ lease, state: code, delay, failureCount });
  }
  private async consume(input: { lease: RunLease; signal: AbortSignal }): Promise<void> {
    const { repository, registry, timing } = this.input;
    const { lease, signal } = input;
    // Leave a quarter of the hard deadline for the final page and iterator cleanup.
    const workBudgetFraction = 0.75;
    const yieldAt = performance.now() + timing.timeoutMs * workBudgetFraction;
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
      assets: sourceAssets({
        repository: this.input.assets,
        files: this.input.files,
        lease,
        signal,
        maxBytes: this.input.maxAssetBytes,
        attempts: timing.assetAttempts,
      }),
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
      if (pages >= timing.maxPages || performance.now() >= yieldAt) {
        this.finish({ lease, state: 'yielded', delay: 0, failureCount: 0 });
        return;
      }
    }
    throw new SyncError({
      code: 'incomplete_run',
      message: 'Definition ended without a complete page.',
    });
  }
  private finish(input: {
    lease: RunLease;
    state: string;
    delay: number;
    failureCount?: number;
  }): void {
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

function abortCode(signal: AbortSignal): string {
  if (signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError') {
    return 'timed_out';
  }
  return signal.reason === 'paused' ? 'paused' : 'interrupted';
}

function sourceAssets(input: {
  repository: AssetRepository;
  files: AssetFiles;
  lease: RunLease;
  signal: AbortSignal;
  maxBytes: number;
  attempts: number;
}): SourceAssets {
  return {
    unavailable(capture) {
      input.signal.throwIfAborted();
      identifier(capture.code);
      const { id, version, name, mediaType } = capture;
      const asset = { id, version, name, mediaType };
      const previous = input.repository.capture({ lease: input.lease, asset });
      if (previous.state === 'pending') {
        input.repository.captureFailed({
          lease: input.lease,
          asset,
          code: capture.code,
          terminal: true,
        });
      }
      return { id, version };
    },
    async capture(capture) {
      input.signal.throwIfAborted();
      const { read, id, version, name, mediaType } = capture;
      const asset = { id, version, name, mediaType };
      const ref = { id: asset.id, version: asset.version };
      const previous = input.repository.capture({ lease: input.lease, asset });
      if (previous.state !== 'pending') {
        return ref;
      }
      if (previous.attempt > input.attempts) {
        input.repository.captureFailed({
          lease: input.lease,
          asset,
          code: 'asset_fetch_exhausted',
          terminal: true,
        });
        return ref;
      }
      let file: Awaited<ReturnType<AssetFiles['write']>> | undefined;
      const availableBytes = input.repository.availableBytes();
      try {
        const body = await read();
        input.signal.throwIfAborted();
        file = await input.files.write({
          body,
          maxBytes: Math.min(input.maxBytes, availableBytes),
          signal: input.signal,
        });
        input.signal.throwIfAborted();
        input.repository.captured({ lease: input.lease, asset, file });
        return ref;
      } catch (error) {
        if (file) {
          await input.files.remove(file.id);
        }
        input.signal.throwIfAborted();
        captureFailure({
          ...input,
          asset,
          error:
            error instanceof SyncError &&
            error.code === 'asset_too_large' &&
            availableBytes < input.maxBytes
              ? new SyncError({ code: 'asset_storage_full', message: 'Asset storage is full.' })
              : error,
          attempt: previous.attempt,
        });
        return ref;
      }
    },
  };
}

function captureFailure(input: {
  repository: AssetRepository;
  lease: RunLease;
  asset: import('../models/asset').AssetMetadata;
  error: unknown;
  attempt: number;
  attempts: number;
}) {
  const { error } = input;
  if (
    error instanceof SyncError &&
    ['lease_lost', 'checkpoint_conflict', 'asset_version_conflict'].includes(error.code)
  ) {
    throw error;
  }
  const code =
    error instanceof SyncError &&
    ['asset_too_large', 'asset_storage_full', 'waiting_for_asset_capacity'].includes(error.code)
      ? error.code === 'waiting_for_asset_capacity'
        ? 'asset_storage_full'
        : error.code
      : 'asset_fetch_failed';
  const terminal = code === 'asset_too_large' || input.attempt >= input.attempts;
  input.repository.captureFailed({ lease: input.lease, asset: input.asset, code, terminal });
  if (!terminal) {
    throw new SyncError({
      code: 'asset_fetch_failed',
      message: 'Asset fetch failed.',
      diagnostics: error instanceof SyncError ? error.diagnostics : undefined,
      retryAfterMs: error instanceof SyncError ? error.retryAfterMs : undefined,
    });
  }
}
