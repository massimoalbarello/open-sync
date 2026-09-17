import { Elysia, t } from 'elysia';
import type { SyncApi } from '../api';
import type { Scope } from '../models/identity';
import type { JsonObject } from '../models/json';
import { syncErrorResponse } from './index';

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
/** Optional management transport. The host owns authentication, owner authorization and CSRF policy. */
export function createSyncController(input: {
  api: SyncApi;
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
    .get('/destination-types', ({ scope }) => ({ types: input.api.destinationTypes(scope) }))
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
    .get(
      '/installations/:id/runs',
      ({ scope, params, query }) =>
        input.api.runs({ ...scope, id: params.id, offset: query.offset }),
      {
        ...resourceParams,
        query: t.Object({ offset: t.Optional(t.Integer({ minimum: 0, maximum: 1000000 })) }),
      },
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
    .get(
      '/deliveries',
      ({ scope, query }) => input.api.deliveries({ ...scope, offset: query.offset }),
      {
        query: t.Object({ offset: t.Optional(t.Integer({ minimum: 0, maximum: 1000000 })) }),
      },
    )
    .post(
      '/deliveries/:id/retry',
      ({ scope, params }) => {
        input.api.retryDelivery({ ...scope, id: params.id });
        return { queued: true };
      },
      resourceParams,
    );
}
