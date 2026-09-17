import { Elysia, status, t } from 'elysia';
import { SyncError } from '../models/error';
import type { Scope } from '../models/identity';
import type { JsonObject } from '../models/json';
import type { SyncManagement } from '../services/management';

const identifier = t.String({ minLength: 1, maxLength: 1024 });
const config = t.Record(t.String(), t.Unknown());
const definition = t.Object({ id: identifier, version: identifier, artifactId: identifier });
const installationBody = t.Object({
  definition,
  config,
  destinationId: identifier,
  connection: t.Optional(t.Object({ id: identifier, service: identifier })),
  intervalMs: t.Optional(t.Integer({ minimum: 1 })),
  enabled: t.Optional(t.Boolean()),
});
const resourceParams = { params: t.Object({ id: identifier }) };
const notFound = 404;
const conflict = 409;
const unauthorized = 401;
const forbidden = 403;
const invalidInput = 400;
export function syncErrorResponse(error: unknown) {
  if (error instanceof SyncError) {
    return status(
      ({ not_found: notFound, busy: conflict, unauthorized, forbidden } as Record<string, number>)[
        error.code
      ] ?? invalidInput,
      { error: error.code },
    );
  }
}

/** Optional management transport. The host owns authentication, owner authorization and CSRF policy. */
export function createSyncController(input: {
  api: SyncManagement;
  authorize(request: Request): Scope | null | Promise<Scope | null>;
}) {
  return new Elysia({ prefix: '/sync' })
    .onError(({ error }) => syncErrorResponse(error))
    .resolve(async ({ request, status }) => {
      const scope = await input.authorize(request);
      if (!scope) {
        return status('Unauthorized', { error: 'Unauthorized' });
      }
      return { scope };
    })
    .get('/definitions', ({ scope }) => ({ definitions: input.api.definitions(scope) }))
    .get('/destinations', ({ scope }) => ({ destinations: input.api.destinations(scope) }))
    .post(
      '/destinations',
      ({ scope, body }) =>
        input.api.createDestination({ ...body, config: body.config as JsonObject, ...scope }),
      {
        body: t.Object({ type: identifier, config }),
      },
    )
    .get('/installations', ({ scope }) => ({ installations: input.api.installations(scope) }))
    .post(
      '/installations',
      ({ scope, body }) =>
        input.api.createInstallation({ ...body, config: body.config as JsonObject, ...scope }),
      { body: installationBody },
    )
    .get(
      '/installations/:id',
      ({ scope, params }) => input.api.installation({ ...scope, id: params.id }),
      resourceParams,
    )
    .patch(
      '/installations/:id',
      ({ scope, params, body }) =>
        input.api.setEnabled({ ...scope, id: params.id, enabled: body.enabled }),
      { ...resourceParams, body: t.Object({ enabled: t.Boolean() }) },
    )
    .post(
      '/installations/:id/run',
      ({ scope, params, body }) => {
        input.api.queueRun({ ...scope, id: params.id, backfill: body.backfill });
        return { queued: true };
      },
      { ...resourceParams, body: t.Object({ backfill: t.Optional(t.Boolean()) }) },
    )
    .get('/status', ({ scope }) => input.api.status(scope))
    .get('/deliveries', ({ scope }) => ({ deliveries: input.api.deliveries(scope) }))
    .post(
      '/deliveries/:id/retry',
      ({ scope, params }) => {
        input.api.retryDelivery({ ...scope, id: params.id });
        return { queued: true };
      },
      resourceParams,
    );
}
