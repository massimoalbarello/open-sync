import { Elysia, t } from 'elysia';
import type { Auth } from '#backend/lib/auth/better-auth.ts';
import { UnauthorizedError } from '#backend/lib/errors.ts';
import { authorizeSyncRequest } from '#backend/routes/sync-authorization.ts';
import type { GithubSyncService } from '#backend/services/github-sync/service.ts';

export function githubSyncController(input: {
  githubSyncs: GithubSyncService;
  auth: Auth;
  origins: readonly string[];
}) {
  async function scope(request: Request) {
    const principal = await authorizeSyncRequest({ ...input, request });
    if (!principal) {
      throw new UnauthorizedError();
    }
    return principal;
  }
  return new Elysia({ prefix: '/syncs/github' })
    .get('/connections', async ({ request }) => input.githubSyncs.connections(await scope(request)))
    .post(
      '/',
      async ({ request, body }) =>
        input.githubSyncs.create({ ...(await scope(request)), id: body.connectionId }),
      {
        body: t.Object({ connectionId: t.String({ pattern: '^connection_[a-f0-9-]{36}$' }) }),
      },
    );
}
