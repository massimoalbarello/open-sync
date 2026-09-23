import { Elysia, t } from 'elysia';
import type { Auth } from '#backend/lib/auth/better-auth.ts';
import { authorizeSyncRequest } from '#backend/routes/sync-authorization.ts';
import type { ReceiverService } from '#backend/services/receiver/service.ts';
import { assetResponse } from './asset-response';

const identifier = t.String({ minLength: 1, maxLength: 1024 });
export function receiverController(input: {
  receiver: ReceiverService;
  auth: Auth;
  origins: readonly string[];
}) {
  return new Elysia({ prefix: '/receiver/syncs/:syncId/deliverables' })
    .resolve(async ({ request, status }) => {
      const scope = await authorizeSyncRequest({ ...input, request });
      if (!scope) {
        return status('Unauthorized', { error: 'Unauthorized' });
      }
      return { scope };
    })
    .get(
      '',
      ({ scope, params, query }) =>
        input.receiver.deliverables({
          scope,
          syncId: params.syncId,
          before: query.before,
        }),
      {
        params: t.Object({ syncId: identifier }),
        query: t.Object({
          before: t.Optional(t.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
        }),
      },
    )
    .get(
      '/:id',
      async ({ scope, params, status }) => {
        const found = await input.receiver.deliverable({ scope, ...params });
        return found ?? status('Not Found', { error: 'Not Found' });
      },
      { params: t.Object({ syncId: identifier, id: identifier }) },
    )
    .get(
      '/:id/assets/:index',
      async ({ scope, params, request, status }) => {
        const asset = await input.receiver.asset({ scope, ...params });
        return asset
          ? assetResponse({ asset, range: request.headers.get('range') })
          : status('Not Found', { error: 'Not Found' });
      },
      {
        params: t.Object({
          syncId: identifier,
          id: identifier,
          index: t.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
        }),
      },
    );
}
