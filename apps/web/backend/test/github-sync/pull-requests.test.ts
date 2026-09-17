import { expect, test } from 'bun:test';
import { createSyncRuntime } from '@open-sync/core/engine';
import { fixture, graphPage, owner } from './fixture';

test('GitHub pages resume after failure and restart, deliver once, and detect edits on a full rescan', async () => {
  const f = await fixture();
  const resource = { ...owner, id: f.installation.id };
  try {
    f.provider.respond = (after) => {
      if (after) {
        throw new Error('Provider unavailable');
      }
      return graphPage({ after });
    };
    await f.engine.tick();
    expect(f.engine.api.installation(resource).checkpoint).toEqual({
      cursor: 'next',
      accountId: 'github-native-user-1',
      scanned: 2,
      total: 3,
    });
    await f.engine.close();
    f.provider.respond = (after) => graphPage({ after });
    const resumed = createSyncRuntime(f.options);
    try {
      resumed.api.queueRun(resource);
      await resumed.tick();
      await resumed.tick();
      expect(resumed.api.installation(resource).checkpoint).toEqual({
        cursor: null,
        accountId: 'github-native-user-1',
        scanned: 3,
        total: 3,
      });
      expect(f.requests).toEqual([null, 'next', 'next']);
      await resumed.tick();
      const allRecords = 3;
      expect((await f.receiver.status(owner)).records).toBe(allRecords);
      expect(f.logs.flatMap((log) => log.deliverable.records).map((record) => record.id)).toEqual([
        'a',
        'b',
        'c',
      ]);
      const before = f.logs.length;
      resumed.api.queueRun(resource);
      await resumed.tick();
      await resumed.tick();
      expect(f.logs).toHaveLength(before);
      f.provider.respond = (after) => graphPage({ after, changed: !after });
      resumed.api.queueRun(resource);
      await resumed.tick();
      await resumed.tick();
      expect(f.logs.at(-1)!.deliverable.records).toMatchObject([
        { id: 'a', revision: 2, data: { body: 'Edited years later' } },
      ]);
      expect(resumed.api.status(owner).queue.pendingRecords).toBe(0);
    } finally {
      await resumed.close();
    }
  } finally {
    await f.close();
  }
});

test('partial GraphQL results, repeated cursors, and a changed account cannot advance a GitHub checkpoint', async () => {
  const f = await fixture();
  const resource = { ...owner, id: f.installation.id };
  try {
    f.provider.respond = (after) =>
      after
        ? { status: 200, data: { errors: [{ type: 'RATE_LIMITED' }], data: { viewer: null } } }
        : graphPage({ after });
    await f.engine.tick();
    const committed = f.engine.api.installation(resource).checkpoint;
    for (const failure of [
      graphPage({ after: null }),
      graphPage({ after: 'next', accountId: 'different-account' }),
    ]) {
      f.provider.respond = () => failure;
      f.engine.api.queueRun(resource);
      await f.engine.tick();
      expect(f.engine.api.installation(resource).checkpoint).toEqual(committed);
      expect(f.engine.api.installation(resource).status).toBe('execution_failed');
    }
    expect((await f.receiver.status(owner)).records).toBe(2);
  } finally {
    await f.close();
  }
});
