import { SyncError } from '../models/error';
import type { JsonObject } from '../models/json';

/** Only protocol metadata crosses this boundary; messages and payloads can contain credentials. */
export function connectorFailure(input: {
  service: string;
  operation: string;
  kind: 'transport' | 'invalid_response' | 'rejected';
  response?: Response;
  body?: unknown;
}): SyncError {
  const body = object(input.body);
  const code = body?.errorCode;
  const providerStatus = object(body?.data)?.status;
  const diagnostics: JsonObject = {
    service: input.service,
    operation: input.operation,
    failureKind: input.kind,
  };
  if (input.response) {
    diagnostics.connectorStatus = input.response.status;
  }
  if (typeof code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(code)) {
    diagnostics.connectorErrorCode = code;
  }
  const minStatus = 100;
  const maxStatus = 599;
  if (
    Number.isInteger(providerStatus) &&
    Number(providerStatus) >= minStatus &&
    Number(providerStatus) <= maxStatus
  ) {
    diagnostics.providerStatus = Number(providerStatus);
  }
  return new SyncError({
    code: 'connector_request_failed',
    message: 'connector request failed',
    diagnostics,
    retryAfterMs: retryAfter(input.response?.headers.get('retry-after')),
  });
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function retryAfter(value: string | null | undefined): number | undefined {
  if (!value) {
    return;
  }
  const millisecondsPerSecond = 1000;
  const seconds = /^\d+$/.test(value);
  if (!seconds && !/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) {
    return;
  }
  const delay = seconds ? Number(value) * millisecondsPerSecond : Date.parse(value) - Date.now();
  return Number.isSafeInteger(delay) && delay >= 0 ? delay : undefined;
}
