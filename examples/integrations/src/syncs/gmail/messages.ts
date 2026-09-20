import type { SyncContext, SyncPage } from '@context-use/open-sync/definition';
import type { SyncRecord } from '@context-use/open-sync/delivery';
import { z } from 'zod';
import { checkpointSchema, initialCheckpoint, responseSchema } from './models';

const windowMs = 2_592_000_000;
const millisecondsPerSecond = 1000;
const pageSize = 10;

export async function* run(context: SyncContext): AsyncGenerator<SyncPage> {
  const profile = z
    .object({ emailAddress: z.string().min(1) })
    .parse(await context.provider.action({ id: 'gmail.get_profile', input: {} }));
  let checkpoint = checkpointSchema.parse(context.checkpoint);
  if (checkpoint.account && checkpoint.account !== profile.emailAddress) {
    throw new Error('Gmail account changed. Create a new sync.');
  }
  const now = Date.now();
  checkpoint = {
    ...checkpoint,
    account: profile.emailAddress,
    // Freeze the search while paging, including when the process restarts.
    query:
      checkpoint.query ??
      `after:${Math.floor((now - windowMs) / millisecondsPerSecond)} before:${Math.ceil(now / millisecondsPerSecond)}`,
  };
  const seen = new Set<string>();
  while (true) {
    context.signal.throwIfAborted();
    const response = responseSchema.parse(
      await context.provider.action({
        id: 'gmail.fetch_emails',
        input: {
          query: checkpoint.query!,
          detail: 'full',
          maxResults: pageSize,
          ...(checkpoint.pageToken ? { pageToken: checkpoint.pageToken } : {}),
        },
      }),
    );
    const next = response.nextPageToken || null;
    checkCursor({ next, previous: checkpoint.pageToken, seen });
    const records: SyncRecord[] = response.messages.map((message) => ({
      operation: 'upsert',
      kind: 'email',
      id: message.messageId,
      data: {
        subject: message.subject,
        body: message.messageText,
        from: message.sender,
        to: message.to,
        sentAt: message.messageTimestamp,
        url: `https://mail.google.com/mail/?authuser=${encodeURIComponent(profile.emailAddress)}#all/${encodeURIComponent(message.messageId)}`,
        threadId: message.threadId,
        labels: [...message.labelIds].sort(),
      },
    }));
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
