import { expect, test } from 'bun:test';
import type { ProviderResponse } from '@context-use/open-sync/definition';
import type { JsonObject } from '@context-use/open-sync/json';
import { slackMessages } from '../src/syncs/slack/definition';
import { fixture, unused } from './fixture';

test('Slack resumes channel and message pagination, recovers expired cursors and keeps channel identities separate', async () => {
  const history: JsonObject[] = [];
  let expire = true;
  let edited = false;
  let denied = false;
  function historyResponse(query: JsonObject): Promise<ProviderResponse> {
    history.push(query);
    if (denied) {
      return Promise.resolve({
        status: 200,
        headers: {},
        body: { ok: false, error: 'missing_scope' },
      });
    }
    if (expire && query.cursor) {
      expire = false;
      return Promise.resolve({
        status: 200,
        headers: {},
        body: { ok: false, error: 'invalid_cursor' },
      });
    }
    const more = query.channel === 'a' && !query.cursor;
    const body = {
      messages: [
        {
          ts: query.cursor ? '1750000001.000001' : '1750000000.000001',
          text: edited ? 'Updated' : 'Hello',
          user: 'alice',
          blocks: [{ ignored: true }],
        },
      ],
      has_more: more,
      response_metadata: { next_cursor: more ? 'messages-2' : '' },
    };
    return Promise.resolve({ status: 200, headers: {}, body: { ok: true, ...body } });
  }
  const f = await fixture({
    registration: slackMessages,
    provider: {
      action: unused,
      post: unused,
      get: ({ path, query = {} }): Promise<ProviderResponse> => {
        let body: JsonObject;
        if (path === '/auth.test') {
          body = { team_id: 'team', user_id: 'alice', url: 'https://example.slack.com/' };
        } else if (path === '/users.conversations') {
          body = query.cursor
            ? { channels: [{ id: 'b', name: 'random' }], response_metadata: { next_cursor: '' } }
            : {
                channels: [{ id: 'a', name: 'general' }],
                response_metadata: { next_cursor: 'channels-2' },
              };
        } else {
          return historyResponse(query);
        }
        return Promise.resolve({ status: 200, headers: {}, body: { ok: true, ...body } });
      },
    },
  });
  try {
    await f.engine.tick();
    await f.engine.tick();
    expect(f.saved.checkpoint).toMatchObject({ messageCursor: 'messages-2' });
    await f.restart();
    await f.finish();
    expect(f.records.map((record) => record.id)).toEqual([
      'a:1750000000.000001',
      'a:1750000001.000001',
      'b:1750000000.000001',
    ]);
    expect(history[0]?.oldest).toBe(history.at(-1)?.oldest);
    expect(f.records[0]).toMatchObject({
      data: {
        body: 'Hello',
        author: 'alice',
        channel: 'general',
        url: 'https://example.slack.com/archives/a/p1750000000000001',
      },
    });
    edited = true;
    f.queue();
    await f.finish();
    expect(f.records.at(-1)).toMatchObject({ revision: 2, data: { body: 'Updated' } });
    denied = true;
    f.queue();
    await f.engine.tick();
    const checkpoint = f.saved.checkpoint;
    await f.engine.tick();
    expect(f.saved.status).toBe('execution_failed');
    expect(f.saved.checkpoint).toEqual(checkpoint);
  } finally {
    await f.close();
  }
});
