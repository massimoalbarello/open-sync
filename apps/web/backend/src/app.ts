import { openapi } from '@elysiajs/openapi';
import { Elysia } from 'elysia';
import type { Auth } from '#backend/lib/auth/better-auth.ts';
import { elysiaErrorHandler } from '#backend/lib/errors.ts';
import { createNotesController } from '#backend/routes/api/notes/controller.ts';
import type { FrontendAssetsServiceContract } from '#backend/services/frontend-assets/service.ts';
import type { NotesServiceContract } from '#backend/services/notes/service.ts';
export function createApp(input: {
  auth: Auth;
  notes: NotesServiceContract;
  frontend: FrontendAssetsServiceContract;
  origin: string;
}) {
  const frontendRoutes = input.frontend.routes();
  return new Elysia()
    .onError(elysiaErrorHandler)
    .use(openapi({ documentation: { info: { title: 'Application API', version: '1.0.0' } } }))
    .group('/api', (app) =>
      app
        .get('/health', () => ({ status: 'ok' }))
        .all('/auth/*', ({ request }) => input.auth.handler(request), {
          parse: 'none',
          detail: { hide: true },
        })
        .use(createNotesController(input)),
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
