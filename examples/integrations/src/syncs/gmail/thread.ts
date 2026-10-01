import type { AssetRef } from '@context-use/open-sync/assets';
import type { SyncContext } from '@context-use/open-sync/definition';
import type { SyncRecord } from '@context-use/open-sync/record';
import type { z } from 'zod';
import { gmailAttachments } from './attachments';
import { threadContent } from './content';
import type { providerThreadSchema } from './models';
export async function threadRecord(input: {
  context: SyncContext;
  thread: z.infer<typeof providerThreadSchema>;
  account: string;
}): Promise<SyncRecord> {
  const { context, thread } = input;
  if (thread.messages.some((message) => message.threadId !== thread.threadId)) {
    throw new Error('Gmail returned a message from a different thread.');
  }
  const messages = [...thread.messages].sort(
    // biome-ignore lint/complexity/useMaxParams: Array.sort passes both messages.
    (a, b) =>
      Date.parse(a.messageTimestamp) - Date.parse(b.messageTimestamp) ||
      a.messageId.localeCompare(b.messageId),
  );
  if (new Set(messages.map((message) => message.messageId)).size !== messages.length) {
    throw new Error('Gmail repeated a message in a thread.');
  }
  const assetRefs: Record<string, AssetRef> = {};
  const attached = new Map<string, Awaited<ReturnType<typeof gmailAttachments>>['attachments']>();
  for (const message of messages) {
    const result = await gmailAttachments({
      context,
      messageId: message.messageId,
      payload: message.payload,
    });
    Object.assign(assetRefs, result.refs);
    if (result.attachments.length) {
      attached.set(message.messageId, result.attachments);
    }
  }
  return {
    ...(Object.keys(assetRefs).length ? { assetRefs } : {}),
    operation: 'upsert',
    kind: 'thread',
    id: thread.threadId,
    content: threadContent(messages),
    preview: messages[0]!.subject || messages[0]!.messageText,
    createdAt: messages[0]!.messageTimestamp,
    data: {
      subject: messages[0]!.subject,
      url: `https://mail.google.com/mail/?authuser=${encodeURIComponent(input.account)}#all/${encodeURIComponent(thread.threadId)}`,
      messages: messages.map((message) => ({
        id: message.messageId,
        body: message.messageText,
        from: message.sender,
        to: message.to,
        sentAt: message.messageTimestamp,
        labels: [...message.labelIds].sort(),
        ...(attached.has(message.messageId)
          ? { attachments: attached.get(message.messageId)! }
          : {}),
      })),
    },
  };
}
