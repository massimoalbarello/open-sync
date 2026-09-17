import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Delivery } from '@open-sync/core/delivery';
import { createSyncRuntime } from '@open-sync/core/engine';
import type { JsonValue } from '@open-sync/core/json';
import { SQL } from 'bun';
import { runMigrations } from '#backend/db/migrate.ts';
import { SqliteReceiver } from '#backend/repositories/receiver/sqlite.ts';
import { githubPullRequests } from '#backend/services/github-sync/definition.ts';
import { loggingDestination } from '#backend/services/receiver/logging-destination.ts';
import { ReceiverService } from '#backend/services/receiver/service.ts';

export const owner = { actorId: 'alice', ownerId: 'alice' };
export function pull(id: string) {
  return {
    id,
    title: `PR ${id}`,
    body: 'Original description',
    number: 1,
    url: `https://github.com/example/repo/pull/${id}`,
    state: 'CLOSED',
    isDraft: false,
    createdAt: '2020-01-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    mergedAt: null,
    closedAt: '2026-09-01T00:00:00Z',
    repository: { nameWithOwner: 'example/repo' },
    author: { login: 'alice' },
  };
}
export function graphPage(input: { after: string | null; accountId?: string; changed?: boolean }) {
  const nodes = input.after ? [pull('c')] : [pull('a'), pull('b')];
  if (input.changed) {
    nodes[0]!.body = 'Edited years later';
  }
  return {
    status: 200,
    headers: {},
    data: {
      data: {
        viewer: {
          id: input.accountId ?? 'github-native-user-1',
          pullRequests: {
            edges: nodes.map((node) => ({
              node,
              cursor: input.after ? 'end' : node.id === 'a' ? 'first' : 'next',
            })),
            totalCount: 3,
            pageInfo: { hasNextPage: !input.after, endCursor: input.after ? 'end' : 'next' },
          },
        },
      },
    },
  };
}
export async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'github-sync-test-'));
  const db = new SQL({ adapter: 'sqlite', filename: join(dir, 'host.db') });
  await runMigrations({ db });
  const receiver = new ReceiverService(new SqliteReceiver(db));
  const logs: Delivery[] = [];
  const requests: (string | null)[] = [];
  const provider = {
    respond: (after: string | null): JsonValue => graphPage({ after }),
  };
  const gateway = {
    bind: (input: { ownerId: string }) => {
      if (input.ownerId !== owner.ownerId) {
        throw new Error('Not found');
      }
      return Promise.resolve({
        action: () => Promise.reject(new Error('Unexpected action')),
        get: () => Promise.reject(new Error('Unexpected GET')),
        post: (input: { body: import('@open-sync/core/json').JsonObject }) => {
          const after = (input.body.variables as { after: string | null }).after;
          requests.push(after);
          return Promise.resolve(provider.respond(after));
        },
      });
    },
  };
  const options = {
    limits: { maxPageRecords: 1 },
    databasePath: join(dir, 'sync.db'),
    definitions: [githubPullRequests],
    connector: gateway,
    destinationTypes: {
      'local-log': loggingDestination({
        destination: receiver.destination(),
        log: (delivery) => logs.push(delivery),
      }),
    },
  };
  const engine = createSyncRuntime(options);
  const destination = engine.api.createDestination({ ...owner, type: 'local-log', config: {} });
  const installation = await engine.api.createInstallation({
    ...owner,
    destinationId: destination.id,
    definition: githubPullRequests.definition,
    connection: { id: 'github-connection', service: 'github' },
    config: {},
  });
  return {
    engine,
    options,
    receiver,
    logs,
    requests,
    provider,
    installation,
    async close() {
      await engine.close();
      await db.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
