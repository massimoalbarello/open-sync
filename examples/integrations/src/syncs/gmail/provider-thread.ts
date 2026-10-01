import type { SyncContext } from '@context-use/open-sync/definition';
import { z } from 'zod';
import { payloadSchema } from './attachments';
import { providerThreadSchema } from './models';
import { request } from './request';

const millisecondsPerSecond = 1000;
const rawMessage = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  internalDate: z.string().regex(/^\d+$/),
  labelIds: z.array(z.string()).default([]),
  payload: z
    .object({
      headers: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
    })
    .passthrough(),
});

// Gmail already parses MIME into a JSON tree; no separate MIME parser is needed here.
export async function readProviderThread(input: { context: SyncContext; id: string }) {
  const thread = z.object({ id: z.string(), messages: z.array(rawMessage).min(1) }).parse(
    await request({
      context: input.context,
      path: `/users/me/threads/${encodeURIComponent(input.id)}`,
      query: { format: 'full' },
    }),
  );
  if (thread.id !== input.id) {
    throw new Error('Gmail returned a different thread.');
  }
  return providerThreadSchema.parse({
    threadId: thread.id,
    messages: thread.messages.map((message) => {
      const header = (name: string) =>
        message.payload.headers.find((item) => item.name.toLowerCase() === name)?.value ?? '';
      const payload = payloadSchema.parse(message.payload);
      return {
        messageId: message.id,
        threadId: message.threadId,
        subject: header('subject'),
        sender: header('from'),
        to: header('to'),
        messageTimestamp: new Date(Number(message.internalDate)).toISOString(),
        messageText: textBody(payload) ?? '',
        labelIds: message.labelIds,
        payload,
      };
    }),
  });
}

export function withinHistory(input: {
  thread: Awaited<ReturnType<typeof readProviderThread>>;
  oldest: Date | null;
}) {
  return input.thread.messages.some(
    (message) =>
      !message.labelIds.some((label) => label === 'SPAM' || label === 'TRASH') &&
      (input.oldest === null ||
        Date.parse(message.messageTimestamp) >
          Math.floor(input.oldest.getTime() / millisecondsPerSecond) * millisecondsPerSecond),
  );
}

function textBody(part: z.infer<typeof payloadSchema>): string | undefined {
  if (!part || part.filename) {
    return;
  }
  if (part.body?.data !== undefined && (!part.mimeType || part.mimeType.startsWith('text/'))) {
    return Buffer.from(part.body.data, 'base64url').toString('utf8');
  }
  for (const child of part.parts ?? []) {
    const body = textBody(child);
    if (body !== undefined) {
      return body;
    }
  }
}
