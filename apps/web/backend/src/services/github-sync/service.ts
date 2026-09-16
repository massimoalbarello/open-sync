import type { SyncRuntime } from '@open-sync/core';
import { NotFoundError } from '#backend/lib/errors.ts';
import type { ProviderScope } from '#backend/models/providers.ts';
import type { ProviderRepository } from '#backend/repositories/providers/contract.ts';
import { githubPullRequests } from './definition';

export class GithubSyncService {
  constructor(
    private readonly input: { repository: ProviderRepository; sync: SyncRuntime['api'] },
  ) {}
  async connections(scope: ProviderScope) {
    return (await this.input.repository.list(scope))
      .filter((connection) => connection.service === 'github')
      .map(({ id, account }) => ({ id, account }));
  }
  async create(input: ProviderScope & { id: string }) {
    const connection = await this.input.repository.connection(input);
    if (connection?.service !== 'github') {
      throw new NotFoundError();
    }
    const destination = this.input.sync.createDestination({
      ...input,
      type: 'local-log',
      config: {},
    });
    const intervalMs = 900_000;
    return await this.input.sync.createInstallation({
      ...input,
      destinationId: destination.id,
      definition: githubPullRequests.definition,
      connection: { id: connection.connectorId, service: connection.service },
      config: {},
      intervalMs,
    });
  }
}
