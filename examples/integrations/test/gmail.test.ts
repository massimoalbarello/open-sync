import { expect, test } from 'bun:test';
import type { JsonObject } from '@context-use/open-sync/json';
import { gmailThreads } from '../src/syncs/gmail/definition';
import { fixture, owner, unused } from './fixture';
import { email, profile, reply } from './gmail-fixture';

test('Gmail resumes backfill and history pages after restart and catches changes made during both', async () => {
  const requests: { path: string; query?: JsonObject }[] = [];
  let account = profile.emailAddress;
  let changed = false;
  let fail = false;
  const thirdRevision = 3;
  let token = '100';
  let editedDuringHistory = false;
  function historyPage(query: JsonObject) {
    if (query.startHistoryId === token) {
      return reply({ historyId: token });
    }
    if (query.pageToken && fail) {
      return Promise.resolve({ status: 503, headers: {}, body: {} });
    }
    return reply(
      query.pageToken
        ? {
            historyId: token,
            history: [
              {
                messages: [{ threadId: 'b' }, ...(editedDuringHistory ? [{ threadId: 'a' }] : [])],
              },
            ],
          }
        : {
            historyId: token,
            history: [{ messages: [{ threadId: 'a' }, { threadId: 'a' }] }],
            nextPageToken: 'history-next',
          },
    );
  }
  function threadPage(id: string) {
    return reply({
      id,
      messages: [
        email({ id: `${id}-root`, threadId: id, date: '2020-01-01T00:00:00.000Z' }),
        email({
          id: `${id}-reply`,
          threadId: id,
          text: id === 'a' && editedDuringHistory ? 'At two?' : changed ? 'At one?' : 'Sure!',
          labels: changed ? ['INBOX'] : ['UNREAD', 'INBOX'],
        }),
      ],
    });
  }
  const f = await fixture({
    registration: gmailThreads,
    provider: {
      action: unused,
      post: unused,
      get(input) {
        requests.push(input);
        const { path, query = {} } = input;
        if (path.endsWith('/profile')) {
          return reply({ emailAddress: account, historyId: token });
        }
        if (path.endsWith('/history')) {
          return historyPage(query);
        }
        if (path.endsWith('/threads')) {
          return reply(
            query.pageToken
              ? { threads: [{ id: 'b' }] }
              : { threads: [{ id: 'a' }], nextPageToken: 'backfill-next' },
          );
        }
        return threadPage(path.split('/').at(-1)!);
      },
    },
  });
  try {
    await f.engine.tick();
    const partial = f.saved.checkpoint;
    expect(partial).toMatchObject({ account, historyId: '100', pageToken: 'backfill-next' });
    await f.restart();
    changed = true; // A was already read; its reply changes while backfill is paused.
    token = '200';
    await f.engine.tick();
    expect(requests.filter((r) => r.path.endsWith('/threads')).map((r) => r.query)).toEqual([
      { maxResults: 1, q: partial.query },
      { maxResults: 1, q: partial.query, pageToken: 'backfill-next' },
    ]);
    expect(f.saved.checkpoint).toEqual({ account, query: null, pageToken: null, historyId: '100' });
    await f.engine.tick();
    const committed = f.saved.checkpoint;
    expect(committed).toMatchObject({ pageToken: 'history-next', historyId: '100' });
    fail = true;
    await f.engine.tick();
    expect(f.saved).toMatchObject({ checkpoint: committed, errorCode: 'source_http_503' });
    await f.restart();
    fail = false;
    editedDuringHistory = true;
    token = '300';
    f.queue();
    await f.finish();
    expect(f.saved.checkpoint).toEqual({ account, query: null, pageToken: null, historyId: '300' });
    expect(f.records.map((r) => [r.id, r.revision])).toEqual([
      ['a', 1],
      ['b', 1],
      ['a', 2],
      ['a', thirdRevision],
    ]);
    expect(f.records[0]).toMatchObject({
      createdAt: '2020-01-01T00:00:00.000Z',
      data: {
        subject: 'Lunch',
        messages: [{ id: 'a-root' }, { id: 'a-reply', body: 'Sure!', labels: ['INBOX', 'UNREAD'] }],
      },
    });
    expect(f.records.at(-1)).toMatchObject({
      data: { messages: [{ id: 'a-root' }, { body: 'At two?', labels: ['INBOX'] }] },
    });
    const listings = requests.filter((r) => r.path.endsWith('/threads')).length;
    f.queue();
    await f.finish();
    expect(f.records).toHaveLength(2 + 2);
    expect(requests.filter((r) => r.path.endsWith('/threads'))).toHaveLength(listings);
    expect(requests.filter((r) => r.path.endsWith('/history')).at(-1)?.query).toEqual({
      maxResults: 1,
      startHistoryId: '300',
    });
    account = 'someone-else@example.com';
    f.queue();
    await f.engine.tick();
    expect(f.saved).toMatchObject({
      errorCode: 'execution_failed',
      checkpoint: { account: profile.emailAddress, historyId: '300' },
    });
  } finally {
    await f.close();
  }
});

test.each(['empty', 'foreign', 'wrong-id', 'repeated-token'])(
  'Gmail never commits an incomplete thread or invalid continuation: %s',
  async (mode) => {
    const f = await fixture({
      registration: gmailThreads,
      provider: {
        action: unused,
        post: unused,
        get({ path }) {
          if (path.endsWith('/profile')) {
            return reply(profile);
          }
          if (path.endsWith('/threads')) {
            return reply({ threads: [{ id: 'a' }], nextPageToken: 'repeat' });
          }
          return reply({
            id: mode === 'wrong-id' ? 'b' : 'a',
            messages:
              mode === 'empty'
                ? []
                : [email({ id: 'root', threadId: mode === 'foreign' ? 'b' : 'a' })],
          });
        },
      },
    });
    try {
      if (mode === 'repeated-token') {
        await f.engine.tick();
      }
      const committed = f.saved.checkpoint;
      await f.engine.tick();
      expect(f.saved).toMatchObject({ errorCode: 'execution_failed', checkpoint: committed });
      expect(f.engine.api.status(owner).queue.pendingRecords).toBe(0);
    } finally {
      await f.close();
    }
  },
);

test('Gmail history respects the selected range and preserves missing threads without inventing deletions', async () => {
  let history = false;
  const fetched: string[] = [];
  function historyPage() {
    return reply({
      historyId: history ? '200' : '100',
      history: history
        ? [
            {
              messages: ['old', 'missing', 'recent', 'spam'].map((threadId) => ({
                threadId,
              })),
            },
          ]
        : [],
    });
  }
  const f = await fixture({
    registration: gmailThreads,
    config: { history: 'Last 3 months' },
    provider: {
      action: unused,
      post: unused,
      get({ path }) {
        if (path.endsWith('/profile')) {
          return reply(profile);
        }
        if (path.endsWith('/threads')) {
          return reply({});
        }
        if (path.endsWith('/history')) {
          return historyPage();
        }
        const id = path.split('/').at(-1)!;
        fetched.push(id);
        if (id === 'missing') {
          return Promise.resolve({ status: 404, headers: {}, body: {} });
        }
        return reply({
          id,
          messages: [
            email({
              id: `${id}-root`,
              threadId: id,
              date: id === 'old' ? '2020-01-01T00:00:00.000Z' : new Date().toISOString(),
              labels: id === 'spam' ? ['SPAM'] : ['INBOX'],
            }),
          ],
        });
      },
    },
  });
  try {
    await f.finish();
    history = true;
    f.queue();
    await f.finish();
    expect(fetched).toEqual(['old', 'missing', 'recent', 'spam']);
    expect(f.records.map((r) => [r.id, r.operation])).toEqual([['recent', 'upsert']]);
    expect(f.saved.checkpoint.historyId).toBe('200');
  } finally {
    await f.close();
  }
});
