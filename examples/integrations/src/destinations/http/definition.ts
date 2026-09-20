import type { DeliveryResult, DestinationType } from '@context-use/open-sync/delivery';
import { jsonSchema } from '../../schema';
import { destinationCredentials } from './credentials';
import { configSchema, setupSchema } from './models';

const millisecondsPerSecond = 1000;

export function httpDestination(input: { secret: string; fetch?: typeof fetch }): DestinationType {
  const send = input.fetch ?? fetch;
  const credentials = destinationCredentials(input.secret);
  return {
    name: 'External API',
    description: 'Sends records to your HTTPS endpoint, authenticated with your API key.',
    version: '1',
    configSchema: jsonSchema(configSchema),
    setup: {
      schema: jsonSchema(setupSchema),
      prepare({ scope, input }) {
        const settings = setupSchema.parse(input);
        const endpoint = new URL(settings.endpoint).href;
        return {
          endpoint,
          credential: credentials.seal({
            ownerId: scope.ownerId,
            endpoint,
            apiKey: settings.apiKey.trim(),
          }),
        };
      },
    },
    async deliver({ scope, config, delivery, signal }) {
      if (scope.ownerId !== delivery.ownerId) {
        return { status: 'rejected', code: 'owner_mismatch' };
      }
      const settings = configSchema.parse(config);
      const apiKey = credentials.open({ ownerId: scope.ownerId, ...settings });
      if (!apiKey || /[\r\n]/.test(apiKey)) {
        return { status: 'rejected', code: 'invalid_api_key' };
      }
      const response = await send(settings.endpoint, {
        method: 'POST',
        redirect: 'manual',
        signal,
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'idempotency-key': delivery.id,
        },
        // The receiver must durably accept the whole envelope before returning 2xx.
        // It can deduplicate deliveries by id, or records by sourceId/kind/id/revision.
        body: JSON.stringify(delivery),
      });
      await response.body?.cancel();
      return deliveryResult(response);
    },
  };
}

function deliveryResult(response: Response): DeliveryResult {
  if (response.ok) {
    return { status: 'accepted' };
  }
  const serverError = 500;
  const requestTimeout = 408;
  const tooEarly = 425;
  const rateLimited = 429;
  const retryableStatuses = [requestTimeout, tooEarly, rateLimited];
  if (response.status >= serverError || retryableStatuses.includes(response.status)) {
    const value = response.headers.get('retry-after');
    const seconds = value && /^\d+$/.test(value) ? Number(value) : undefined;
    const date = value ? Date.parse(value) : NaN;
    const delay = seconds !== undefined ? seconds * millisecondsPerSecond : date - Date.now();
    return {
      status: 'retry',
      code: `http_${response.status}`,
      ...(Number.isFinite(delay) ? { retryAfterMs: Math.max(0, Math.ceil(delay)) } : {}),
    };
  }
  // In particular, never forward a key to a redirect target or retry rejected credentials forever.
  return { status: 'rejected', code: `http_${response.status}` };
}
