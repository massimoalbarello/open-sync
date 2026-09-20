import type { SyncContext, SyncPage } from '@context-use/open-sync/definition';
import type { SyncRecord } from '@context-use/open-sync/delivery';
import { z } from 'zod';
import {
  channelSchema,
  checkpointSchema,
  historySchema,
  initialCheckpoint,
  paginationSchema,
} from './models';
import { ExpiredCursor, request } from './request';

const windowSeconds = 2_592_000;
const millisecondsPerSecond = 1000;
const directoryPageSize = 100;
const historyPageSize = 15;

export async function* run(context: SyncContext): AsyncGenerator<SyncPage> {
  const identity = z
    .object({ team_id: z.string(), user_id: z.string(), url: z.url() })
    .parse(await request({ context, path: '/auth.test' }));
  const account = `${identity.team_id}:${identity.user_id}`;
  let checkpoint: z.infer<typeof checkpointSchema> = beginCycle({ context, account });
  while (true) {
    context.signal.throwIfAborted();
    if (!checkpoint.channels.length && checkpoint.directoryComplete) {
      yield {
        deliverable: { records: [] },
        checkpoint: { ...initialCheckpoint, account },
        complete: true,
      };
      return;
    }
    try {
      const page = checkpoint.channels.length
        ? await readHistory({ context, checkpoint, workspaceUrl: identity.url })
        : await readDirectory({ context, checkpoint });
      checkpoint = checkpointSchema.parse(page.checkpoint);
      yield page;
    } catch (error) {
      if (!(error instanceof ExpiredCursor)) {
        throw error;
      }
      checkpoint = restartPage(checkpoint);
      yield { deliverable: { records: [] }, checkpoint, complete: false };
    }
  }
}

async function readDirectory(input: {
  context: SyncContext;
  checkpoint: z.infer<typeof checkpointSchema>;
}): Promise<SyncPage> {
  const { context, checkpoint } = input;
  const response = z
    .object({
      channels: z.array(channelSchema),
      response_metadata: paginationSchema.optional(),
    })
    .parse(
      await request({
        context,
        path: '/users.conversations',
        query: {
          types: 'public_channel,private_channel',
          limit: directoryPageSize,
          ...(checkpoint.directoryCursor ? { cursor: checkpoint.directoryCursor } : {}),
        },
      }),
    );
  const cursor = response.response_metadata?.next_cursor || null;
  if (cursor && cursor === checkpoint.directoryCursor) {
    throw new Error('Slack repeated a channel cursor.');
  }
  return {
    deliverable: { records: [] },
    checkpoint: {
      ...checkpoint,
      channels: response.channels,
      directoryCursor: cursor,
      directoryComplete: !cursor,
    },
    complete: false,
  };
}

async function readHistory(input: {
  context: SyncContext;
  checkpoint: z.infer<typeof checkpointSchema>;
  workspaceUrl: string;
}): Promise<SyncPage> {
  const { context, checkpoint } = input;
  const channel = checkpoint.channels[0]!;
  const response = historySchema.parse(
    await request({
      context,
      path: '/conversations.history',
      query: {
        channel: channel.id,
        oldest: checkpoint.oldest!,
        latest: checkpoint.latest!,
        inclusive: true,
        limit: historyPageSize,
        ...(checkpoint.messageCursor ? { cursor: checkpoint.messageCursor } : {}),
      },
    }),
  );
  const cursor = response.response_metadata?.next_cursor || null;
  if ((cursor && cursor === checkpoint.messageCursor) || (response.has_more && !cursor)) {
    throw new Error('Slack returned incomplete message pagination.');
  }
  const records: SyncRecord[] = response.messages.map((message) => ({
    operation: 'upsert',
    kind: 'message',
    id: `${channel.id}:${message.ts}`,
    data: {
      body: message.text ?? '',
      author: message.user ?? message.bot_id ?? null,
      channel: channel.name ?? channel.id,
      channelId: channel.id,
      sentAt: new Date(Number(message.ts) * millisecondsPerSecond).toISOString(),
      url: new URL(
        `archives/${encodeURIComponent(channel.id)}/p${message.ts.replace('.', '')}`,
        input.workspaceUrl,
      ).href,
      threadId: message.thread_ts ? `${channel.id}:${message.thread_ts}` : null,
    },
  }));
  return {
    deliverable: { records },
    checkpoint: {
      ...checkpoint,
      messageCursor: cursor,
      channels: cursor ? checkpoint.channels : checkpoint.channels.slice(1),
    },
    complete: false,
  };
}

function beginCycle(input: { context: SyncContext; account: string }) {
  const checkpoint = checkpointSchema.parse(input.context.checkpoint);
  if (checkpoint.account && checkpoint.account !== input.account) {
    throw new Error('Slack account changed. Create a new sync.');
  }
  const now = Date.now() / millisecondsPerSecond;
  return {
    ...checkpoint,
    account: input.account,
    oldest: checkpoint.oldest ?? String(now - windowSeconds),
    latest: checkpoint.latest ?? String(now),
  };
}

function restartPage(checkpoint: z.infer<typeof checkpointSchema>) {
  const cursor = checkpoint.channels.length ? checkpoint.messageCursor : checkpoint.directoryCursor;
  if (!cursor) {
    throw new Error('Slack rejected a request without a cursor.');
  }
  // Revisit committed records after cursor expiry; stable IDs make replay safe.
  return checkpoint.channels.length
    ? { ...checkpoint, messageCursor: null }
    : { ...checkpoint, directoryCursor: null };
}
