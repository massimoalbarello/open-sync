import { expect, test } from 'bun:test';
import { SourceHttpError } from '@context-use/open-sync/definition';
import type { JsonObject } from '@context-use/open-sync/json';
import { gmailThreads } from '../src/syncs/gmail/definition';
import { fixture, owner, unused } from './fixture';

test('Gmail retries a whole thread after a later attachment fails without committing partial output', async () => {
  const unavailable = 503;
  let fail = true;
  const requests: JsonObject[] = [];
  const downloads: string[] = [];
  const messages = ['first', 'second'].map((id) => ({
    messageId: id,
    threadId: 'thread',
    subject: 'Complete conversation',
    sender: 'sam@example.com',
    to: 'alice@example.com',
    messageTimestamp: '2026-09-19T12:00:00.000Z',
    messageText: id,
    labelIds: [],
    payload: {
      partId: 'file',
      filename: `${id}.txt`,
      mimeType: 'text/plain',
      body: { attachmentId: id },
    },
  }));
  const f = await fixture({
    registration: gmailThreads,
    provider: {
      post: unused,
      get: unused,
      download: ({ id, input }) => {
        expect(id).toBe('gmail.download_attachment');
        const attachmentId = String(input.attachmentId);
        downloads.push(attachmentId);
        return fail && attachmentId === 'second'
          ? Promise.reject(new SourceHttpError({ status: unavailable }))
          : Promise.resolve(new Blob([attachmentId]).stream());
      },
      action: ({ id, input }) => {
        if (id === 'gmail.get_profile') {
          return Promise.resolve<JsonObject>({ emailAddress: 'alice@example.com' });
        }
        requests.push(input);
        return Promise.resolve<JsonObject>({ threads: [{ threadId: 'thread', messages }] });
      },
    },
  });
  try {
    const initial = f.saved.checkpoint;
    await f.engine.tick();
    expect(downloads).toEqual(['first', 'second']);
    expect(f.saved).toMatchObject({
      status: 'source_http_503',
      checkpoint: initial,
      checkpointRevision: 0,
    });
    expect(f.engine.api.status(owner).queue.pendingRecords).toBe(0);
    expect(f.records).toHaveLength(0);

    await f.restart();
    fail = false;
    f.queue();
    await f.finish();
    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.pageToken === undefined)).toBe(true);
    expect(f.saved.checkpointRevision).toBe(1);
    expect(f.saved.checkpoint).toEqual({
      account: 'alice@example.com',
      query: null,
      pageToken: null,
    });
    expect(f.records).toHaveLength(1);
    expect(f.records[0]).toMatchObject({
      id: 'thread',
      data: { messages: [{ id: 'first' }, { id: 'second' }] },
    });
    const record = f.records[0]!;
    if (record.operation !== 'upsert') {
      throw new Error('Expected complete thread');
    }
    expect(Object.values(record.assetRefs!)).toEqual([
      { id: 'first:file', version: '1' },
      { id: 'second:file', version: '1' },
    ]);
    expect(f.deliveries[0]?.deliverable.assets).toEqual([
      expect.objectContaining({
        id: 'first:file',
        size: expect.any(Number),
        sha256: expect.any(String),
      }),
      expect.objectContaining({
        id: 'second:file',
        size: expect.any(Number),
        sha256: expect.any(String),
      }),
    ]);
  } finally {
    await f.close();
  }
});
