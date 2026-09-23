import { fail } from '../models/error';
import type { Resource } from '../models/identity';
import type { Timing } from '../models/limits';
import type { AcquisitionService } from '../services/acquisition';
import type { DeliveryService } from '../services/delivery';
import type { Logger } from './diagnostics';

export interface WorkerControl {
  ensureOpen(): void;
  wake(): void;
  cancel(input: Resource): Promise<void>;
}
export class Worker implements WorkerControl {
  readonly #lifetime = new AbortController();
  #timer?: ReturnType<typeof setTimeout>;
  #started = false;
  readonly #acquisitions = new Map<string, { abort: AbortController; task: Promise<void> }>();
  readonly #deliveries = new Set<Promise<void>>();
  #cleaning?: Promise<void>;
  #cleanupRequested = false;
  #capacityReleased = false;
  #cleanupTimer?: ReturnType<typeof setTimeout>;
  #closing?: Promise<void>;
  constructor(
    private readonly input: {
      acquisition: AcquisitionService;
      delivery: DeliveryService;
      timing: Timing;
      log: Logger;
      cleanup(): Promise<void>;
    },
  ) {}
  ensureOpen(): void {
    if (this.#lifetime.signal.aborted) {
      fail('closed');
    }
  }
  start(): void {
    this.ensureOpen();
    if (this.#started) {
      return;
    }
    this.#started = true;
    this.completed();
  }
  wake(): void {
    this.schedule(0);
  }
  private schedule(delay: number): void {
    if (!this.#started || this.#lifetime.signal.aborted) {
      return;
    }
    clearTimeout(this.#timer);
    // Yield to the event loop even when another step is immediately runnable.
    const maxTimerDelay = 2_147_483_647;
    this.#timer = setTimeout(
      () => {
        this.#timer = undefined;
        try {
          this.dispatch();
        } catch {
          this.input.log({ code: 'runtime_failed' });
          this.schedule(this.input.timing.retryMs);
        }
      },
      Math.min(delay, maxTimerDelay),
    );
  }
  /** A deterministic dispatch round for hosts/tests that do not start the background worker. */
  tick(): Promise<void> {
    this.ensureOpen();
    this.dispatch();
    return Promise.all([
      ...[...this.#acquisitions.values()].map(({ task }) => task),
      ...this.#deliveries,
    ]).then(() => this.cleanup());
  }
  private dispatch(): void {
    this.ensureOpen();
    const { acquisition, delivery, timing } = this.input;
    while (this.#acquisitions.size < timing.sourceConcurrency) {
      const lease = acquisition.claim();
      if (!lease) {
        break;
      }
      const key = resourceKey({ ...lease, id: lease.sync.id });
      const abort = new AbortController();
      const task = acquisition
        .execute({ lease, signal: this.signal(abort.signal) })
        .catch(() => this.input.log({ code: 'acquisition_failed' }))
        .finally(() => {
          this.#acquisitions.delete(key);
          this.completed();
        });
      this.#acquisitions.set(key, { abort, task });
    }
    while (this.#deliveries.size < timing.deliveryConcurrency) {
      const lease = delivery.claim();
      if (!lease) {
        break;
      }
      const task = delivery
        .execute({ lease, signal: this.signal() })
        .then((accepted) => {
          this.#capacityReleased ||= accepted;
        })
        .catch(() => this.input.log({ code: 'delivery_failed' }))
        .finally(() => {
          this.#deliveries.delete(task);
          this.completed();
        });
      this.#deliveries.add(task);
    }
    const due = [
      this.#acquisitions.size < timing.sourceConcurrency ? acquisition.nextDue() : undefined,
      this.#deliveries.size < timing.deliveryConcurrency ? delivery.nextDue() : undefined,
    ].filter((value): value is number => value !== undefined);
    if (due.length) {
      this.schedule(Math.max(0, Math.min(...due) - Date.now()));
    }
  }
  private completed(): void {
    this.wake();
    if (this.#started) {
      void this.cleanup().then(
        () => this.wake(),
        () => {
          this.input.log({ code: 'cleanup_failed' });
          if (!this.#lifetime.signal.aborted && !this.#cleanupTimer) {
            this.#cleanupTimer = setTimeout(() => {
              this.#cleanupTimer = undefined;
              this.completed();
            }, this.input.timing.retryMs);
          }
        },
      );
    }
  }
  private cleanup(): Promise<void> {
    this.#cleanupRequested = true;
    this.#cleaning ??= Promise.resolve().then(() => this.drainCleanup());
    return this.#cleaning;
  }
  private async drainCleanup(): Promise<void> {
    try {
      do {
        this.#cleanupRequested = false;
        await this.input.cleanup();
      } while (this.#cleanupRequested);
      if (this.#capacityReleased) {
        this.#capacityReleased = false;
        this.input.acquisition.capacityReleased();
      }
      clearTimeout(this.#cleanupTimer);
      this.#cleanupTimer = undefined;
    } finally {
      this.#cleaning = undefined;
    }
  }
  private signal(extra?: AbortSignal): AbortSignal {
    return AbortSignal.any([
      this.#lifetime.signal,
      AbortSignal.timeout(this.input.timing.timeoutMs),
      ...(extra ? [extra] : []),
    ]);
  }
  async cancel(input: Resource): Promise<void> {
    const active = this.#acquisitions.get(resourceKey(input));
    active?.abort.abort('paused');
    await active?.task;
    this.wake();
  }
  close(): Promise<void> {
    this.#closing ??= this.stop();
    return this.#closing;
  }
  private async stop(): Promise<void> {
    clearTimeout(this.#timer);
    clearTimeout(this.#cleanupTimer);
    this.#lifetime.abort('interrupted');
    await Promise.allSettled([
      ...[...this.#acquisitions.values()].map(({ task }) => task),
      ...this.#deliveries,
    ]);
    await this.cleanup();
  }
}
function resourceKey(input: Resource): string {
  return JSON.stringify([input.ownerId, input.id]);
}
