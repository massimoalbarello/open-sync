import type { SyncContext, SyncPage } from '@context-use/open-sync/definition';
import type { SyncRecord } from '@context-use/open-sync/delivery';
import { z } from 'zod';
import { historyStart } from '../history';
import { checkpointSchema, initialCheckpoint, responseSchema } from './models';

const millisecondsPerSecond = 1000;
// Commit each complete thread separately, without batching several large conversations.
const pageSize = 1;

export async function* run(context: SyncContext): AsyncGenerator<SyncPage> {
  const profile = z
    .object({ emailAddress: z.string().min(1) })
    .parse(await context.provider.action({ id: 'gmail.get_profile', input: {} }));
  let checkpoint = checkpointSchema.parse(context.checkpoint);
  if (checkpoint.account && checkpoint.account !== profile.emailAddress) {
    throw new Error('Gmail account changed. Create a new sync.');
  }
  const now = Date.now();
  const oldest = historyStart({ config: context.config, now: new Date(now) });
  checkpoint = {
    ...checkpoint,
    account: profile.emailAddress,
    // Freeze the search while paging, including when the process restarts.
    query:
      checkpoint.query ??
      `${oldest ? `after:${Math.floor(oldest.getTime() / millisecondsPerSecond)} ` : ''}before:${Math.ceil(now / millisecondsPerSecond)}`,
  };
  const seen = new Set<string>();
  while (true) {
    context.signal.throwIfAborted();
    const response = responseSchema.parse(
      await context.provider.action({
        id: 'gmail.list_threads',
        input: {
          query: checkpoint.query!,
          verbose: true,
          maxResults: pageSize,
          ...(checkpoint.pageToken ? { pageToken: checkpoint.pageToken } : {}),
        },
      }),
    );
    const next = response.nextPageToken || null;
    checkCursor({ next, previous: checkpoint.pageToken, seen });
    const records: SyncRecord[] = response.threads.map((thread) => {
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
      return {
        operation: 'upsert',
        kind: 'thread',
        id: thread.threadId,
        data: {
          subject: messages[0]!.subject,
          url: `https://mail.google.com/mail/?authuser=${encodeURIComponent(profile.emailAddress)}#all/${encodeURIComponent(thread.threadId)}`,
          messages: messages.map((message) => ({
            id: message.messageId,
            body: message.messageText,
            from: message.sender,
            to: message.to,
            sentAt: message.messageTimestamp,
            labels: [...message.labelIds].sort(),
          })),
        },
      };
    });
    checkpoint = next
      ? { ...checkpoint, pageToken: next }
      : { ...initialCheckpoint, account: profile.emailAddress };
    yield { deliverable: { records }, checkpoint, complete: !next };
    if (!next) {
      return;
    }
  }
}

function checkCursor(input: { next: string | null; previous: string | null; seen: Set<string> }) {
  if (input.next && (input.next === input.previous || input.seen.has(input.next))) {
    throw new Error('Gmail repeated a page token.');
  }
  if (input.next) {
    input.seen.add(input.next);
  }
}
