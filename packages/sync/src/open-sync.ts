import { join } from 'node:path';
import { type ProviderApi, providerApi, type SyncApi, syncApi } from './api';
import { createConnectorClient } from './connector/client';
import { loadProviderKey } from './connector/encryption-key';
import { connectorManagement } from './connector/management';
import { openProviderDatabase } from './db/providers';
import type { Logger } from './execution/diagnostics';
import { createHttpApp } from './http/app';
import type { SyncRegistration } from './models/definition';
import type { DestinationType } from './models/delivery';
import { fail } from './models/error';
import type { Scope } from './models/identity';
import { defaultTiming, type QueueLimits } from './models/limits';
import type { OAuthClientRegistration } from './models/providers';
import { SqliteProviders } from './repositories/providers/sqlite';
import { createSyncRuntime } from './runtime';
import { ProviderService } from './services/providers/service';

export type { Scope } from './models/identity';
export type {
  OAuthClientRegistration,
  ProviderCatalogEntry,
  ProviderSetup,
} from './models/providers';

export interface OpenSyncOptions {
  definitions: readonly SyncRegistration[];
  destinationTypes: Readonly<Record<string, DestinationType>>;
  limits?: Partial<QueueLimits>;
  executionTimeoutMs?: number;
  sourceConcurrency?: number;
  deliveryConcurrency?: number;
  onEvent?: Logger;
  dataDirectory: string;
  assetDirectory?: string;
  /** Absolute URL where the host mounts fetch(), including its path prefix. */
  publicUrl: string;
  /** Host authentication, ownership and CSRF policy for management HTTP requests. */
  authorize(request: Request): Scope | null | Promise<Scope | null>;
  /** OAuth application settings are instance-wide, so require the host's administrator policy. */
  canConfigureProviders(scope: Scope): Promise<boolean>;
  /** Optional automatic OAuth client setup, selected by the host; never runs on catalog reads. */
  oauthClientRegistrations?: Readonly<Record<string, OAuthClientRegistration>>;
  /** Called after an owned connection is saved, including a retried OAuth completion. */
  onProviderConnected?(
    input: Scope & { connection: { id: string; service: string } },
  ): Promise<void>;
  /** Final host UI location after Open Sync completes authorization. */
  authorizationRedirect?(input: { service: string; outcome: 'connected' | 'failed' }): string;
}

/** Headless application boundary. The host owns its listener; Open Sync owns provider and worker lifecycles. */
export async function createOpenSync(options: OpenSyncOptions): Promise<OpenSyncRuntime> {
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
    const requiredProviders = new Set(
      options.definitions.flatMap(({ definition }) =>
        definition.provider ? [definition.provider.service] : [],
      ),
    );
    if (requiredProviders.size) {
      const available = new Set((await management.catalog()).map((entry) => entry.service));
      for (const service of requiredProviders) {
        if (!available.has(service)) {
          throw new Error(
            `Open Sync provider ${JSON.stringify(service)} is unavailable. Include it in getOpenSyncBuildOptions({ providers }) and rebuild.`,
          );
        }
      }
    }
    const client = createConnectorClient({
      fetch: transport,
      baseUrl: publicUrl,
      adminToken,
      runtimeToken,
      authorizeConnection: (input) =>
        repository.owns({ ...input, connectorId: input.connection.id }),
    });
    engine = createSyncRuntime({
      definitions: options.definitions,
      destinationTypes: options.destinationTypes,
      limits: options.limits,
      onEvent: options.onEvent,
      timing: executionTiming(options),
      databasePath: join(options.dataDirectory, 'sync.db'),
      assetDirectory: options.assetDirectory ?? join(options.dataDirectory, 'queued-assets'),
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
      registrations: options.oauthClientRegistrations,
      onConnected: options.onProviderConnected,
      returnUrl: (input) =>
        `${publicUrl}/providers/${encodeURIComponent(input.service)}/return/${input.id}`,
    });
    const api = syncApi(engine.api);
    const http = createHttpApp({
      prefix,
      api,
      providers,
      authorize: options.authorize,
      authorizationRedirect: options.authorizationRedirect,
    });
    let closing: Promise<void> | undefined;
    const runtime = engine;
    const database = references;
    return {
      api,
      providers: providerApi(providers),
      start: () => runtime.start(),
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
export interface OpenSyncRuntime {
  api: SyncApi;
  providers: ProviderApi;
  fetch(request: Request): Promise<Response>;
  start(): void;
  close(): Promise<void>;
}
export type { ProviderApi, SyncApi } from './api';

function executionTiming(options: OpenSyncOptions) {
  const timeoutMs = options.executionTimeoutMs ?? defaultTiming.timeoutMs;
  return {
    timeoutMs,
    leaseMs: timeoutMs + defaultTiming.timeoutMs,
    sourceConcurrency: options.sourceConcurrency ?? defaultTiming.sourceConcurrency,
    deliveryConcurrency: options.deliveryConcurrency ?? defaultTiming.deliveryConcurrency,
  };
}
