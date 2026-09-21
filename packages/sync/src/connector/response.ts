import type { ProviderResponse } from '../models/definition';
import { fail } from '../models/error';
import { canonicalJson, type JsonValue } from '../models/json';
import { validate } from '../models/validation';
import { connectorFailure } from './failure';

export async function connectorData(input: {
  response: Response;
  service: string;
  operation: string;
  signal: AbortSignal;
}): Promise<JsonValue> {
  const result = (await input.response.json().catch(() => undefined)) as
    | { success?: boolean; data?: JsonValue }
    | undefined;
  input.signal.throwIfAborted();
  if (!input.response.ok || result?.success !== true || result.data === undefined) {
    throw connectorFailure({
      ...input,
      kind: result?.success === false ? 'rejected' : 'invalid_response',
      body: result,
    });
  }
  return canonicalJson(result.data).value;
}

/** Connector's wire envelope ends here; definitions only consume the Open Sync contract. */
export function providerResponse(value: unknown): ProviderResponse {
  let response: {
    status: number;
    headers: Record<string, string>;
    data: JsonValue;
    bodyEncoding?: unknown;
  };
  try {
    response = validate({
      value,
      schema: {
        type: 'object',
        required: ['status', 'headers', 'data'],
        properties: {
          status: { type: 'integer', minimum: 100, maximum: 599 },
          headers: { type: 'object', additionalProperties: { type: 'string' } },
          data: {},
        },
      },
    }) as unknown as typeof response;
  } catch {
    return fail('invalid_provider_response');
  }
  // Assets are deferred. Never pass an encoded binary body off as provider text.
  if (response.bodyEncoding !== undefined) {
    fail('unsupported_provider_response');
  }
  return { status: response.status, headers: response.headers, body: response.data };
}
