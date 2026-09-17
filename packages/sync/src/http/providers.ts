import { Elysia, t } from 'elysia';
import { fail, SyncError } from '../models/error';
import type { Scope } from '../models/identity';
import type { ProviderService } from '../services/providers/service';
import { syncErrorResponse } from './index';

export function createProviderController(input: {
  providers: ProviderService;
  authorizationRedirect?(input: { service: string; outcome: 'connected' | 'failed' }): string;
  authorize(request: Request): Scope | null | Promise<Scope | null>;
}) {
  async function scope(request: Request) {
    const principal = await input.authorize(request);
    if (!principal) {
      fail('unauthorized');
    }
    return principal;
  }
  const service = t.String({ pattern: '^[a-zA-Z0-9_-]+$', maxLength: 128 });
  const id = t.String({ pattern: '^connection_[a-f0-9-]{36}$' });
  const values = t.Record(t.String({ maxLength: 128 }), t.String({ maxLength: 65536 }), {
    maxProperties: 64,
  });
  return new Elysia({ prefix: '/providers' })
    .onError(({ error }) => syncErrorResponse(error))
    .get(
      '/connections',
      async ({ request }) => await input.providers.connections(await scope(request)),
    )
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
          if (
            !(error instanceof SyncError) ||
            error.code !== 'provider_request_failed' ||
            !input.authorizationRedirect
          ) {
            throw error;
          }
          return redirect(
            input.authorizationRedirect({ service: params.service, outcome: 'failed' }),
          );
        }
        return input.authorizationRedirect
          ? redirect(input.authorizationRedirect({ service: params.service, outcome: 'connected' }))
          : { connected: true };
      },
      { params: t.Object({ service, id }) },
    );
}
