import type { SyncContext, SyncPage } from '@context-use/open-sync/definition';
import { z } from 'zod';
import { historyStart } from '../history';
import {
  channelSchema,
  checkpointSchema,
  finishChannel,
  finishThread,
  historySchema,
  initialCheckpoint,
  nextCursor,
  paginationSchema,
} from './models';
import { readThread } from './replies';
import { ExpiredCursor, request, ThreadNotFound } from './request';

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
      const page = checkpoint.threads.length
        ? await readThread({ context, checkpoint, workspaceUrl: identity.url })
        : checkpoint.channels.length
          ? await readHistory({ context, checkpoint })
          : await readDirectory({ context, checkpoint });
      checkpoint = checkpointSchema.parse(page.checkpoint);
      yield page;
    } catch (error) {
      checkpoint = recover({ checkpoint, error });
      yield { deliverable: { records: [] }, checkpoint, complete: false };
    }
  }
}

function recover(input: { checkpoint: z.infer<typeof checkpointSchema>; error: unknown }) {
  if (input.error instanceof ThreadNotFound) {
    // A thread can disappear between discovery and hydration. Keep any previously delivered copy.
    return finishThread(input.checkpoint);
  }
  if (input.error instanceof ExpiredCursor) {
    return restartPage(input.checkpoint);
  }
  throw input.error;
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
  const cursor = nextCursor({ response, previous: checkpoint.messageCursor });
  // Thread broadcasts can appear beside their parent in channel history.
  const threads = new Map(
    response.messages.map((message) => [message.thread_ts ?? message.ts, message]),
  );
  return {
    deliverable: { records: [] },
    checkpoint: finishChannel({
      ...checkpoint,
      messageCursor: cursor,
      historyComplete: !cursor,
      threads: [...threads.values()],
    }),
    complete: false,
  };
}

function beginCycle(input: { context: SyncContext; account: string }) {
  const checkpoint = checkpointSchema.parse(input.context.checkpoint);
  if (checkpoint.account && checkpoint.account !== input.account) {
    throw new Error('Slack account changed. Create a new sync.');
  }
  const now = new Date();
  const oldest = historyStart({ config: input.context.config, now });
  return {
    ...checkpoint,
    account: input.account,
    oldest: checkpoint.oldest ?? String(oldest ? oldest.getTime() / millisecondsPerSecond : 0),
    latest: checkpoint.latest ?? String(now.getTime() / millisecondsPerSecond),
  };
}

function restartPage(checkpoint: z.infer<typeof checkpointSchema>) {
  if (checkpoint.threads.length) {
    if (!checkpoint.replyCursor) {
      throw new Error('Slack rejected a request without a reply cursor.');
    }
    return { ...checkpoint, replyCursor: null, messages: [] };
  }
  const cursor = checkpoint.channels.length ? checkpoint.messageCursor : checkpoint.directoryCursor;
  if (!cursor) {
    throw new Error('Slack rejected a request without a cursor.');
  }
  // Revisit committed records after cursor expiry; stable IDs make replay safe.
  return checkpoint.channels.length
    ? { ...checkpoint, messageCursor: null }
    : { ...checkpoint, directoryCursor: null };
}
