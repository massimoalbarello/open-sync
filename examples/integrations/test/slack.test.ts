import { expect, test } from 'bun:test';
import type { ProviderResponse } from '@context-use/open-sync/definition';
import type { JsonObject } from '@context-use/open-sync/json';
import { slackThreads } from '../src/syncs/slack/definition';
import { fixture, owner, unused } from './fixture';

const rootTs = '1750000000.000001';
const root = { ts: rootTs, text: 'Lunch?', user: 'alice', reply_count: 2 };
const reply = (input: { ts: string; text: string }) => ({
  ...input,
  thread_ts: rootTs,
  user: 'bob',
});
const response = (body: JsonObject): Promise<ProviderResponse> =>
  Promise.resolve({ status: 200, headers: {}, body: { ok: true, ...body } });

test('Slack captures private files and preserves external limitations without retaining download URLs', async () => {
  const f = await fixture({
    registration: slackThreads,
    provider: {
      action: unused,
      download: ({ id, input, fileField }) => {
        expect({ id, input, fileField }).toEqual({
          id: 'slack.download_file',
          input: { fileId: 'F1' },
          fileField: 'file',
        });
        return Promise.resolve(new Blob(['private file']).stream());
      },
      post: unused,
      get: ({ path }) => {
        if (path === '/auth.test') {
          return response({ team_id: 'team', user_id: 'alice', url: 'https://example.slack.com/' });
        }
        if (path === '/users.conversations') {
          return response({ channels: [{ id: 'a' }] });
        }
        if (path === '/conversations.history') {
          return response({
            messages: [
              {
                ts: rootTs,
                text: 'Files',
                files: [
                  { id: 'F1', name: 'same.pdf', url_private: 'https://private.example/secret' },
                  { id: 'F2', name: 'same.pdf', is_external: true },
                ],
              },
            ],
          });
        }
        return unused();
      },
    },
  });
  try {
    await f.engine.tick();
    expect(
      Object.values(f.saved.checkpoint!).every(
        (value) => value === null || typeof value !== 'object',
      ),
    ).toBe(true);
    expect(JSON.stringify(f.saved.checkpoint)).not.toContain('private.example');
    await f.finish();
    expect(f.records[0]).toMatchObject({
      assetRefs: { file_RjE: { id: 'F1' }, file_RjI: { id: 'F2' } },
      data: {
        messages: [
          {
            attachments: [
              { name: 'same.pdf', file: 'open-sync-asset:file_RjE' },
              { name: 'same.pdf', file: 'open-sync-asset:file_RjI' },
            ],
          },
        ],
      },
    });
    expect(f.deliveries[0]?.deliverable.assets).toMatchObject([
      { id: 'F1', size: Buffer.byteLength('private file') },
      { id: 'F2', unavailable: 'external_connection_required' },
    ]);
    expect(JSON.stringify(f.deliveries)).not.toContain('private.example');
  } finally {
    await f.close();
  }
});

test('Slack backfills historical threads across pages and restarts, preserves progress on errors, and upserts new replies on old threads', async () => {
  const directories: JsonObject[] = [];
  const history: JsonObject[] = [];
  const replies: JsonObject[] = [];
  let expire = true;
  let expireHistory = true;
  let expireDirectory = true;
  let edited = false;
  let denied = false;
  let removed = false;
  function historyResponse(query: JsonObject) {
    history.push(query);
    if (query.cursor && expireHistory) {
      expireHistory = false;
      return response({ ok: false, error: 'invalid_cursor' });
    }
    const inWindow = (message: { ts: string }) =>
      Number(message.ts) >= Number(query.oldest ?? 0) && Number(message.ts) <= Number(query.latest);
    return response(
      query.channel === 'a' && !query.cursor
        ? {
            messages: [root, reply({ ts: '1750000001.000001', text: 'Sure!' })].filter(inWindow),
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
            ].filter(inWindow),
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
            directories.push(query);
            expect(query.limit).toBe(1);
            if (query.cursor && expireDirectory) {
              expireDirectory = false;
              return response({ ok: false, error: 'invalid_cursor' });
            }
            return response(
              query.cursor
                ? { channels: [{ id: 'b', name: 'random' }] }
                : {
                    channels: [{ id: 'a', name: 'general' }],
                    response_metadata: { next_cursor: 'channels-2' },
                  },
            );
          case '/conversations.info':
            return response({
              channel: { id: query.channel!, name: query.channel === 'a' ? 'general' : 'random' },
            });
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
    const initial = f.saved.checkpoint;
    await f.engine.tick(); // The second reply page expires; the whole step remains uncommitted.
    expect(f.saved.status).toBe('execution_failed');
    expect(f.records).toHaveLength(0);
    expect(f.saved.checkpoint).toEqual(initial);
    expect(f.engine.api.status(owner).queue.pendingRecords).toBe(0);
    await f.restart();
    denied = true;
    f.queue();
    await f.engine.tick();
    expect(f.saved.status).toBe('source_http_403');
    expect(f.saved.enabled).toBe(false);
    expect(f.saved.checkpoint).toEqual(initial);
    denied = false;
    await f.engine.api.setEnabled({ ...owner, id: f.saved.id, enabled: true });
    await f.engine.tick(); // Both reply pages complete before the history cursor advances.
    expect(f.saved.checkpoint).toMatchObject({
      channelId: 'a',
      messageCursor: 'history-2',
      directoryCursor: 'channels-2',
    });
    expect(
      Object.values(f.saved.checkpoint!).every(
        (value) => value === null || typeof value !== 'object',
      ),
    ).toBe(true);
    const latest = (f.saved.checkpoint as { latest: string }).latest;
    const discovered = directories.length;
    await f.restart();
    await f.engine.tick();
    expect(history.at(-1)?.cursor).toBe('history-2');
    expect(directories).toHaveLength(discovered);
    await f.finish();
    expect(f.records.map((record) => record.id)).toEqual([
      `a:${rootTs}`,
      'a:1750000009.000001',
      `b:${rootTs}`,
    ]);
    expect(history.at(-1)?.latest).toBe(latest);
    expect(replies.every((query) => query.oldest === undefined && query.latest === undefined)).toBe(
      true,
    );
    expect(f.records[0]).toMatchObject({
      kind: 'thread',
      preview: 'Lunch?',
      createdAt: '2025-06-15T15:06:40.000Z',
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
