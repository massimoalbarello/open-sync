import type { JsonObject } from '@context-use/open-sync/json';
import { Elysia, t } from 'elysia';
import type { Auth } from '#backend/lib/auth/better-auth.ts';
import { authorizeSyncRequest } from '#backend/routes/sync-authorization.ts';
import type { DashboardService } from '#backend/services/dashboard/service.ts';

export function dashboardController(input: {
  dashboard: DashboardService;
  auth: Auth;
  origins: readonly string[];
}) {
  return new Elysia({ prefix: '/dashboard' })
    .onError(({ code, status }) =>
      code === 'VALIDATION' ? status('Bad Request', { error: 'invalid_input' }) : undefined,
    )
    .resolve(async ({ request, status }) => {
      const scope = await authorizeSyncRequest({ ...input, request });
      if (!scope) {
        return status('Unauthorized', { error: 'Unauthorized' });
      }
      return { scope };
    })
    .post(
      '/syncs',
      ({ scope, body }) =>
        input.dashboard.create({
          ...scope,
          source: body.source,
          destination: { ...body.destination, input: body.destination.input as JsonObject },
        }),
      {
        body: t.Object({
          source: t.String({ minLength: 1, maxLength: 1024 }),
          destination: t.Object({
            type: t.String({ minLength: 1, maxLength: 1024 }),
            input: t.Record(t.String(), t.Unknown()),
          }),
        }),
      },
    );
}
