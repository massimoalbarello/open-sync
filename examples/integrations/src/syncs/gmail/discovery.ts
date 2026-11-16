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

interface DiscoveryInput {
  context: SyncContext;
  checkpoint: z.infer<typeof checkpointSchema>;
  labelIds: string[];
}

export function discover(input: DiscoveryInput) {
  return input.checkpoint.query !== null ? discoverBackfill(input) : discoverHistory(input);
}

async function discoverBackfill(input: DiscoveryInput) {
  const { context, checkpoint, labelIds } = input;
  const query = {
    maxResults: pageSize,
    ...(checkpoint.pageToken ? { pageToken: checkpoint.pageToken } : {}),
  };
  const labelIndex = checkpoint.labelIndex ?? 0;
  if (labelIds.length && labelIndex >= labelIds.length) {
    throw new Error('Gmail backfill label position is invalid.');
  }
  const page = z
    .object({
      threads: z.array(z.object({ id: z.string().min(1) })).default([]),
      nextPageToken: z.string().nullable().optional(),
    })
    .parse(
      await request({
        context,
        path: '/users/me/threads',
        // One native label filter at a time gives OR semantics without search-name escaping.
        query: {
          ...query,
          q: checkpoint.query,
          ...(labelIds.length ? { labelIds: [labelIds[labelIndex]!] } : {}),
        },
      }),
    );
  const next = continuation({ next: page.nextPageToken, checkpoint });
  const moreLabels = labelIndex + 1 < labelIds.length;
  const { labelIndex: _previousLabelIndex, ...position } = checkpoint;
  return {
    ids: page.threads.map((thread) => thread.id),
    checkpoint: {
      ...position,
      query: next || moreLabels ? checkpoint.query : null,
      pageToken: next,
      ...(labelIds.length && (next || moreLabels)
        ? { labelIndex: next ? labelIndex : labelIndex + 1 }
        : {}),
    },
    complete: false,
  };
}

async function discoverHistory(input: DiscoveryInput) {
  const { context, checkpoint } = input;
  const query = {
    maxResults: pageSize,
    ...(checkpoint.pageToken ? { pageToken: checkpoint.pageToken } : {}),
  };
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
    checkpoint: {
      ...checkpoint,
      pageToken: continuation({ next: page.nextPageToken, checkpoint }),
      historyId: page.nextPageToken ? checkpoint.historyId : page.historyId,
    },
    complete: !page.nextPageToken,
  };
}

function continuation(input: {
  next?: string | null;
  checkpoint: z.infer<typeof checkpointSchema>;
}) {
  if (input.next && input.next === input.checkpoint.pageToken) {
    throw new Error('Gmail returned incomplete pagination.');
  }
  return input.next || null;
}
