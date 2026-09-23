import { abortable } from '../execution/abortable';
import type { Logger } from '../execution/diagnostics';
import { bindProvider, type ProviderGateway } from '../execution/provider';
import { assetKey, type SourceAssets } from '../models/asset';
import { SyncError } from '../models/error';
import { canonicalJson } from '../models/json';
import { retryDelay, type Timing } from '../models/limits';
import type { Registry } from '../models/registry';
import { retryableStatus } from '../models/source-http-error';
import { identifier } from '../models/validation';
import type { AcquisitionLease, AcquisitionRepository } from '../repositories/acquisition/contract';
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
  async execute(input: { lease: AcquisitionLease; signal: AbortSignal }): Promise<void> {
    const { repository, timing } = this.input;
    const { lease } = input;
    try {
      if (!repository.hasCapacity()) {
        this.finish({ lease, state: 'waiting_for_capacity', delay: timing.retryMs });
        return;
      }
      await abortable({ signal: input.signal, run: () => this.consume(input) });
    } catch (error) {
      this.failed({ ...input, error });
    }
  }
  private failed(input: { lease: AcquisitionLease; signal: AbortSignal; error: unknown }): void {
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
      syncId: lease.sync.id,
      fields: {
        ...(error instanceof SyncError ? error.diagnostics : {}),
        ...(status === undefined ? {} : { httpStatus: status }),
        failureCount,
        ...(pause ? { paused: true } : { retryAfterMs: delay }),
      },
    });
    this.finish({
      lease,
      state:
        code === 'waiting_for_capacity'
          ? 'waiting_for_capacity'
          : signal.aborted && code !== 'timed_out'
            ? 'interrupted'
            : 'retrying',
      errorCode: code === 'waiting_for_capacity' ? undefined : code,
      delay,
      failureCount,
      pause,
    });
  }
  private async consume(input: { lease: AcquisitionLease; signal: AbortSignal }): Promise<void> {
    const { repository, registry } = this.input;
    const { lease, signal } = input;
    const entry = registry.definition(lease.sync.definition);
    const provider = await bindProvider({
      actorId: lease.actorId,
      ownerId: lease.ownerId,
      gateway: this.input.gateway,
      connection: lease.sync.connection,
      requirements: entry.definition.provider,
      signal,
    });
    const executable = await entry.load();
    signal.throwIfAborted();
    const page = await executable.step({
      config: lease.sync.config,
      checkpoint: lease.sync.checkpoint,
      syncId: lease.sync.id,
      signal,
      provider,
      assets: sourceAssets({
        repository: this.input.assets,
        files: this.input.files,
        lease,
        signal,
        maxBytes: this.input.maxAssetBytes,
      }),
      log: (event) =>
        this.input.log({
          ...event,
          code: 'definition_log',
          ownerId: lease.ownerId,
          syncId: lease.sync.id,
        }),
    });
    signal.throwIfAborted();
    repository.commit({ lease, page, definition: entry.definition });
  }

  private finish(input: Parameters<AcquisitionRepository['finish']>[0]): void {
    try {
      this.input.repository.finish(input);
    } catch (error) {
      if (!(error instanceof SyncError && error.code === 'lease_lost')) {
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
  lease: AcquisitionLease;
  signal: AbortSignal;
  maxBytes: number;
}): SourceAssets {
  const captures = new Map<
    string,
    {
      metadata: string;
      ref: import('../models/asset').AssetRef;
      pending?: Promise<import('../models/asset').AssetRef>;
    }
  >();
  const stage = ({
    capture,
    unavailable,
  }: {
    capture: import('../models/asset').AssetMetadata;
    unavailable?: string;
  }) => {
    input.signal.throwIfAborted();
    const asset = assetMetadata(capture);
    const metadata = canonicalJson({ ...asset, unavailable: unavailable ?? null }).json;
    const previous = captures.get(assetKey(asset));
    if (previous) {
      if (previous.metadata !== metadata) {
        throw new SyncError({
          code: 'asset_version_conflict',
          message: 'Conflicting asset within one step.',
        });
      }
      return { previous, asset, metadata };
    }
    const id = input.repository.stage({ lease: input.lease, asset, unavailable });
    return { id, asset, metadata };
  };
  return {
    unavailable(capture) {
      identifier(capture.code);
      const result = stage({ capture, unavailable: capture.code });
      if (result.previous) {
        return result.previous.ref;
      }
      const ref = { id: capture.id, version: capture.version };
      captures.set(assetKey(ref), { ref, metadata: result.metadata });
      return ref;
    },
    capture(capture) {
      const result = stage({ capture });
      if (result.previous) {
        return result.previous.pending!;
      }
      const ref = { id: capture.id, version: capture.version };
      const pending = (async () => {
        const body = await capture.read();
        input.signal.throwIfAborted();
        const file = await input.files.write({
          id: result.id!,
          body,
          maxBytes: input.maxBytes,
          signal: input.signal,
          reserve: (reservation) => {
            input.signal.throwIfAborted();
            input.repository.reserve({ lease: input.lease, ...reservation });
          },
        });
        input.signal.throwIfAborted();
        input.repository.captured({ lease: input.lease, ...file });
        return ref;
      })();
      captures.set(assetKey(ref), { ref, metadata: result.metadata, pending });
      return pending;
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
