import { join } from 'node:path';
import { Elysia } from 'elysia';
import { createConnectorClient } from './connector/client';
import { loadProviderKey } from './connector/encryption-key';
import { connectorManagement } from './connector/management';
import { openProviderDatabase } from './db/providers';
import { createSyncController, syncErrorResponse } from './http/controller';
import { createProviderController } from './http/providers';
import { fail } from './models/error';
import type { Scope } from './models/identity';
import { SqliteProviders } from './repositories/providers/sqlite';
import { createSyncRuntime, type SyncRuntimeOptions } from './runtime';
import { ProviderService } from './services/providers/service';

export type { Scope } from './models/identity';
export type { ProviderCatalogEntry, ProviderSetup } from './models/providers';

export interface OpenSyncOptions extends Omit<SyncRuntimeOptions, 'databasePath' | 'connector'> {
  dataDirectory: string;
  /** Absolute URL where the host mounts fetch(), including its path prefix. */
  publicUrl: string;
  /** Host authentication, ownership and CSRF policy for management HTTP requests. */
  authorize(request: Request): Scope | null | Promise<Scope | null>;
  /** OAuth application settings are instance-wide, so require the host's administrator policy. */
  canConfigureProviders(scope: Scope): Promise<boolean>;
  /** The host may finish authorization on its own authenticated route and call providers.complete(). */
  authorizationReturnUrl?(input: { service: string; id: string }): string;
}

/** Headless application boundary. The host owns its listener; Open Sync owns provider and worker lifecycles. */
export async function createOpenSync(options: OpenSyncOptions) {
  const base = new URL(options.publicUrl);
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.search ||
    base.hash ||
    base.username ||
    base.password
  ) {
    fail('invalid_public_url');
  }
  const prefix = base.pathname.replace(/\/$/, '');
  const publicUrl = `${base.origin}${prefix}`;
  const encryptionKey = await loadProviderKey(options.dataDirectory);
  const adminToken = crypto.randomUUID();
  const runtimeToken = crypto.randomUUID();
  // Loading the engine alone does not initialize the provider platform.
  const { createConnectorRuntime } = await import('@oomol-lab/open-connector');
  const connector = await createConnectorRuntime({
    dataDir: join(options.dataDirectory, 'connector'),
    publicOrigin: publicUrl,
    encryptionKey,
    adminToken,
    runtimeToken,
  });
  const lifetime = new AbortController();
  let references: ReturnType<typeof openProviderDatabase> | undefined;
  let engine: ReturnType<typeof createSyncRuntime> | undefined;
  try {
    references = openProviderDatabase(join(options.dataDirectory, 'providers.db'));
    const repository = new SqliteProviders(references);
    const transport = (request: Request) => connector.fetch(request);
    const management = connectorManagement({
      fetch: transport,
      baseUrl: publicUrl,
      adminToken,
      runtimeToken,
      signal: lifetime.signal,
    });
    const client = createConnectorClient({
      fetch: transport,
      baseUrl: publicUrl,
      adminToken,
      runtimeToken,
      authorizeConnection: (input) =>
        repository.owns({ ...input, connectorId: input.connection.id }),
    });
    engine = createSyncRuntime({
      ...options,
      databasePath: join(options.dataDirectory, 'sync.db'),
      connector: {
        async bind(input) {
          const owned = await repository.connection({ ...input, id: input.connection.id });
          if (!owned || owned.service !== input.connection.service) {
            fail('not_found');
          }
          return await client.bind({
            ...input,
            connection: { id: owned.connectorId, service: input.connection.service },
          });
        },
      },
    });
    const providers = new ProviderService({
      repository,
      connector: management,
      signal: lifetime.signal,
      canConfigure: options.canConfigureProviders,
      returnUrl:
        options.authorizationReturnUrl ??
        ((input) =>
          `${publicUrl}/providers/${encodeURIComponent(input.service)}/return/${input.id}`),
    });
    const http = new Elysia({ prefix })
      .onError(({ error }) => syncErrorResponse(error))
      .use(createSyncController({ api: engine.api, authorize: options.authorize }))
      .use(createProviderController({ providers, authorize: options.authorize }));
    let closing: Promise<void> | undefined;
    const runtime = engine;
    const database = references;
    return {
      api: runtime.api,
      providers,
      start: () => runtime.start(),
      tick: () => runtime.tick(),
      async fetch(request: Request): Promise<Response> {
        if (lifetime.signal.aborted) {
          return new Response(null, { status: 503 });
        }
        const url = new URL(request.url);
        if (url.pathname === `${prefix}/oauth/callback` && request.method === 'GET') {
          return await connector.fetch(request);
        }
        if (!url.pathname.startsWith(`${prefix}/`)) {
          return new Response(null, { status: 404 });
        }
        return await http.handle(request);
      },
      close() {
        closing ??= (async () => {
          lifetime.abort();
          try {
            await runtime.close();
          } finally {
            try {
              await connector.close();
            } finally {
              database.close();
            }
          }
        })();
        return closing;
      },
    };
  } catch (error) {
    lifetime.abort();
    try {
      await engine?.close();
    } finally {
      try {
        await connector.close();
      } finally {
        references?.close();
      }
    }
    throw error;
  }
}
export type OpenSyncRuntime = Awaited<ReturnType<typeof createOpenSync>>;
