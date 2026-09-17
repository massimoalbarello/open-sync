import type { Scope as ProviderScope, OpenSyncRuntime as SyncRuntime } from '@open-sync/core';
import { githubPullRequests } from '@open-sync/examples/syncs/github';
import { NotFoundError } from '#backend/lib/errors.ts';

export class GithubSyncService {
  constructor(
    private readonly input: { providers: SyncRuntime['providers']; sync: SyncRuntime['api'] },
  ) {}
  async connections(scope: ProviderScope) {
    return (await this.input.providers.connections(scope))
      .filter((connection) => connection.service === 'github')
      .map(({ id, account }) => ({ id, account }));
  }
  async create(input: ProviderScope & { id: string }) {
    const connection = await this.input.providers.connection(input);
    if (connection?.service !== 'github') {
      throw new NotFoundError();
    }
    const destination = this.input.sync.createDestination({
      ...input,
      type: 'local',
      config: {},
    });
    const intervalMs = 900_000;
    return await this.input.sync.createInstallation({
      ...input,
      destinationId: destination.id,
      definition: githubPullRequests.definition,
      connection: { id: connection.id, service: connection.service },
      config: {},
      intervalMs,
    });
  }
}
