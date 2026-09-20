import type { OpenSyncRuntime, Scope } from '@context-use/open-sync';

import { BadRequestError } from '#backend/lib/errors.ts';

const pollIntervalMs = 900_000;

export class DashboardService {
  constructor(
    private readonly sync: {
      api: OpenSyncRuntime['api'];
      providers: Pick<OpenSyncRuntime['providers'], 'status'>;
    },
  ) {}

  async create(input: Scope & { source: string; destination: string }) {
    const definition = this.sync.api.definitions(input).find((entry) => entry.id === input.source);
    const type = this.sync.api
      .destinationTypes(input)
      .find((entry) => entry.type === input.destination);
    if (!definition || type?.type !== 'local') {
      throw new BadRequestError('Select an available source and destination.');
    }
    const provider = definition.provider
      ? await this.sync.providers.status({ ...input, service: definition.provider.service })
      : undefined;
    const account = provider?.connections.find((connection) => connection.status === 'active');
    const connection =
      account && definition.provider
        ? { id: account.id, service: definition.provider.service }
        : undefined;
    const destination =
      this.sync.api.destinations(input).find((entry) => entry.type === type.type) ??
      this.sync.api.createDestination({ ...input, type: type.type, config: {} });
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
      const active = latest.connections.find((entry) => entry.status === 'active');
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

  async connectWaiting(input: Scope & { connection: { id: string; service: string } }) {
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
