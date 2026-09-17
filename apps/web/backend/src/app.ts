import { openapi } from '@elysiajs/openapi';
import { Elysia } from 'elysia';
import type { Auth } from '#backend/lib/auth/better-auth.ts';
import { elysiaErrorHandler } from '#backend/lib/errors.ts';
import type { FrontendAssetsServiceContract } from '#backend/services/frontend-assets/service.ts';
export function createApp(input: { auth: Auth; frontend: FrontendAssetsServiceContract }) {
  const frontendRoutes = input.frontend.routes();
  return new Elysia()
    .onError(elysiaErrorHandler)
    .use(openapi({ documentation: { info: { title: 'Open Sync API', version: '1.0.0' } } }))
    .group('/api', (app) =>
      app
        .get('/health', () => ({ status: 'ok' }))
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
