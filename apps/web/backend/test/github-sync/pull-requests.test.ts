import { expect, test } from 'bun:test';
import { fixture, owner, pull } from './fixture';

const discover = 'SyncDiscover';
const summary = 'SyncPullSummary';

test.each([
  { history: 'Last 3 months', count: 1 },
  { history: 'Last 1 year', count: 2 },
  { history: 'Last 3 years', count: 3 },
  { history: 'All', count: 4 },
])(
  'GitHub applies $history to activity and advances past excluded records',
  async ({ history, count }) => {
    const f = await fixture({ history });
    const dayMs = 86_400_000;
    const agesInDays = { older: 2000, pastThreeYears: 700, pastYear: 200, recent: 60 };
    const drainTicks = Object.keys(agesInDays).length + 1;
    f.pulls.splice(
      0,
      f.pulls.length,
      ...Object.values(agesInDays).map((days) => ({
        ...pull(String(days)),
        updatedAt: new Date(Date.now() - days * dayMs).toISOString(),
      })),
    );
    try {
      for (let tick = 0; tick < drainTicks; tick++) {
        await f.engine.tick();
      }
      expect(f.engine.api.sync({ ...owner, id: f.sync.id }).status).toBe('succeeded');
      expect((await f.receiver.status(owner)).records).toBe(count);
      expect(f.requests.filter((request) => request.query.includes(summary))).toHaveLength(count);
    } finally {
      await f.close();
    }
  },
);

test('GitHub resumes committed pages after restart, then polls only updates since its saved watermark', async () => {
  const f = await fixture();
  const resource = { ...owner, id: f.sync.id };
  try {
    const reply = f.provider.respond;
    f.provider.respond = (input) => {
      if (input.query.includes(discover) && input.variables.after) {
        throw new Error('Provider unavailable');
      }
      return reply(input);
    };
    await f.engine.tick();
    const partial = f.savedState().checkpoint;
    expect(partial).toMatchObject({
      cursor: 'cursor-b',
      accountId: 'github-native-user-1',
      watermark: null,
    });
    await f.restart();
    f.provider.respond = reply;
    f.requests.length = 0;
    f.engine.api.queueRun(resource);
    await f.engine.tick();
    await f.engine.tick();
    await f.engine.tick();
    expect(
      f.requests
        .filter((request) => request.query.includes(discover))
        .map((request) => request.variables.after),
    ).toEqual(['cursor-b']);
    const completed = f.savedState().checkpoint;
    expect(completed).toMatchObject({
      cursor: null,
      phase: 'updates',
      watermark: (partial as { cycleStartedAt: string }).cycleStartedAt,
    });
    const allRecords = 3;
    expect((await f.receiver.status(owner)).records).toBe(allRecords);
    expect((await f.receiver.records({ ...owner, offset: 0 })).records[0]).toMatchObject({
      preview: 'PR a',
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: new Date(f.pulls[0]!.updatedAt).toISOString(),
    });
    expect(
      f.delivered.flatMap((batch) => batch.deliverable.records).map((record) => record.id),
    ).toEqual(['a', 'b', 'c']);

    // An unchanged next poll stops at the timestamp boundary without hydrating old PRs.
    const before = f.delivered.length;
    f.requests.length = 0;
    f.engine.api.queueRun(resource);
    await f.engine.tick();
    await f.engine.tick();
    const discovery = f.requests.filter((request) => request.query.includes(discover));
    expect(discovery).toHaveLength(1);
    expect(discovery[0]!.query).toContain('UPDATED_AT');
    expect(f.requests.filter((request) => request.query.includes(summary))).toEqual([]);
    expect(f.delivered).toHaveLength(before);

    // An old PR edited now is returned by updated ordering and replaces the same stable record.
    f.pulls[0]!.body = 'Edited years later';
    f.pulls[0]!.updatedAt = new Date().toISOString();
    f.requests.length = 0;
    f.engine.api.queueRun(resource);
    await f.engine.tick();
    await f.engine.tick();
    expect(
      f.requests
        .filter((request) => request.query.includes(summary))
        .map((request) => request.variables.id),
    ).toEqual(['a']);
    expect(f.delivered.at(-1)!.deliverable.records).toMatchObject([
      { id: 'a', revision: 2, data: { body: 'Edited years later' } },
    ]);

    // Safety overlap may re-read a recent PR; the engine still emits no duplicate change.
    const afterEdit = f.delivered.length;
    f.engine.api.queueRun(resource);
    await f.engine.tick();
    await f.engine.tick();
    expect(f.delivered).toHaveLength(afterEdit);
    expect(f.engine.api.status(owner).queue.pendingRecords).toBe(0);
  } finally {
    await f.close();
  }
});

test('partial results, repeated cursors and changed accounts cannot advance GitHub progress', async () => {
  const f = await fixture();
  const resource = { ...owner, id: f.sync.id };
  try {
    const reply = f.provider.respond;
    f.provider.respond = (input) =>
      input.query.includes(discover) && input.variables.after
        ? {
            status: 200,
            headers: {},
            body: { errors: [{ type: 'RATE_LIMITED' }], data: { viewer: null } },
          }
        : reply(input);
    await f.engine.tick();
    await f.engine.tick();
    await f.engine.tick();
    const committed = f.savedState().checkpoint;
    f.provider.respond = (input) =>
      reply(input.query.includes(discover) ? { ...input, variables: { after: null } } : input);
    f.engine.api.queueRun(resource);
    await f.engine.tick();
    expect(f.savedState()).toMatchObject({
      checkpoint: committed,
      status: 'execution_failed',
    });
    f.provider.respond = reply;
    f.provider.accountId = 'different-account';
    f.engine.api.queueRun(resource);
    await f.engine.tick();
    expect(f.savedState()).toMatchObject({
      checkpoint: committed,
      status: 'execution_failed',
    });
    expect((await f.receiver.status(owner)).records).toBe(2);
  } finally {
    await f.close();
  }
});

test('cursor recovery preserves account and cycle identity after a committed page', async () => {
  const f = await fixture();
  const resource = { ...owner, id: f.sync.id };
  try {
    const reply = f.provider.respond;
    f.provider.respond = (input) =>
      input.query.includes(discover) && input.variables.after
        ? { status: 200, headers: {}, body: { errors: [{ type: 'INVALID_CURSOR_ARGUMENTS' }] } }
        : reply(input);
    await f.engine.tick();
    await f.engine.tick();
    expect(f.savedState().checkpoint).toMatchObject({
      cursor: null,
      accountId: 'github-native-user-1',
      watermark: null,
    });
    await f.restart();
    f.provider.respond = reply;
    f.provider.accountId = 'different-account';
    const checkpoint = f.savedState().checkpoint;
    f.engine.api.queueRun(resource);
    await f.engine.tick();
    expect(f.savedState()).toMatchObject({
      checkpoint,
      status: 'execution_failed',
    });
  } finally {
    await f.close();
  }
});

test('an interrupted incremental poll retains its watermark and resumes the next complete page', async () => {
  const f = await fixture();
  const resource = { ...owner, id: f.sync.id };
  try {
    await f.engine.tick();
    await f.engine.tick();
    await f.engine.tick();
    await f.engine.tick();
    const baseline = f.savedState().checkpoint as { watermark: string };
    const updatedAt = new Date().toISOString();
    f.pulls[0]!.updatedAt = updatedAt;
    f.pulls[1]!.updatedAt = updatedAt;
    f.pulls[2]!.updatedAt = updatedAt;
    f.pulls[0]!.body = 'Updated A';
    f.pulls[1]!.body = 'Updated B';
    const reply = f.provider.respond;
    f.provider.respond = (input) => {
      if (input.query.includes(summary) && input.variables.id === 'c') {
        throw new Error('Interrupted');
      }
      return reply(input);
    };
    f.engine.api.queueRun(resource);
    await f.engine.tick();
    await f.engine.tick();
    const partial = f.savedState().checkpoint as { cycleStartedAt: string };
    expect(partial).toMatchObject({ cursor: 'cursor-b', watermark: baseline.watermark });
    await f.restart();
    f.provider.respond = reply;
    f.requests.length = 0;
    f.engine.api.queueRun(resource);
    await f.engine.tick();
    await f.engine.tick();
    expect(
      f.requests
        .filter((request) => request.query.includes(summary))
        .map((request) => request.variables.id),
    ).toEqual(['c']);
    expect(f.savedState().checkpoint).toMatchObject({
      cursor: null,
      watermark: partial.cycleStartedAt,
    });
    expect(
      f.delivered
        .flatMap((batch) => batch.deliverable.records)
        .filter((record) => record.revision === 2)
        .map((record) => record.id),
    ).toEqual(['a', 'b', 'c']);
  } finally {
    await f.close();
  }
});

test('GitHub commits no partial page when a later record fails, then retries the whole page after restart', async () => {
  const f = await fixture();
  const resource = { ...owner, id: f.sync.id };
  try {
    const checkpoint = f.savedState().checkpoint;
    const respond = f.provider.respond;
    f.provider.respond = (input) => {
      if (input.query.includes(summary) && input.variables.id === 'b') {
        throw new Error('Second record failed');
      }
      return respond(input);
    };
    await f.engine.tick();
    expect(f.savedState()).toMatchObject({
      checkpoint,
      checkpointRevision: 0,
    });
    expect(f.engine.api.status(owner).queue.pendingRecords).toBe(0);
    expect((await f.receiver.status(owner)).records).toBe(0);
    await f.restart();
    f.provider.respond = respond;
    f.requests.length = 0;
    f.engine.api.queueRun(resource);
    await f.engine.tick();
    const saved = f.savedState();
    expect(saved.checkpoint).toMatchObject({ cursor: 'cursor-b' });
    expect(
      Object.values(saved.checkpoint!).every(
        (value) => value === null || typeof value !== 'object',
      ),
    ).toBe(true);
    expect(saved.checkpointRevision).toBe(1);
    expect(f.engine.api.status(owner).queue.pendingRecords).toBe(2);
    await f.engine.tick();
    await f.engine.tick();
    expect(
      f.requests
        .filter((request) => request.query.includes(summary))
        .map((request) => request.variables.id),
    ).toEqual(['a', 'b', 'c']);
    expect(
      f.delivered.map((batch) => batch.deliverable.records.map((record) => record.id)),
    ).toEqual([['a', 'b'], ['c']]);
  } finally {
    await f.close();
  }
});
