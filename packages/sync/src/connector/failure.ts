import { SyncError } from '../models/error';
import type { JsonObject } from '../models/json';
import { isErrorStatus } from '../models/source-http-error';

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
  const status = input.response?.status;
  return new SyncError({
    code: 'connector_request_failed',
    message: 'connector request failed',
    diagnostics,
    status: isErrorStatus(status) ? status : undefined,
  });
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
