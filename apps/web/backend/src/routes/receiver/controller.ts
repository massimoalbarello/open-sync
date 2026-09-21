import { Elysia, t } from 'elysia';
import type { Auth } from '#backend/lib/auth/better-auth.ts';
import { authorizeSyncRequest } from '#backend/routes/sync-authorization.ts';
import type { ReceiverService } from '#backend/services/receiver/service.ts';
import { assetResponse } from './asset-response';

export function receiverController(input: {
  receiver: ReceiverService;
  auth: Auth;
  origins: readonly string[];
}) {
  return new Elysia({ prefix: '/receiver' })
    .resolve(async ({ request, status }) => {
      const scope = await authorizeSyncRequest({ ...input, request });
      if (!scope) {
        return status('Unauthorized', { error: 'Unauthorized' });
      }
      return { scope };
    })
    .get(
      '/records',
      ({ scope, query }) =>
        input.receiver.records({
          ...scope,
          sourceId: query.sourceId,
          offset: query.offset ?? 0,
        }),
      {
        query: t.Object({
          sourceId: t.Optional(t.String({ minLength: 1, maxLength: 1024 })),
          offset: t.Optional(t.Integer({ minimum: 0, maximum: 1000000 })),
        }),
      },
    )
    .get(
      '/records/detail',
      async ({ scope, query, status }) => {
        const record = await input.receiver.record({
          ...scope,
          sourceId: query.sourceId,
          kind: query.kind,
          id: query.id,
        });
        return record ? { record } : status('Not Found', { error: 'Not Found' });
      },
      {
        query: t.Object({
          sourceId: t.String({ minLength: 1, maxLength: 1024 }),
          kind: t.String({ minLength: 1, maxLength: 1024 }),
          id: t.String({ minLength: 1, maxLength: 1024 }),
        }),
      },
    )
    .get(
      '/assets/:id/details',
      async ({ scope, params, status }) => {
        const asset = await input.receiver.assetInfo({ ...scope, id: params.id });
        return asset ? { asset } : status('Not Found', { error: 'Not Found' });
      },
      { params: t.Object({ id: t.String({ pattern: '^asset_[0-9a-f-]{36}$' }) }) },
    )
    .get(
      '/assets/:id/preview',
      async ({ scope, params, request, status }) => {
        const asset = await input.receiver.asset({ ...scope, id: params.id });
        return asset
          ? assetResponse({ asset, range: request.headers.get('range'), inline: true })
          : status('Not Found', { error: 'Not Found' });
      },
      { params: t.Object({ id: t.String({ pattern: '^asset_[0-9a-f-]{36}$' }) }) },
    )
    .get(
      '/assets',
      ({ scope, query }) =>
        input.receiver.assets({ ...scope, sourceId: query.sourceId, offset: query.offset ?? 0 }),
      {
        query: t.Object({
          sourceId: t.Optional(t.String({ minLength: 1, maxLength: 1024 })),
          offset: t.Optional(t.Integer({ minimum: 0, maximum: 1000000 })),
        }),
      },
    )
    .get(
      '/assets/:id',
      async ({ scope, params, request, status }) => {
        const asset = await input.receiver.asset({ ...scope, id: params.id });
        if (!asset) {
          return status('Not Found', { error: 'Not Found' });
        }
        return assetResponse({ asset, range: request.headers.get('range'), inline: false });
      },
      { params: t.Object({ id: t.String({ pattern: '^asset_[0-9a-f-]{36}$' }) }) },
    )
    .get('/status', ({ scope }) => input.receiver.status(scope))
    .patch(
      '/settings',
      async ({ scope, body }) => {
        await input.receiver.setPaused({ ...scope, paused: body.paused });
        return { paused: body.paused };
      },
      { body: t.Object({ paused: t.Boolean() }) },
    );
}
