import { SyncError } from './error';

const firstErrorStatus = 400;
const lastErrorStatus = 599;

/** Sources normalize provider-specific failures to HTTP semantics. No bodies or secrets are retained. */
export class SourceHttpError extends SyncError {
  declare readonly status: number;

  constructor(input: { status: number }) {
    if (!isErrorStatus(input.status)) {
      throw new TypeError('SourceHttpError requires an HTTP error status (400–599).');
    }
    super({
      code: `source_http_${input.status}`,
      message: `Source returned HTTP ${input.status}.`,
      status: input.status,
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
