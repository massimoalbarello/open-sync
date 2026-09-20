import { expect, test } from 'bun:test';
import type { ProviderResponse } from '@context-use/open-sync/definition';
import type { JsonObject } from '@context-use/open-sync/json';
import { slackThreads } from '../src/syncs/slack/definition';
import { fixture, unused } from './fixture';

const rootTs = '1750000000.000001';
const root = { ts: rootTs, text: 'Lunch?', user: 'alice', reply_count: 2 };
const reply = (input: { ts: string; text: string }) => ({
  ...input,
  thread_ts: rootTs,
  user: 'bob',
});
const response = (body: JsonObject): Promise<ProviderResponse> =>
  Promise.resolve({ status: 200, headers: {}, body: { ok: true, ...body } });

test('Slack emits complete threads across reply pages and restarts, preserves progress on errors, and upserts new replies', async () => {
  const history: JsonObject[] = [];
  const replies: JsonObject[] = [];
  let expire = true;
  let edited = false;
  let denied = false;
  let removed = false;
  function historyResponse(query: JsonObject) {
    history.push(query);
    return response(
      query.channel === 'a' && !query.cursor
        ? {
            messages: [root, reply({ ts: '1750000001.000001', text: 'Sure!' })],
            has_more: true,
            response_metadata: { next_cursor: 'history-2' },
          }
        : {
            messages: [
              {
                ts: query.channel === 'a' ? '1750000009.000001' : rootTs,
                text: 'Standalone',
                bot_id: 'bot',
              },
            ],
          },
    );
  }
  function replyResponse(query: JsonObject) {
    replies.push(query);
    if (removed) {
      return response({ ok: false, error: 'thread_not_found' });
    }
    if (denied) {
      return response({ ok: false, error: 'missing_scope' });
    }
    if (query.cursor && expire) {
      expire = false;
      return response({ ok: false, error: 'invalid_cursor' });
    }
    return response(
      query.cursor
        ? {
            messages: [
              reply({ ts: '1750000002.000001', text: 'See you there' }),
              ...(edited ? [reply({ ts: '1750000003.000001', text: 'Bringing Sam' })] : []),
            ],
          }
        : {
            messages: [
              root,
              reply({ ts: '1750000001.000001', text: edited ? 'At one?' : 'Sure!' }),
            ],
            has_more: true,
            response_metadata: { next_cursor: 'replies-2' },
          },
    );
  }
  const threadCount = 3;
  const f = await fixture({
    registration: slackThreads,
    provider: {
      action: unused,
      post: unused,
      get: ({ path, query = {} }) => {
        switch (path) {
          case '/auth.test':
            return response({
              team_id: 'team',
              user_id: 'alice',
              url: 'https://example.slack.com/',
            });
          case '/users.conversations':
            return response(
              query.cursor
                ? { channels: [{ id: 'b', name: 'random' }] }
                : {
                    channels: [{ id: 'a', name: 'general' }],
                    response_metadata: { next_cursor: 'channels-2' },
                  },
            );
          case '/conversations.history':
            return historyResponse(query);
          case '/conversations.replies':
            return replyResponse(query);
          default:
            return unused();
        }
      },
    },
  });
  try {
    await f.engine.tick(); // Channel directory.
    await f.engine.tick(); // Pending thread roots; no message records.
    await f.engine.tick(); // First reply page; still no partial thread delivered.
    expect(f.records).toHaveLength(0);
    expect(f.saved.checkpoint).toMatchObject({
      replyCursor: 'replies-2',
      messages: [{ id: rootTs }, { id: '1750000001.000001' }],
    });
    await f.restart();
    denied = true;
    const saved = f.saved.checkpoint;
    await f.engine.tick();
    expect(f.saved.status).toBe('execution_failed');
    expect(f.saved.checkpoint).toEqual(saved);
    denied = false;
    f.queue();
    await f.engine.tick(); // Expired reply cursor restarts only this thread.
    expect(f.saved.checkpoint).toMatchObject({ replyCursor: null, messages: [] });
    await f.finish();
    expect(f.records.map((record) => record.id)).toEqual([
      `a:${rootTs}`,
      'a:1750000009.000001',
      `b:${rootTs}`,
    ]);
    expect(history[0]?.oldest).toBe(history.at(-1)?.oldest);
    expect(replies.every((query) => query.oldest === undefined && query.latest === undefined)).toBe(
      true,
    );
    expect(f.records[0]).toMatchObject({
      kind: 'thread',
      data: {
        channel: 'general',
        channelId: 'a',
        url: 'https://example.slack.com/archives/a/p1750000000000001',
        messages: [
          { id: rootTs, body: 'Lunch?', author: 'alice' },
          { body: 'Sure!' },
          { body: 'See you there' },
        ],
      },
    });
    expect(f.records[1]).toMatchObject({
      data: { messages: [{ body: 'Standalone', author: 'bot' }] },
    });
    f.queue();
    await f.finish();
    expect(f.records).toHaveLength(threadCount);
    edited = true;
    f.queue();
    await f.engine.tick();
    await f.engine.tick();
    await f.engine.tick();
    expect(f.records).toHaveLength(threadCount);
    await f.finish();
    expect(f.records).toHaveLength(threadCount + 1);
    expect(f.records.at(-1)).toMatchObject({
      id: `a:${rootTs}`,
      revision: 2,
      data: {
        messages: [
          { body: 'Lunch?' },
          { body: 'At one?' },
          { body: 'See you there' },
          { body: 'Bringing Sam' },
        ],
      },
    });
    removed = true;
    f.queue();
    await f.finish();
    expect(f.records).toHaveLength(threadCount + 1);
  } finally {
    await f.close();
  }
});

test.each(['missing-root', 'foreign-reply', 'missing-cursor', 'repeated-cursor'])(
  'Slack does not deliver a thread with %s',
  async (mode) => {
    const f = await fixture({
      registration: slackThreads,
      provider: {
        action: unused,
        post: unused,
        get: ({ path, query = {} }) => {
          if (path === '/auth.test') {
            return response({
              team_id: 'team',
              user_id: 'alice',
              url: 'https://example.slack.com/',
            });
          }
          if (path === '/users.conversations') {
            return response({ channels: [{ id: 'a' }] });
          }
          if (path === '/conversations.history') {
            return response({ messages: [root] });
          }
          if (mode === 'missing-root') {
            return response({ messages: [reply({ ts: '1750000001.000001', text: 'Reply' })] });
          }
          if (mode === 'foreign-reply') {
            return response({ messages: [root, { ts: '1750000001.000001', thread_ts: 'other' }] });
          }
          if (mode === 'missing-cursor') {
            return response({ messages: [root], has_more: true });
          }
          return response({
            messages: query.cursor ? [reply({ ts: '1750000001.000001', text: 'Reply' })] : [root],
            has_more: true,
            response_metadata: { next_cursor: 'repeat' },
          });
        },
      },
    });
    try {
      await f.engine.tick();
      await f.engine.tick();
      if (mode === 'repeated-cursor') {
        await f.engine.tick();
      }
      const committed = f.saved.checkpoint;
      await f.engine.tick();
      expect(f.saved.status).toBe('execution_failed');
      expect(f.saved.checkpoint).toEqual(committed);
      expect(f.records).toHaveLength(0);
    } finally {
      await f.close();
    }
  },
);
