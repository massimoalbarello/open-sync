import { fail, SyncError } from '../../models/error';
import { oauthClientValues, publicConnection } from '../../models/provider-values';
import type {
  ConnectorManagement,
  ProviderScope,
  ProviderSetup as RuntimeProviderSetup,
} from '../../models/providers';
import { identifier } from '../../models/validation';
import type { ProviderRepository } from '../../repositories/providers/contract';

export class ProviderService {
  constructor(
    private readonly input: {
      repository: ProviderRepository;
      connector: ConnectorManagement;
      returnUrl(input: { service: string; id: string }): string;
      canConfigure(scope: ProviderScope): Promise<boolean>;
      signal: AbortSignal;
    },
  ) {}

  private guard(scope: ProviderScope) {
    this.input.signal.throwIfAborted();
    identifier(scope.ownerId);
    identifier(scope.actorId);
  }
  async connections(scope: ProviderScope) {
    this.guard(scope);
    return (await this.input.repository.list(scope)).map(({ id, service, account }) => ({
      id,
      service,
      account,
    }));
  }
  async connection(input: ProviderScope & { id: string }) {
    this.guard(input);
    const connection = await this.input.repository.connection(input);
    if (!connection) {
      fail('not_found');
    }
    return { id: connection.id, service: connection.service, account: connection.account };
  }
  async catalog(scope: ProviderScope) {
    this.guard(scope);
    const providers = await this.input.connector.catalog();
    return providers.map(({ service, displayName, iconUrl, authTypes, categories, scenario }) => ({
      service,
      displayName,
      iconUrl,
      authTypes,
      categories,
      scenario,
    }));
  }
  private async setup(service: string): Promise<RuntimeProviderSetup> {
    const setup = await this.input.connector.call({
      path: `/v1/providers/${encodeURIComponent(service)}/setup`,
    });
    return setup as unknown as RuntimeProviderSetup;
  }
  async status(input: ProviderScope & { service: string }) {
    this.guard(input);
    const provider = (await this.catalog(input)).find((entry) => entry.service === input.service);
    if (!provider) {
      fail('not_found');
    }
    const setup = await this.setup(input.service);
    const connections = await this.input.repository.list(input);
    return {
      provider,
      setup,
      connections: await Promise.all(
        connections
          .filter((connection) => connection.service === input.service)
          .map(async ({ id, account, connectorId }) => {
            const metadata = await this.input.connector
              .call({ path: `/v1/connections/by-id/${encodeURIComponent(connectorId)}` })
              .catch(() => null);
            const status =
              metadata?.id === connectorId &&
              metadata.service === input.service &&
              (metadata.status === 'active' || metadata.status === 'reauth_required')
                ? metadata.status
                : 'unknown';
            return { id, account, status };
          }),
      ),
    };
  }
  async configure(input: ProviderScope & { service: string; values: Record<string, string> }) {
    this.guard(input);
    if (!(await this.input.canConfigure(input))) {
      fail('forbidden');
    }
    const setup = await this.setup(input.service);
    const auth = setup.auth.find((method) => method.type === 'oauth2');
    if (!auth) {
      throw new SyncError({
        code: 'provider_request_failed',
        message: 'This provider does not support OAuth.',
      });
    }
    await this.input.connector.call({
      path: `/api/oauth/configs/${encodeURIComponent(input.service)}`,
      method: 'PUT',
      body: oauthClientValues({ auth, values: input.values }),
    });
    return { configured: true };
  }
  async start(input: ProviderScope & { service: string; authorizationOptionIds?: string[] }) {
    this.guard(input);
    const id = `connection_${crypto.randomUUID()}`;
    const result = await this.input.connector.call({
      path: `/v1/connections/${encodeURIComponent(input.service)}/connect`,
      method: 'POST',
      body: {
        returnUri: this.input.returnUrl({ service: input.service, id }),
        authorizationOptionIds: input.authorizationOptionIds,
      },
    });
    if (
      typeof result.authorizationUrl !== 'string' ||
      typeof result.connectionRequestId !== 'string'
    ) {
      throw new SyncError({
        code: 'provider_request_failed',
        message: 'Incomplete authorization response.',
      });
    }
    this.input.signal.throwIfAborted();
    await this.input.repository.start({ ...input, id, requestId: result.connectionRequestId });
    return { authorizationUrl: result.authorizationUrl };
  }
  async credentials(
    input: ProviderScope & {
      service: string;
      authType: 'api_key' | 'custom_credential';
      values: Record<string, string>;
    },
  ) {
    this.guard(input);
    const { apiKey, ...extra } = input.values;
    const result = await this.input.connector.call({
      path: `/v1/connections/${encodeURIComponent(input.service)}/connect/${input.authType === 'api_key' ? 'api-key' : 'custom-credential'}`,
      method: 'POST',
      body: input.authType === 'api_key' ? { apiKey, extra } : { values: input.values },
    });
    const connection = publicConnection({ metadata: result, service: input.service });
    this.input.signal.throwIfAborted();
    await this.input.repository.add({
      actorId: input.actorId,
      ownerId: input.ownerId,
      id: `connection_${crypto.randomUUID()}`,
      ...connection,
    });
    return { connected: true };
  }
  async complete(input: ProviderScope & { service: string; id: string }): Promise<void> {
    this.guard(input);
    const existing = await this.input.repository.connection(input);
    if (existing?.service === input.service) {
      return;
    }
    const pending = await this.input.repository.pending(input);
    if (!pending || pending.service !== input.service) {
      fail('not_found');
    }
    const result = await this.input.connector.call({
      path: `/v1/connection-requests/${encodeURIComponent(pending.requestId)}`,
    });
    if (result.status !== 'connected' || typeof result.appId !== 'string') {
      throw new SyncError({
        code: 'provider_request_failed',
        message: 'Authorization did not complete. Connect again to retry.',
      });
    }
    const metadata = await this.input.connector.call({
      path: `/v1/connections/by-id/${encodeURIComponent(result.appId)}`,
    });
    const connection = publicConnection({ metadata, service: input.service });
    if (connection.connectorId !== result.appId) {
      throw new SyncError({ code: 'provider_request_failed', message: 'Invalid connection.' });
    }
    this.input.signal.throwIfAborted();
    await this.input.repository.complete({ ...input, ...connection });
    if (!(await this.input.repository.connection(input))) {
      fail('not_found');
    }
  }
}
