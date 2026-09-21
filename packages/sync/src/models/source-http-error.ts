import { SyncError } from './error';

const firstErrorStatus = 400;
const lastErrorStatus = 599;

/** Sources normalize provider-specific failures to HTTP semantics. No bodies or secrets are retained. */
export class SourceHttpError extends SyncError {
  declare readonly status: number;

  constructor(input: { status: number; headers?: Headers | Readonly<Record<string, string>> }) {
    if (!isErrorStatus(input.status)) {
      throw new TypeError('SourceHttpError requires an HTTP error status (400–599).');
    }
    super({
      code: `source_http_${input.status}`,
      message: `Source returned HTTP ${input.status}.`,
      status: input.status,
      retryAfterMs: retryAfter(new Headers(input.headers).get('retry-after')),
    });
  }
}

export function isErrorStatus(value: unknown): value is number {
  return (
    Number.isInteger(value) && Number(value) >= firstErrorStatus && Number(value) <= lastErrorStatus
  );
}

export function retryableStatus(status: number): boolean {
  const serverError = 500;
  const requestTimeout = 408;
  const conflict = 409;
  const tooEarly = 425;
  const rateLimited = 429;
  return (
    status >= serverError || [requestTimeout, conflict, tooEarly, rateLimited].includes(status)
  );
}

export function retryAfter(value: string | null | undefined): number | undefined {
  if (!value) {
    return;
  }
  const millisecondsPerSecond = 1000;
  const seconds = /^\d+$/.test(value);
  if (!seconds && !/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) {
    return;
  }
  const delay = seconds ? Number(value) * millisecondsPerSecond : Date.parse(value) - Date.now();
  const maxTimestamp = 8_640_000_000_000_000;
  return Number.isSafeInteger(delay) && delay >= 0 && Date.now() + delay <= maxTimestamp
    ? delay
    : undefined;
}
