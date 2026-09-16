import { Elysia, t } from 'elysia';
import type { Auth } from '#backend/lib/auth/better-auth.ts';
import { BadRequestError, UnauthorizedError } from '#backend/lib/errors.ts';
import { authorizeSyncRequest } from '#backend/routes/sync-authorization.ts';
import type { ProviderService } from '#backend/services/providers/service.ts';

export function providerController(input: {
  providers: ProviderService;
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
  const service = t.String({ pattern: '^[a-zA-Z0-9_-]+$', maxLength: 128 });
  const id = t.String({ pattern: '^connection_[a-f0-9-]{36}$' });
  const values = t.Record(t.String({ maxLength: 128 }), t.String({ maxLength: 65536 }), {
    maxProperties: 64,
  });
  return new Elysia({ prefix: '/providers' })
    .get('/', async ({ request }) => await input.providers.catalog(await scope(request)))
    .get(
      '/:service',
      async ({ request, params }) =>
        await input.providers.status({ ...(await scope(request)), ...params }),
      { params: t.Object({ service }) },
    )
    .put(
      '/:service/oauth-client',
      async ({ request, params, body }) =>
        await input.providers.configure({ ...(await scope(request)), ...params, ...body }),
      {
        params: t.Object({ service }),
        body: t.Object({ values }),
      },
    )
    .post(
      '/:service/connect',
      async ({ request, params, body }) =>
        await input.providers.start({ ...(await scope(request)), ...params, ...body }),
      {
        params: t.Object({ service }),
        body: t.Object({
          authorizationOptionIds: t.Optional(
            t.Array(t.String({ maxLength: 256 }), { maxItems: 128 }),
          ),
        }),
      },
    )
    .post(
      '/:service/credentials',
      async ({ request, params, body }) =>
        await input.providers.credentials({ ...(await scope(request)), ...params, ...body }),
      {
        params: t.Object({ service }),
        body: t.Object({
          authType: t.Union([t.Literal('api_key'), t.Literal('custom_credential')]),
          values,
        }),
      },
    )
    .get(
      '/:service/return/:id',
      async ({ request, params, redirect }) => {
        try {
          await input.providers.complete({ ...(await scope(request)), ...params });
        } catch (error) {
          if (error instanceof BadRequestError) {
            return redirect(
              `/providers/${encodeURIComponent(params.service)}?authorization=failed&section=authorization`,
            );
          }
          throw error;
        }
        return redirect(`/providers/${encodeURIComponent(params.service)}`);
      },
      { params: t.Object({ service, id }) },
    );
}
