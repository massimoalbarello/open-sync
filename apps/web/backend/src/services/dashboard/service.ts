import type { OpenSyncRuntime, Scope } from '@context-use/open-sync';
import type { JsonObject } from '@context-use/open-sync/json';

import { BadRequestError } from '#backend/lib/errors.ts';

const pollIntervalMs = 900_000;
export type CreateSync = {
  source: string;
  connectionId?: string;
  destination: { type: string; input: JsonObject };
};

export class DashboardService {
  constructor(
    private readonly sync: {
      api: OpenSyncRuntime['api'];
      providers: Pick<OpenSyncRuntime['providers'], 'status'>;
    },
  ) {}

  async create(input: Scope & CreateSync) {
    const scope = { actorId: input.actorId, ownerId: input.ownerId };
    const definition = this.sync.api.definitions(scope).find((entry) => entry.id === input.source);
    const type = this.sync.api
      .destinationTypes(scope)
      .find((entry) => entry.type === input.destination.type);
    if (!definition || !type) {
      throw new BadRequestError('Select an available source and destination.');
    }
    const connection = definition.provider
      ? await this.selectAccount({
          ...scope,
          service: definition.provider.service,
          connectionId: input.connectionId,
        })
      : undefined;
    if (input.connectionId && !connection) {
      throw new BadRequestError('Select a connected account for this source.');
    }
    const destination = await this.sync.api.setupDestination({
      ...scope,
      type: input.destination.type,
      input: input.destination.input,
    });
    let installation = await this.sync.api.createInstallation({
      ...scope,
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
        ...scope,
        service: definition.provider.service,
      });
      const active = latest.connections.find(
        (entry) => entry.status === 'active' && entry.authType === 'oauth2',
      );
      if (active) {
        installation = await this.connect({
          ...scope,
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

  private async selectAccount(input: Scope & { service: string; connectionId?: string }) {
    const status = await this.sync.providers.status(input);
    const accounts = status.connections.filter(
      (entry) => entry.status === 'active' && entry.authType === 'oauth2',
    );
    if (input.connectionId) {
      const account = accounts.find((entry) => entry.id === input.connectionId);
      if (!account) {
        throw new BadRequestError('Select a connected account for this source.');
      }
      return { id: account.id, service: input.service };
    }
    if (accounts.length > 1) {
      throw new BadRequestError('Select a connected account for this source.');
    }
    return accounts[0] ? { id: accounts[0].id, service: input.service } : undefined;
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
