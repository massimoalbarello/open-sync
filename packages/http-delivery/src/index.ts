import type { DestinationType } from '@open-sync/core/delivery';
import { canonicalJson } from '@open-sync/core/json';

const requestTimeout = 408;
const rateLimited = 429;
const serverError = 500;
const secondsToMs = 1000;
function retryAfter(value: string | null): number | undefined {
  if (value === null) {
    return;
  }
  const delay = /^\d+$/.test(value) ? Number(value) * secondsToMs : Date.parse(value) - Date.now();
  return Number.isSafeInteger(delay) ? Math.max(0, delay) : undefined;
}
/** Endpoint and credentials are trusted host configuration, never browser-submitted URLs. */
export function createHttpDestination(input: {
  endpoint: string;
  bearerToken?: string;
  fetch?: typeof fetch;
}): DestinationType {
  const endpoint = new URL(input.endpoint);
  if (
    !['http:', 'https:'].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.hash
  ) {
    throw new Error('Invalid delivery endpoint');
  }
  const transport = input.fetch ?? fetch;
  const bearerToken = input.bearerToken;
  return {
    // A changed credential may select a different recipient at the same endpoint. Fail closed.
    version: `1:${canonicalJson({ endpoint: endpoint.href, bearerToken: bearerToken ?? null }).sha256}`,
    configSchema: { type: 'object', additionalProperties: false },
    async deliver({ delivery, signal }) {
      const headers = new Headers({
        'content-type': 'application/json',
        'idempotency-key': delivery.id,
      });
      if (bearerToken) {
        headers.set('authorization', `Bearer ${bearerToken}`);
      }
      const response = await transport(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers,
        body: canonicalJson(delivery).json,
        signal,
      });
      await response.body?.cancel();
      if (response.ok) {
        return { status: 'accepted' };
      }
      if (
        response.status === requestTimeout ||
        response.status === rateLimited ||
        response.status >= serverError
      ) {
        return {
          status: 'retry',
          code: `http_${response.status}`,
          retryAfterMs: retryAfter(response.headers.get('retry-after')),
        };
      }
      return { status: 'rejected', code: `http_${response.status}` };
    },
  };
}
