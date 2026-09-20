import { expect, test } from 'bun:test';
import type { JsonObject } from '@context-use/open-sync/json';
import { gmailEmails } from '../src/syncs/gmail/definition';
import { fixture, unused } from './fixture';

const email = (id: string) => ({
  messageId: id,
  threadId: 'thread',
  subject: 'Lunch',
  sender: 'Sam <sam@example.com>',
  to: 'alice@example.com',
  messageTimestamp: '2026-09-19T12:00:00.000Z',
  messageText: 'Meet at noon?',
  labelIds: ['UNREAD', 'INBOX'],
  payload: { raw: 'omit me' },
});

test('Gmail resumes a frozen search after restart, emits simple emails, and revisits edits without duplicate deliveries', async () => {
  const requests: JsonObject[] = [];
  let account = 'alice@example.com';
  let body = 'Meet at noon?';
  const f = await fixture({
    registration: gmailEmails,
    provider: {
      get: unused,
      post: unused,
      action: ({ id, input }) => {
        if (id === 'gmail.get_profile') {
          return Promise.resolve<JsonObject>({ emailAddress: account });
        }
        requests.push(input);
        return Promise.resolve<JsonObject>(
          input.pageToken
            ? { messages: [{ ...email('b'), messageText: body }] }
            : { messages: [email('a')], nextPageToken: 'next' },
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
    expect(f.records.map((record) => record.id)).toEqual(['a', 'b']);
    const record = f.records[0]!;
    expect(record.operation === 'upsert' && record.data).toEqual({
      subject: 'Lunch',
      body: 'Meet at noon?',
      from: 'Sam <sam@example.com>',
      to: 'alice@example.com',
      sentAt: '2026-09-19T12:00:00.000Z',
      threadId: 'thread',
      labels: ['INBOX', 'UNREAD'],
      url: 'https://mail.google.com/mail/?authuser=alice%40example.com#all/a',
    });
    f.queue();
    await f.finish();
    expect(f.records).toHaveLength(2);
    body = 'Meet at one instead?';
    f.queue();
    await f.finish();
    expect(f.records.at(-1)).toMatchObject({ id: 'b', revision: 2, data: { body } });
    account = 'someone-else@example.com';
    f.queue();
    await f.engine.tick();
    expect(f.saved.status).toBe('execution_failed');
    expect(f.saved.checkpoint).toMatchObject({ account: 'alice@example.com' });
  } finally {
    await f.close();
  }
});

test('Gmail does not checkpoint a malformed record or a repeated page token', async () => {
  let malformed = true;
  const f = await fixture({
    registration: gmailEmails,
    provider: {
      get: unused,
      post: unused,
      action: ({ id }) =>
        Promise.resolve<JsonObject>(
          id === 'gmail.get_profile'
            ? { emailAddress: 'alice@example.com' }
            : {
                messages: [
                  {
                    ...email('a'),
                    messageTimestamp: malformed ? 'invalid' : email('a').messageTimestamp,
                  },
                ],
                nextPageToken: 'repeat',
              },
        ),
    },
  });
  try {
    await f.engine.tick();
    expect(f.saved.checkpoint).toEqual(gmailEmails.definition.initialCheckpoint);
    malformed = false;
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
