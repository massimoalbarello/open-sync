import { Elysia, t } from 'elysia';
import type { SyncApi } from '../api';
import type { Scope } from '../models/identity';
import type { JsonObject } from '../models/json';
import { syncErrorResponse } from './index';

const identifier = t.String({ minLength: 1, maxLength: 1024 });
const config = t.Record(t.String(), t.Unknown());
const syncBody = t.Object({
  definition: identifier,
  config,
  destination: t.Object({ type: identifier, input: config }),
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
    .onError(({ error, code, status }) =>
      code === 'VALIDATION'
        ? status('Unprocessable Content', { error: 'invalid_input' })
        : syncErrorResponse(error),
    )
    .resolve(async ({ request, status }) => {
      const scope = await input.authorize(request);
      if (!scope) {
        return status('Unauthorized', { error: 'Unauthorized' });
      }
      return { scope };
    })
    .get('/definitions', ({ scope }) => ({ definitions: input.api.definitions(scope) }))
    .get('/destination-types', ({ scope }) => ({ types: input.api.destinationTypes(scope) }))
    .get('/syncs', ({ scope }) => ({ syncs: input.api.syncs(scope) }))
    .post(
      '/syncs',
      ({ scope, body }) =>
        input.api.createSync({
          ...body,
          config: body.config as JsonObject,
          destination: { type: body.destination.type, input: body.destination.input as JsonObject },
          ...scope,
        }),
      { body: syncBody },
    )
    .get(
      '/syncs/:id',
      ({ scope, params }) => input.api.sync({ ...scope, id: params.id }),
      resourceParams,
    )
    .patch(
      '/syncs/:id',
      ({ scope, params, body }) =>
        input.api.setEnabled({ ...scope, id: params.id, enabled: body.enabled }),
      { ...resourceParams, body: t.Object({ enabled: t.Boolean() }) },
    )
    .post(
      '/syncs/:id/run',
      ({ scope, params }) => {
        input.api.runNow({ ...scope, id: params.id });
        return { queued: true };
      },
      resourceParams,
    )
    .post(
      '/syncs/:id/resync',
      async ({ scope, params }) => {
        await input.api.resync({ ...scope, id: params.id });
        return { queued: true };
      },
      resourceParams,
    )
    .delete(
      '/syncs/:id',
      async ({ scope, params }) => {
        await input.api.removeSync({ ...scope, id: params.id });
        return { removed: true };
      },
      resourceParams,
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
