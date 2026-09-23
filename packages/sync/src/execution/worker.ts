import { fail } from '../models/error';
import type { Resource } from '../models/identity';
import type { Timing } from '../models/limits';
import type { AcquisitionService } from '../services/acquisition';
import type { DeliveryService } from '../services/delivery';
import type { Logger } from './diagnostics';

export interface WorkerControl {
  ensureOpen(): void;
  wake(): void;
  cancelAcquisition(input: Resource): Promise<void>;
  cancelSync(input: Resource): Promise<void>;
}
export class Worker implements WorkerControl {
  readonly #lifetime = new AbortController();
  #timer?: ReturnType<typeof setTimeout>;
  #started = false;
  readonly #acquisitions = new Map<
    Promise<void>,
    { ownerId: string; syncId: string; abort: AbortController }
  >();
  readonly #deliveries = new Map<
    Promise<void>,
    { ownerId: string; syncId: string; abort: AbortController }
  >();
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
    return Promise.all([...this.#acquisitions.keys(), ...this.#deliveries.keys()]).then(() =>
      this.cleanup(),
    );
  }
  private dispatch(): void {
    this.ensureOpen();
    const { acquisition, delivery, timing } = this.input;
    while (this.#acquisitions.size < timing.sourceConcurrency) {
      const lease = acquisition.claim();
      if (!lease) {
        break;
      }
      const abort = new AbortController();
      const task = acquisition
        .execute({ lease, signal: this.signal(abort.signal) })
        .catch(() => this.input.log({ code: 'acquisition_failed' }))
        .finally(() => {
          this.#acquisitions.delete(task);
          this.completed();
        });
      this.#acquisitions.set(task, { ownerId: lease.ownerId, syncId: lease.sync.id, abort });
    }
    while (this.#deliveries.size < timing.deliveryConcurrency) {
      const lease = delivery.claim();
      if (!lease) {
        break;
      }
      const abort = new AbortController();
      const task = delivery
        .execute({ lease, signal: this.signal(abort.signal) })
        .then((accepted) => {
          this.#capacityReleased ||= accepted;
        })
        .catch(() => this.input.log({ code: 'delivery_failed' }))
        .finally(() => {
          this.#deliveries.delete(task);
          this.completed();
        });
      this.#deliveries.set(task, { ownerId: lease.ownerId, syncId: lease.delivery.syncId, abort });
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
  async cancelAcquisition(input: Resource): Promise<void> {
    await this.cancelTasks({ scope: input, tasks: this.#acquisitions });
    this.completed();
  }
  async cancelSync(input: Resource): Promise<void> {
    await Promise.all([
      this.cancelTasks({ scope: input, tasks: this.#acquisitions }),
      this.cancelTasks({ scope: input, tasks: this.#deliveries }),
    ]);
    this.#capacityReleased = true;
    this.completed();
    await this.cleanup().catch(() => this.input.log({ code: 'cleanup_failed' }));
  }
  private async cancelTasks({
    scope,
    tasks,
  }: {
    scope: Resource;
    tasks: Map<Promise<void>, { ownerId: string; syncId: string; abort: AbortController }>;
  }): Promise<void> {
    const cancelled = [];
    for (const [task, entry] of tasks) {
      if (entry.ownerId === scope.ownerId && entry.syncId === scope.id) {
        entry.abort.abort('interrupted');
        cancelled.push(task);
      }
    }
    await Promise.all(cancelled);
  }
  close(): Promise<void> {
    this.#closing ??= this.stop();
    return this.#closing;
  }
  private async stop(): Promise<void> {
    clearTimeout(this.#timer);
    clearTimeout(this.#cleanupTimer);
    this.#lifetime.abort('interrupted');
    await Promise.allSettled([...this.#acquisitions.keys(), ...this.#deliveries.keys()]);
    await this.cleanup();
  }
}
