import { Elysia, t } from 'elysia';
import type { Auth } from '#backend/lib/auth/better-auth.ts';
import { authorizeSyncRequest } from '#backend/routes/sync-authorization.ts';
import type { ReceiverService } from '#backend/services/receiver/service.ts';

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
