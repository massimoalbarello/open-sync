import { abortable } from '../execution/abortable';
import type { Logger } from '../execution/diagnostics';
import { bindProvider, type ProviderGateway } from '../execution/provider';
import type { SourceAssets } from '../models/asset';
import { SyncError } from '../models/error';
import { retryDelay, type Timing } from '../models/limits';
import type { Registry } from '../models/registry';
import { retryableStatus } from '../models/source-http-error';
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
  capacityReleased() {
    this.input.repository.capacityReleased();
  }
  nextDue() {
    return this.input.repository.nextDue();
  }
  claim() {
    return this.input.repository.claim(this.input.timing.leaseMs);
  }
  async execute(input: { lease: RunLease; signal: AbortSignal }): Promise<void> {
    const { repository, timing } = this.input;
    const { lease } = input;
    try {
      if (!repository.hasCapacity(lease)) {
        this.finish({ lease, state: 'waiting_for_capacity', delay: timing.retryMs });
        return;
      }
      await abortable({ signal: input.signal, run: () => this.consume(input) });
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
    const status = error instanceof SyncError ? error.status : undefined;
    const pause = !signal.aborted && status !== undefined && !retryableStatus(status);
    const delay = failed
      ? retryDelay({ attempt: failureCount, retryMs: timing.retryMs })
      : timing.retryMs;
    log({
      code,
      ownerId: lease.ownerId,
      installationId: lease.installation.id,
      fields: {
        ...(error instanceof SyncError ? error.diagnostics : {}),
        ...(status === undefined ? {} : { httpStatus: status }),
        failureCount,
        ...(pause ? { paused: true } : { retryAfterMs: delay }),
      },
    });
    this.finish({ lease, state: code, delay, failureCount, pause });
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
    const page = await executable.step({
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
    });
    signal.throwIfAborted();
    repository.commit({ lease, page, definition: entry.definition });
  }

  private finish(input: {
    lease: RunLease;
    state: string;
    delay: number;
    failureCount?: number;
    pause?: boolean;
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
      const { id, version } = capture;
      const asset = assetMetadata(capture);
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
      const { read } = capture;
      const asset = assetMetadata(capture);
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
      let reservedId: string | undefined;
      try {
        const body = await read();
        input.signal.throwIfAborted();
        file = await input.files.write({
          body,
          maxBytes: input.maxBytes,
          reserve(reservation) {
            input.signal.throwIfAborted();
            input.repository.reserve({ lease: input.lease, ...reservation });
            reservedId = reservation.id;
          },
          signal: input.signal,
        });
        input.signal.throwIfAborted();
        input.repository.captured({ lease: input.lease, asset, file });
        return ref;
      } catch (error) {
        if (reservedId) {
          await input.files.remove(reservedId);
        }
        input.signal.throwIfAborted();
        if (reservedId) {
          input.repository.discarded(reservedId);
        }
        captureFailure({
          ...input,
          asset,
          error,
          attempt: previous.attempt,
        });
        return ref;
      }
    },
  };
}

function assetMetadata(input: import('../models/asset').AssetMetadata) {
  return {
    id: input.id,
    version: input.version,
    name: input.name,
    mediaType: input.mediaType,
    ...(input.createdAt !== undefined ? { createdAt: input.createdAt } : {}),
    ...(input.updatedAt !== undefined ? { updatedAt: input.updatedAt } : {}),
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
  if (
    error instanceof SyncError &&
    ['waiting_for_capacity', 'step_exceeds_asset_capacity'].includes(error.code)
  ) {
    input.repository.captureDeferred({ lease: input.lease, asset: input.asset, code: error.code });
    throw error;
  }
  if (error instanceof SyncError && error.status !== undefined) {
    const tooLarge = 413;
    if (error.status === tooLarge) {
      input.repository.captureFailed({
        lease: input.lease,
        asset: input.asset,
        code: 'asset_too_large',
        terminal: true,
      });
      return;
    }
    input.repository.captureDeferred({ lease: input.lease, asset: input.asset, code: error.code });
    throw error;
  }
  const code =
    error instanceof SyncError && error.code === 'asset_too_large'
      ? error.code
      : 'asset_fetch_failed';
  const terminal = code === 'asset_too_large' || input.attempt >= input.attempts;
  input.repository.captureFailed({ lease: input.lease, asset: input.asset, code, terminal });
  if (!terminal) {
    throw new SyncError({
      code: 'asset_fetch_failed',
      message: 'Asset fetch failed.',
      diagnostics: error instanceof SyncError ? error.diagnostics : undefined,
    });
  }
}
