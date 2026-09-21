import { expect, test } from 'bun:test';
import { threadContent } from '../src/syncs/gmail/content';

test('the Gmail example converts HTML bodies while retaining readable plain-text messages', () => {
  const message = {
    messageId: 'one',
    threadId: 'thread',
    subject: 'Planning',
    sender: 'Alice',
    to: 'Bob',
    messageTimestamp: '2026-09-21T12:00:00Z',
    messageText: 'Plain fallback',
    labelIds: [],
  };
  const content = threadContent([
    {
      ...message,
      payload: {
        mimeType: 'multipart/alternative',
        parts: [
          {
            filename: 'attachment.html',
            mimeType: 'text/html',
            body: { data: Buffer.from('Attachment contents').toString('base64url') },
          },
          {
            mimeType: 'text/html',
            body: {
              data: Buffer.from(
                '<h2>Decisions</h2><p>Ship <strong>previews</strong>.</p><script>alert(1)</script>',
              ).toString('base64url'),
            },
          },
        ],
      },
    },
    {
      ...message,
      messageId: 'two',
      messageText: 'Follow-up *literal* text with <b>tags</b> & entities like &copy;',
    },
  ]);
  expect(content.format).toBe('markdown');
  expect(content.body).toContain('## Decisions');
  expect(content.body).toContain('**previews**');
  expect(content.body).toContain('Follow-up \\*literal\\* text');
  expect(content.body).toContain('&lt;b&gt;tags&lt;/b&gt; &amp; entities like &amp;copy;');
  expect(content.body).not.toContain('Attachment contents');
  expect(content.body).not.toContain('alert(1)');
});
