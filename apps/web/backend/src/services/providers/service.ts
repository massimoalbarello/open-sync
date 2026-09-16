import type { RuntimeProviderSetup } from '@oomol-lab/open-connector';
import type { ConnectorManagement } from '#backend/lib/connector/client.ts';
import { BadRequestError, NotFoundError } from '#backend/lib/errors.ts';
import type { ProviderScope } from '#backend/models/providers.ts';
import type { ProviderRepository } from '#backend/repositories/providers/contract.ts';
import { oauthClientValues, publicConnection } from './values';

export class ProviderService {
  constructor(
    private readonly input: {
      repository: ProviderRepository;
      connector: ConnectorManagement;
      publicUrl: URL;
    },
  ) {}

  async catalog(_scope: ProviderScope) {
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
    const provider = (await this.catalog(input)).find((entry) => entry.service === input.service);
    if (!provider) {
      throw new NotFoundError();
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
    const setup = await this.setup(input.service);
    const auth = setup.auth.find((method) => method.type === 'oauth2');
    if (!auth) {
      throw new BadRequestError('This provider does not support OAuth.');
    }
    await this.input.connector.call({
      path: `/api/oauth/configs/${encodeURIComponent(input.service)}`,
      method: 'PUT',
      body: oauthClientValues({ auth, values: input.values }),
    });
    return { configured: true };
  }
  async start(input: ProviderScope & { service: string; authorizationOptionIds?: string[] }) {
    const id = `connection_${crypto.randomUUID()}`;
    const result = await this.input.connector.call({
      path: `/v1/connections/${encodeURIComponent(input.service)}/connect`,
      method: 'POST',
      body: {
        returnUri: new URL(
          `/api/providers/${encodeURIComponent(input.service)}/return/${id}`,
          this.input.publicUrl,
        ).href,
        authorizationOptionIds: input.authorizationOptionIds,
      },
    });
    if (
      typeof result.authorizationUrl !== 'string' ||
      typeof result.connectionRequestId !== 'string'
    ) {
      throw new BadRequestError('Incomplete authorization response.');
    }
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
    const { apiKey, ...extra } = input.values;
    const result = await this.input.connector.call({
      path: `/v1/connections/${encodeURIComponent(input.service)}/connect/${input.authType === 'api_key' ? 'api-key' : 'custom-credential'}`,
      method: 'POST',
      body: input.authType === 'api_key' ? { apiKey, extra } : { values: input.values },
    });
    const connection = publicConnection({ metadata: result, service: input.service });
    await this.input.repository.add({
      actorId: input.actorId,
      ownerId: input.ownerId,
      id: `connection_${crypto.randomUUID()}`,
      ...connection,
    });
    return { connected: true };
  }
  async complete(input: ProviderScope & { service: string; id: string }): Promise<void> {
    const existing = await this.input.repository.connection(input);
    if (existing?.service === input.service) {
      return;
    }
    const pending = await this.input.repository.pending(input);
    if (!pending || pending.service !== input.service) {
      throw new NotFoundError();
    }
    const result = await this.input.connector.call({
      path: `/v1/connection-requests/${encodeURIComponent(pending.requestId)}`,
    });
    if (result.status !== 'connected' || typeof result.appId !== 'string') {
      throw new BadRequestError('Authorization did not complete. Connect again to retry.');
    }
    const metadata = await this.input.connector.call({
      path: `/v1/connections/by-id/${encodeURIComponent(result.appId)}`,
    });
    const connection = publicConnection({ metadata, service: input.service });
    if (connection.connectorId !== result.appId) {
      throw new BadRequestError('Invalid connection.');
    }
    await this.input.repository.complete({ ...input, ...connection });
    if (!(await this.input.repository.connection(input))) {
      throw new NotFoundError();
    }
  }
}
