import { expect, test } from 'bun:test';
import { SourceHttpError } from '@context-use/open-sync/definition';
import type { JsonObject } from '@context-use/open-sync/json';
import { gmailThreads } from '../src/syncs/gmail/definition';
import { fixture, owner, unused } from './fixture';
import { email, profile, reply } from './gmail-fixture';

test('Gmail retries a whole thread after a later attachment fails without committing partial output', async () => {
  const unavailable = 503;
  let fail = true;
  const downloads: string[] = [];
  const messages = ['first', 'second'].map((id) =>
    email({
      id,
      threadId: 'thread',
      parts: [
        {
          partId: 'file',
          filename: `${id}.txt`,
          mimeType: 'text/plain',
          body: { attachmentId: id },
        },
      ],
    }),
  );
  const f = await fixture({
    registration: gmailThreads,
    provider: {
      post: unused,
      action: unused,
      download: ({ input }) => {
        const id = String(input.attachmentId);
        downloads.push(id);
        return fail && id === 'second'
          ? Promise.reject(new SourceHttpError({ status: unavailable }))
          : Promise.resolve(new Blob([id]).stream());
      },
      get({ path }) {
        if (path.endsWith('/profile')) {
          return reply(profile);
        }
        if (path.endsWith('/history')) {
          return reply({ historyId: '100' });
        }
        return reply(
          path.endsWith('/threads') ? { threads: [{ id: 'thread' }] } : { id: 'thread', messages },
        );
      },
    },
  });
  try {
    const initial = f.saved.checkpoint;
    await f.engine.tick();
    expect(downloads).toEqual(['first', 'second']);
    expect(f.saved).toMatchObject({
      status: 'retrying',
      errorCode: 'source_http_503',
      checkpoint: initial,
    });
    expect(f.engine.api.status(owner).queue.pendingRecords).toBe(0);
    expect(f.records).toHaveLength(0);
    await f.restart();
    fail = false;
    f.queue();
    await f.finish();
    expect(f.saved.checkpoint).toEqual({
      account: profile.emailAddress,
      query: null,
      pageToken: null,
      historyId: '100',
    });
    expect(f.records).toHaveLength(1);
    expect(f.records[0]).toMatchObject({
      id: 'thread',
      data: { messages: [{ id: 'first' }, { id: 'second' }] },
    });
    expect(f.deliveries[0]!.assets).toEqual(
      ['first', 'second'].map((id) =>
        expect.objectContaining({ id: `${id}:file`, size: id.length, sha256: expect.any(String) }),
      ),
    );
  } finally {
    await f.close();
  }
});

test('Gmail page-token recovery preserves backfill query and history boundary; expired history triggers one fresh backfill', async () => {
  let expirePage = false;
  let expireHistory = false;
  let currentHistory = '100';
  const listings: JsonObject[] = [];
  function listing(query: JsonObject) {
    listings.push(query);
    if (query.pageToken && expirePage) {
      return Promise.resolve({
        status: 400,
        headers: {},
        body: { error: { message: 'Invalid pageToken' } },
      });
    }
    return reply({
      threads: [{ id: 'thread' }],
      nextPageToken: query.pageToken ? null : 'next',
    });
  }
  const f = await fixture({
    registration: gmailThreads,
    provider: {
      post: unused,
      action: unused,
      get({ path, query = {} }) {
        if (path.endsWith('/profile')) {
          return reply({ ...profile, historyId: currentHistory });
        }
        if (path.endsWith('/history')) {
          return expireHistory
            ? Promise.resolve({ status: 404, headers: {}, body: {} })
            : reply({ historyId: currentHistory });
        }
        if (path.endsWith('/threads')) {
          return listing(query);
        }
        return reply({ id: 'thread', messages: [email({ id: 'first', threadId: 'thread' })] });
      },
    },
  });
  try {
    await f.engine.tick();
    const committed = f.saved.checkpoint;
    expirePage = true;
    currentHistory = '200';
    await f.engine.tick();
    expect(f.saved.checkpoint).toEqual({ ...committed, pageToken: null });
    await f.restart();
    expirePage = false;
    await f.finish();
    expect(listings.every((query) => query.q === committed.query)).toBe(true);
    expect(f.records).toHaveLength(1);
    expect(f.saved.checkpoint.historyId).toBe('200');
    expireHistory = true;
    f.queue();
    await f.engine.tick();
    expect(f.saved.checkpoint).toEqual({
      ...gmailThreads.definition.initialCheckpoint,
      account: profile.emailAddress,
    });
    expireHistory = false;
    currentHistory = '300';
    await f.finish();
    expect(f.saved.checkpoint.historyId).toBe('300');
    expect(f.records).toHaveLength(1);
  } finally {
    await f.close();
  }
});
