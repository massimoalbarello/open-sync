import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderResponse } from '@context-use/open-sync/definition';
import type { Deliverable } from '@context-use/open-sync/delivery';
import { createSyncRuntime } from '@context-use/open-sync/engine';
import type { JsonObject } from '@context-use/open-sync/json';
import { localDestination } from '@open-sync/examples/destinations/local';
import { githubPullRequests } from '@open-sync/examples/syncs/github';

export const owner = { actorId: 'alice', ownerId: 'alice' };
export interface GraphRequest {
  query: string;
  variables: JsonObject;
}
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
export async function fixture(config: JsonObject = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'github-sync-test-'));
  const delivered: Deliverable[] = [];
  const destinationType = localDestination({
    accept: ({ deliverable }) => {
      delivered.push(deliverable);
      return Promise.resolve();
    },
  });
  const requests: GraphRequest[] = [];
  const pulls = [pull('a'), pull('b'), pull('c')];
  const provider = { accountId: 'github-native-user-1', respond: reply };
  function reply(input: GraphRequest): ProviderResponse {
    let data: JsonObject;
    if (input.query.includes('SyncIdentity')) {
      data = { viewer: { id: provider.accountId } };
    } else if (input.query.includes('SyncPullSummary')) {
      data = { node: pulls.find((item) => item.id === input.variables.id) ?? null };
    } else if (input.query.includes('SyncDiscover')) {
      const updates = input.query.includes('UPDATED_AT');
      const ordered = updates
        ? [...pulls].sort(
            // biome-ignore lint/complexity/useMaxParams: Array.sort requires a two-value comparator.
            (a, b) => b.updatedAt.localeCompare(a.updatedAt),
          )
        : pulls;
      const start = input.variables.after
        ? ordered.findIndex((item) => `cursor-${item.id}` === input.variables.after) + 1
        : 0;
      const pageSize = 2;
      const nodes = ordered.slice(start, start + pageSize);
      data = {
        viewer: {
          pullRequests: {
            edges: nodes.map((item) => ({
              cursor: `cursor-${item.id}`,
              node: { id: item.id, updatedAt: item.updatedAt },
            })),
            pageInfo: { hasNextPage: start + nodes.length < ordered.length },
          },
        },
      };
    } else {
      throw new Error(`Unexpected query: ${input.query}`);
    }
    return { status: 200, headers: {}, body: { data } };
  }
  const gateway = {
    bind: (input: { ownerId: string }) => {
      if (input.ownerId !== owner.ownerId) {
        throw new Error('Not found');
      }
      return Promise.resolve({
        action: () => Promise.reject(new Error('Unexpected action')),
        get: () => Promise.reject(new Error('Unexpected GET')),
        post: (input: { body: JsonObject }) => {
          const request = {
            query: String(input.body.query),
            variables: input.body.variables as JsonObject,
          };
          requests.push(request);
          return Promise.resolve(provider.respond(request));
        },
      });
    },
  };
  const options = {
    databasePath: join(dir, 'sync.db'),
    definitions: [githubPullRequests],
    connector: gateway,
    destinationTypes: { local: destinationType },
  };
  let engine = createSyncRuntime(options);
  const destination = { type: 'local', input: {} };
  const sync = await engine.api.createSync({
    ...owner,
    destination,
    definition: githubPullRequests.definition.id,
    connection: { id: 'github-connection', service: 'github' },
    config,
  });
  return {
    savedState() {
      const db = new Database(options.databasePath, { readonly: true });
      try {
        const row = db
          .query<{ checkpoint: string }, string[]>(
            'SELECT checkpoint FROM syncs WHERE owner_id=? AND id=?',
          )
          .get(owner.ownerId, sync.id)!;
        return {
          ...engine.api.sync({ ...owner, id: sync.id }),
          checkpoint: JSON.parse(row.checkpoint),
        };
      } finally {
        db.close();
      }
    },
    get engine() {
      return engine;
    },
    delivered,
    requests,
    provider,
    pulls,
    sync,
    async restart() {
      await engine.close();
      engine = createSyncRuntime(options);
    },
    async close() {
      await engine.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
