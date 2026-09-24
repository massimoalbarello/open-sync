import type { SyncContext } from '@context-use/open-sync/definition';
import { z } from 'zod';
import type { checkpointSchema } from './models';
import { request } from './request';

const pageSize = 1;
const threadId = z.object({ threadId: z.string().min(1) });
const historySchema = z.object({
  history: z.array(z.object({ messages: z.array(threadId).min(1) })).default([]),
  historyId: z.string().regex(/^\d+$/),
  nextPageToken: z.string().nullable().optional(),
});

export async function discover(input: {
  context: SyncContext;
  checkpoint: z.infer<typeof checkpointSchema>;
}) {
  const { context, checkpoint } = input;
  const query = {
    maxResults: pageSize,
    ...(checkpoint.pageToken ? { pageToken: checkpoint.pageToken } : {}),
  };
  if (checkpoint.query !== null) {
    const page = z
      .object({
        threads: z.array(z.object({ id: z.string().min(1) })).default([]),
        nextPageToken: z.string().nullable().optional(),
      })
      .parse(
        await request({
          context,
          path: '/users/me/threads',
          query: { ...query, q: checkpoint.query },
        }),
      );
    return {
      ids: page.threads.map((thread) => thread.id),
      next: page.nextPageToken || null,
      historyId: checkpoint.historyId!,
    };
  }
  const page = historySchema.parse(
    await request({
      context,
      path: '/users/me/history',
      query: { ...query, startHistoryId: checkpoint.historyId! },
    }),
  );
  if (BigInt(page.historyId) < BigInt(checkpoint.historyId!)) {
    throw new Error('Gmail history moved backwards.');
  }
  return {
    ids: [
      ...new Set(
        page.history.flatMap((event) => event.messages.map((message) => message.threadId)),
      ),
    ],
    next: page.nextPageToken || null,
    historyId: page.historyId,
  };
}
