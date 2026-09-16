import { fail } from '../models/error';
import type { Resource } from '../models/identity';
import type { Timing } from '../models/limits';
import type { AcquisitionService } from '../services/acquisition';
import type { DeliveryService } from '../services/delivery';
import type { Logger } from './diagnostics';

export interface WorkerControl {
  ensureOpen(): void;
  cancel(input: Resource): Promise<void>;
}
export class Worker implements WorkerControl {
  readonly #lifetime = new AbortController();
  #timer?: ReturnType<typeof setInterval>;
  #acquisition?: Promise<void>;
  #delivery?: Promise<void>;
  #active?: { ownerId: string; id: string; abort: AbortController };
  #closing?: Promise<void>;
  constructor(
    private readonly input: {
      acquisition: AcquisitionService;
      delivery: DeliveryService;
      timing: Timing;
      log: Logger;
    },
  ) {}
  ensureOpen(): void {
    if (this.#lifetime.signal.aborted) {
      fail('closed');
    }
  }
  start(): void {
    this.ensureOpen();
    if (this.#timer) {
      return;
    }
    const pump = () => {
      void this.tick().catch(() => this.input.log({ code: 'runtime_failed' }));
    };
    this.#timer = setInterval(pump, this.input.timing.pollMs);
    pump();
  }
  tick(): Promise<void> {
    this.ensureOpen();
    this.#acquisition ??= this.acquire().finally(() => {
      this.#acquisition = undefined;
    });
    this.#delivery ??= this.input.delivery.execute(this.signal()).finally(() => {
      this.#delivery = undefined;
    });
    return Promise.all([this.#acquisition, this.#delivery]).then(() => undefined);
  }
  private signal(extra?: AbortSignal): AbortSignal {
    return AbortSignal.any([
      this.#lifetime.signal,
      AbortSignal.timeout(this.input.timing.timeoutMs),
      ...(extra ? [extra] : []),
    ]);
  }
  private async acquire(): Promise<void> {
    const lease = this.input.acquisition.claim();
    if (!lease) {
      return;
    }
    const abort = new AbortController();
    this.#active = { ownerId: lease.ownerId, id: lease.installation.id, abort };
    try {
      await this.input.acquisition.execute({ lease, signal: this.signal(abort.signal) });
    } finally {
      this.#active = undefined;
    }
  }
  async cancel(input: Resource): Promise<void> {
    if (this.#active?.ownerId === input.ownerId && this.#active.id === input.id) {
      this.#active.abort.abort();
      await this.#acquisition;
    }
  }
  close(): Promise<void> {
    this.#closing ??= this.stop();
    return this.#closing;
  }
  private async stop(): Promise<void> {
    if (this.#timer) {
      clearInterval(this.#timer);
    }
    this.#lifetime.abort();
    await Promise.allSettled([this.#acquisition, this.#delivery]);
  }
}
