import { expect, test } from 'bun:test';
import type { JsonObject } from '@context-use/open-sync/json';
import { gmailThreads } from '../src/syncs/gmail/definition';
import { fixture, unused } from './fixture';

const email = (input: { id: string; threadId: string; sentAt?: string }) => ({
  messageId: input.id,
  threadId: input.threadId,
  subject: 'Lunch',
  sender: 'Sam <sam@example.com>',
  to: 'alice@example.com',
  messageTimestamp: input.sentAt ?? '2026-09-19T12:00:00.000Z',
  messageText: 'Meet at noon?',
  labelIds: ['UNREAD', 'INBOX'],
  payload: { raw: 'omit me' },
});

test('Gmail resumes thread discovery, includes older context, and updates whole conversations without duplicate records', async () => {
  const requests: JsonObject[] = [];
  const threadCount = 2;
  let account = 'alice@example.com';
  let updated = false;
  const root = email({ id: 'root', threadId: 'a', sentAt: '2020-01-01T00:00:00.000Z' });
  const f = await fixture({
    registration: gmailThreads,
    provider: {
      get: unused,
      post: unused,
      action: ({ id, input }) => {
        if (id === 'gmail.get_profile') {
          return Promise.resolve<JsonObject>({ emailAddress: account });
        }
        expect(id).toBe('gmail.list_threads');
        expect(input.verbose).toBe(true);
        requests.push(input);
        return Promise.resolve<JsonObject>(
          input.pageToken
            ? { threads: [{ threadId: 'b', messages: [email({ id: 'single', threadId: 'b' })] }] }
            : {
                threads: [
                  {
                    threadId: 'a',
                    messages: [
                      ...(updated
                        ? [
                            email({
                              id: 'new-reply',
                              threadId: 'a',
                              sentAt: '2026-09-20T12:00:00.000Z',
                            }),
                          ]
                        : []),
                      {
                        ...email({ id: 'reply', threadId: 'a' }),
                        messageText: updated ? 'Meet at one?' : 'Sure!',
                      },
                      root,
                    ],
                  },
                ],
                nextPageToken: 'next',
              },
        );
      },
    },
  });
  try {
    await f.engine.tick();
    expect(f.saved.checkpoint).toMatchObject({ pageToken: 'next', account });
    await f.restart();
    await f.finish();
    expect(requests[1]?.query).toBe(requests[0]?.query);
    expect(requests[1]?.pageToken).toBe('next');
    expect(f.records.map((record) => [record.kind, record.id])).toEqual([
      ['thread', 'a'],
      ['thread', 'b'],
    ]);
    expect(f.records[0]).toMatchObject({
      preview: 'Lunch',
      createdAt: root.messageTimestamp,
      data: {
        subject: 'Lunch',
        url: 'https://mail.google.com/mail/?authuser=alice%40example.com#all/a',
        messages: [
          {
            id: 'root',
            body: 'Meet at noon?',
            from: 'Sam <sam@example.com>',
            to: 'alice@example.com',
            sentAt: root.messageTimestamp,
            labels: ['INBOX', 'UNREAD'],
          },
          { id: 'reply', body: 'Sure!' },
        ],
      },
    });
    expect(JSON.stringify(f.records)).not.toContain('omit me');
    expect(f.records[0]).not.toHaveProperty('updatedAt');
    f.queue();
    await f.finish();
    expect(f.records).toHaveLength(2);
    updated = true;
    f.queue();
    await f.finish();
    expect(f.records).toHaveLength(threadCount + 1);
    expect(f.records.at(-1)).toMatchObject({
      id: 'a',
      revision: 2,
      data: {
        messages: [{ id: 'root' }, { id: 'reply', body: 'Meet at one?' }, { id: 'new-reply' }],
      },
    });
    account = 'someone-else@example.com';
    f.queue();
    await f.engine.tick();
    expect(f.saved.status).toBe('execution_failed');
    expect(f.saved.checkpoint).toMatchObject({ account: 'alice@example.com' });
  } finally {
    await f.close();
  }
});

test('Gmail never commits an empty or mismatched thread or advances a repeated cursor', async () => {
  let mode: 'empty' | 'foreign' | 'valid' = 'empty';
  const f = await fixture({
    registration: gmailThreads,
    provider: {
      get: unused,
      post: unused,
      action: ({ id }) =>
        Promise.resolve<JsonObject>(
          id === 'gmail.get_profile'
            ? { emailAddress: 'alice@example.com' }
            : {
                threads: [
                  {
                    threadId: 'a',
                    messages:
                      mode === 'empty'
                        ? []
                        : [email({ id: 'root', threadId: mode === 'foreign' ? 'b' : 'a' })],
                  },
                ],
                nextPageToken: 'repeat',
              },
        ),
    },
  });
  try {
    for (const value of ['empty', 'foreign'] as const) {
      mode = value;
      f.queue();
      await f.engine.tick();
      expect(f.saved.status).toBe('execution_failed');
      expect(f.saved.checkpoint).toEqual(gmailThreads.definition.initialCheckpoint);
      expect(f.records).toHaveLength(0);
    }
    mode = 'valid';
    f.queue();
    await f.engine.tick();
    const committed = f.saved.checkpoint;
    await f.engine.tick();
    expect(f.saved.status).toBe('execution_failed');
    expect(f.saved.checkpoint).toEqual(committed);
  } finally {
    await f.close();
  }
});

test.each(['available', 'oversized'])(
  'Gmail preserves attachment identities and continues after an %s download',
  async (mode) => {
    const tooLarge = 413;
    const success = 200;
    const downloads: string[] = [];
    const f = await fixture({
      registration: gmailThreads,
      provider: {
        post: unused,
        get: ({ path }) => {
          downloads.push(path);
          return Promise.resolve({
            status: mode === 'oversized' ? tooLarge : success,
            headers: {},
            body: { data: Buffer.from('external').toString('base64url') },
          });
        },
        action: ({ id }) =>
          Promise.resolve<JsonObject>(
            id === 'gmail.get_profile'
              ? { emailAddress: 'alice@example.com' }
              : {
                  threads: [
                    {
                      threadId: 'a',
                      messages: [
                        {
                          ...email({ id: 'm1', threadId: 'a' }),
                          payload: {
                            parts: [
                              {
                                partId: '1',
                                filename: 'same.txt',
                                mimeType: 'text/plain',
                                body: { data: Buffer.from('inline').toString('base64url') },
                              },
                              {
                                partId: '2',
                                filename: 'same.txt',
                                mimeType: 'text/plain',
                                body: { attachmentId: 'attachment2' },
                              },
                            ],
                          },
                        },
                      ],
                    },
                  ],
                },
          ),
      },
    });
    try {
      await f.finish();
      expect(downloads).toEqual(['/users/me/messages/m1/attachments/attachment2']);
      const record = f.records[0]!;
      expect(record.operation).toBe('upsert');
      if (record.operation !== 'upsert') {
        throw new Error('Expected thread');
      }
      expect(Object.values(record.assetRefs!)).toEqual([
        { id: 'm1:1', version: '1' },
        { id: 'm1:2', version: '1' },
      ]);
      expect(JSON.stringify(record)).not.toContain(Buffer.from('inline').toString('base64url'));
      const assets = f.deliveries[0]!.deliverable.assets!;
      expect(assets[0]).toMatchObject({ id: 'm1:1', size: Buffer.byteLength('inline') });
      expect(assets[1]).toMatchObject(
        mode === 'oversized'
          ? { id: 'm1:2', unavailable: 'asset_too_large' }
          : { id: 'm1:2', size: Buffer.byteLength('external') },
      );
      if (mode === 'oversized') {
        await f.restart();
        f.queue();
        await f.finish();
        expect(downloads).toHaveLength(1);
        expect(f.records).toHaveLength(1);
      }
    } finally {
      await f.close();
    }
  },
);
