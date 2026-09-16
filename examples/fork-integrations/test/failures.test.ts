import { expect, test } from 'bun:test';
import type { Delivery } from '@open-sync/core/delivery';
import type { JsonObject } from '@open-sync/core/json';
import { engineFixture, owner } from './engine-fixture';
import type { GraphQLRequest } from './github-fixture';

const faults = [
  {
    name: 'oversized discussion',
    query: 'SyncPullRequest',
    response: () => ({
      data: {
        node: {
          id: 'PR_native',
          comments: {
            nodes: [],
            totalCount: 5001,
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    }),
  },
  {
    name: 'partial GraphQL error',
    query: 'SyncPullRequest',
    response: () => ({ errors: [{ message: 'private provider detail' }], data: { node: {} } }),
  },
  {
    name: 'missing pageInfo',
    query: 'SyncDiscover',
    response: () => ({
      data: {
        viewer: {
          pullRequests: {
            edges: [{ cursor: 'c1', node: { id: 'PR_native', updatedAt: '2026-09-01T00:00:00Z' } }],
          },
        },
      },
    }),
  },
  {
    name: 'truncated child collection',
    query: 'SyncRelated',
    response: () => ({
      data: {
        node: {
          comments: {
            nodes: [],
            totalCount: 101,
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    }),
  },
  {
    name: 'changing child count',
    query: 'SyncRelated',
    response: () => ({
      data: {
        node: {
          comments: {
            nodes: [{ id: 'new' }],
            totalCount: 102,
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    }),
  },
  {
    name: 'duplicate child identity',
    query: 'SyncRelated',
    response: () => ({
      data: {
        node: {
          comments: {
            nodes: [{ id: 'comment-0' }],
            totalCount: 101,
            pageInfo: { hasNextPage: true, endCursor: '100' },
          },
        },
      },
    }),
  },
  {
    name: 'repeated child cursor',
    query: 'SyncRelated',
    response: () => ({
      data: {
        node: {
          comments: {
            nodes: [{ id: 'new' }],
            totalCount: 101,
            pageInfo: { hasNextPage: true, endCursor: '50' },
          },
        },
      },
    }),
  },
  {
    name: 'changed parent during hydration',
    query: 'SyncVerifyPull',
    response: () => ({
      data: { node: { updatedAt: '2026-09-02T00:00:00Z', headRefOid: 'new-head' } },
    }),
  },
];

for (const fault of faults) {
  test(`${fault.name} does not advance durable progress or emit a partial record`, async () => {
    const received: Delivery[] = [];
    const harness = await engineFixture({
      version: '1',
      configSchema: { type: 'object' },
      create: () => ({
        deliver: ({ delivery }) => {
          received.push(delivery);
          return Promise.resolve({ status: 'accepted' });
        },
      }),
    });
    try {
      const reply = harness.fixture.reply;
      harness.fixture.reply = (input: GraphQLRequest) =>
        input.query.includes(fault.query) ? fault.response() : reply(input);
      await harness.engine.tick();
      expect(
        harness.engine.api.installation({ ...owner, id: harness.installation.id }),
      ).toMatchObject({ checkpointRevision: 0, status: 'execution_failed' });
      expect(harness.engine.api.status(owner).queue.pendingRecords).toBe(0);
      expect(received).toEqual([]);
      await harness.restart();
      harness.fixture.reply = reply;
      harness.engine.api.queueRun({ ...owner, id: harness.installation.id });
      await harness.engine.tick();
      await harness.engine.tick();
      expect(received).toHaveLength(1);
      expect(
        harness.engine.api.installation({ ...owner, id: harness.installation.id }).checkpoint,
      ).toMatchObject({ cursor: null, accountId: 'U_1' });
    } finally {
      await harness.close();
    }
  });
}

test('a provider failure after a committed PR resumes without duplicate changes', async () => {
  const received: Delivery[] = [];
  const harness = await engineFixture({
    version: '1',
    configSchema: { type: 'object' },
    create: () => ({
      deliver: ({ delivery }) => {
        received.push(delivery);
        return Promise.resolve({ status: 'accepted' });
      },
    }),
  });
  try {
    const reply = harness.fixture.reply;
    harness.fixture.reply = (input) => {
      if (!input.query.includes('SyncDiscover')) {
        return reply(input);
      }
      if (input.variables.after) {
        throw new Error('Provider unavailable');
      }
      return {
        data: {
          viewer: {
            pullRequests: {
              edges: [
                {
                  cursor: 'record-cursor',
                  node: { id: 'PR_native', updatedAt: '2026-09-01T00:00:00Z' },
                },
              ],
              pageInfo: { hasNextPage: true },
            },
          },
        },
      };
    };
    await harness.engine.tick();
    expect(
      harness.engine.api.installation({ ...owner, id: harness.installation.id }),
    ).toMatchObject({
      checkpointRevision: 1,
      checkpoint: { cursor: 'record-cursor' },
      status: 'execution_failed',
    });
    await harness.restart();
    harness.fixture.reply = reply;
    harness.engine.api.queueRun({ ...owner, id: harness.installation.id });
    await harness.engine.tick();
    await harness.engine.tick();
    // Explicit backfill also deduplicates the replacement record by stable identity and content.
    harness.engine.api.queueRun({ ...owner, id: harness.installation.id, backfill: true });
    await harness.engine.tick();
    await harness.engine.tick();
    expect(received).toHaveLength(1);
    expect(
      (
        harness.engine.api.installation({ ...owner, id: harness.installation.id })
          .checkpoint as JsonObject
      ).cursor,
    ).toBeNull();
  } finally {
    await harness.close();
  }
});
