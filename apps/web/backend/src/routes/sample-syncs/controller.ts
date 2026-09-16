import { Elysia } from 'elysia';
import type { Auth } from '#backend/lib/auth/better-auth.ts';
import { authorizeSyncRequest } from '#backend/routes/sync-authorization.ts';
import type { SampleSyncService } from '#backend/services/sample-sync/service.ts';
export function sampleSyncController(input: {
  samples: SampleSyncService;
  auth: Auth;
  origins: readonly string[];
}) {
  return new Elysia().post('/sample-syncs', async ({ request, status }) => {
    const scope = await authorizeSyncRequest({ ...input, request });
    if (!scope) {
      return status('Unauthorized', { error: 'Unauthorized' });
    }
    return await input.samples.create(scope);
  });
}
