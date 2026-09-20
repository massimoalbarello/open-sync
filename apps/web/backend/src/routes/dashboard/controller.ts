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
    .resolve(async ({ request, status }) => {
      const scope = await authorizeSyncRequest({ ...input, request });
      if (!scope) {
        return status('Unauthorized', { error: 'Unauthorized' });
      }
      return { scope };
    })
    .post('/syncs', ({ scope, body }) => input.dashboard.create({ ...scope, ...body }), {
      body: t.Union([
        t.Object({
          source: t.String({ minLength: 1, maxLength: 1024 }),
          destination: t.Literal('local'),
        }),
        t.Object({
          source: t.String({ minLength: 1, maxLength: 1024 }),
          destination: t.Literal('http'),
          endpoint: t.String({ minLength: 1, maxLength: 2048 }),
          apiKey: t.String({ minLength: 1, maxLength: 16384 }),
        }),
      ]),
    });
}
