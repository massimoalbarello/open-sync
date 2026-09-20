import type { OpenSyncRuntime, Scope } from '@context-use/open-sync';
import { httpEndpointSchema } from '@open-sync/examples/destinations/http';

import { BadRequestError } from '#backend/lib/errors.ts';

const pollIntervalMs = 900_000;
export type CreateSync = { source: string } & (
  | { destination: 'local' }
  | { destination: 'http'; endpoint: string; apiKey: string }
);

export class DashboardService {
  constructor(
    private readonly sync: {
      api: OpenSyncRuntime['api'];
      providers: Pick<OpenSyncRuntime['providers'], 'status'>;
      sealDestinationKey(input: { ownerId: string; endpoint: string; apiKey: string }): string;
    },
  ) {}

  async create(input: Scope & CreateSync) {
    const definition = this.sync.api.definitions(input).find((entry) => entry.id === input.source);
    const type = this.sync.api
      .destinationTypes(input)
      .find((entry) => entry.type === input.destination);
    if (!definition || !type) {
      throw new BadRequestError('Select an available source and destination.');
    }
    const provider = definition.provider
      ? await this.sync.providers.status({ ...input, service: definition.provider.service })
      : undefined;
    const account = provider?.connections.find(
      (connection) => connection.status === 'active' && connection.authType === 'oauth2',
    );
    const connection =
      account && definition.provider
        ? { id: account.id, service: definition.provider.service }
        : undefined;
    const destination = this.destination(input);
    let installation = await this.sync.api.createInstallation({
      ...input,
      definition,
      destinationId: destination.id,
      config: {},
      connection,
      intervalMs: pollIntervalMs,
      enabled: !definition.provider || !!connection,
    });
    // Authorization may finish in another tab between the status check and persistence.
    if (definition.provider && !installation.connection) {
      const latest = await this.sync.providers.status({
        ...input,
        service: definition.provider.service,
      });
      const active = latest.connections.find(
        (entry) => entry.status === 'active' && entry.authType === 'oauth2',
      );
      if (active) {
        installation = await this.connect({
          ...input,
          id: installation.id,
          connection: { id: active.id, service: definition.provider.service },
        });
      }
    }
    return {
      id: installation.id,
      authorizeService: !installation.connection ? definition.provider?.service : undefined,
    };
  }

  private destination(input: Scope & CreateSync) {
    if (input.destination === 'local') {
      return (
        this.sync.api.destinations(input).find((entry) => entry.type === 'local') ??
        this.sync.api.createDestination({ ...input, type: 'local', config: {} })
      );
    }
    const parsed = httpEndpointSchema.safeParse(input.endpoint);
    if (!parsed.success || !input.apiKey.trim() || /[\r\n]/.test(input.apiKey)) {
      throw new BadRequestError('Enter an HTTPS endpoint and a valid API key.');
    }
    const endpoint = new URL(parsed.data).href;
    const credential = this.sync.sealDestinationKey({
      ownerId: input.ownerId,
      endpoint,
      apiKey: input.apiKey.trim(),
    });
    return this.sync.api.createDestination({
      ...input,
      type: 'http',
      config: { endpoint, credential },
    });
  }

  async connectWaiting(input: Scope & { connection: { id: string; service: string } }) {
    const status = await this.sync.providers.status({
      ...input,
      service: input.connection.service,
    });
    if (
      !status.connections.some(
        (entry) =>
          entry.id === input.connection.id &&
          entry.status === 'active' &&
          entry.authType === 'oauth2',
      )
    ) {
      return;
    }
    const definitions = this.sync.api.definitions(input);
    for (const installation of this.sync.api.installations(input)) {
      const definition = definitions.find(
        (entry) =>
          entry.id === installation.definition.id &&
          entry.version === installation.definition.version,
      );
      if (
        !installation.enabled &&
        !installation.connection &&
        definition?.provider?.service === input.connection.service
      ) {
        await this.connect({ ...input, id: installation.id });
      }
    }
  }
  private async connect(
    input: Scope & { id: string; connection: { id: string; service: string } },
  ) {
    try {
      return await this.sync.api.connectInstallation(input);
    } catch (error) {
      const saved = this.sync.api.installation(input);
      // Concurrent authorization callbacks must never replace an already bound account.
      if (saved.connection) {
        return saved;
      }
      throw error;
    }
  }
}
