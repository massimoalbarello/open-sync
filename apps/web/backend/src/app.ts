import { openapi } from '@elysiajs/openapi';
import { syncErrorResponse } from '@open-sync/core/http';
import { Elysia, t } from 'elysia';
import type { Auth } from '#backend/lib/auth/better-auth.ts';
import { elysiaErrorHandler } from '#backend/lib/errors.ts';
import { githubSyncController } from '#backend/routes/github-syncs/controller.ts';
import { receiverController } from '#backend/routes/receiver/controller.ts';
import { sampleSyncController } from '#backend/routes/sample-syncs/controller.ts';
import type { FrontendAssetsServiceContract } from '#backend/services/frontend-assets/service.ts';
import type { GithubSyncService } from '#backend/services/github-sync/service.ts';
import type { ReceiverService } from '#backend/services/receiver/service.ts';
import type { SampleSyncService } from '#backend/services/sample-sync/service.ts';
export function createApp(input: {
  auth: Auth;
  frontend: FrontendAssetsServiceContract;
  receiver: ReceiverService;
  samples: SampleSyncService;
  githubSyncs: GithubSyncService;
  syncFetch(request: Request): Promise<Response>;
  origins: readonly string[];
}) {
  const frontendRoutes = input.frontend.routes();
  return new Elysia()
    .onError((context) => syncErrorResponse(context.error) ?? elysiaErrorHandler(context))
    .use(openapi({ documentation: { info: { title: 'Open Sync API', version: '1.0.0' } } }))
    .all('/api/open-sync/*', ({ request }) => input.syncFetch(request), { parse: 'none' })
    .group('/api', (app) =>
      app
        .get('/health', () => ({ status: 'ok' }))
        .get('/registration', () => input.auth.registrationStatus(), {
          response: t.Object({ ownerRegistered: t.Boolean() }),
        })
        .use(receiverController(input))
        .use(sampleSyncController(input))
        .use(githubSyncController(input))
        .all('/auth/*', ({ request }) => input.auth.handler(request), {
          parse: 'none',
          detail: { hide: true },
        }),
    )
    .all('/*', ({ path, request, status }) => {
      if (request.method !== 'GET' || path === '/api' || path.startsWith('/api/')) {
        return status('Not Found', { error: 'Not Found' });
      }
      return (
        frontendRoutes.get(path)?.clone() ??
        input.frontend.fallback(path) ??
        status('Not Found', { error: 'Not Found' })
      );
    });
}
export type App = ReturnType<typeof createApp>;
