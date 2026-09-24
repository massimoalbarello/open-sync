import type { SyncContext, SyncStep } from '@context-use/open-sync/definition';
import type { SyncRecord } from '@context-use/open-sync/record';
import { z } from 'zod';
import { historyStart } from '../history';
import {
  type Checkpoint,
  channelSchema,
  checkpointSchema,
  historySchema,
  initialCheckpoint,
  nextCursor,
  paginationSchema,
} from './models';
import { readThread } from './replies';
import { ExpiredCursor, request, ThreadNotFound } from './request';

const millisecondsPerSecond = 1000;
const historyPageSize = 15;

/** One history page, including every reply and asset reference, is an atomic step. */
export async function step(context: SyncContext): Promise<SyncStep> {
  const iterationStartedAt = new Date().toISOString();
  const identity = z
    .object({ team_id: z.string(), user_id: z.string(), url: z.url() })
    .parse(await request({ context, path: '/auth.test' }));
  const account = `${identity.team_id}:${identity.user_id}`;
  const saved = beginIteration({ context, account, iterationStartedAt });
  context.signal.throwIfAborted();
  try {
    const { channel, checkpoint } = await readChannel({ context, checkpoint: saved });
    const page = channel
      ? await readHistory({ context, checkpoint, channel, workspaceUrl: identity.url })
      : { records: [], cursor: null };
    const complete = !page.cursor && !checkpoint.directoryCursor;
    return {
      records: page.records,
      checkpoint: complete
        ? { ...initialCheckpoint, account }
        : {
            ...checkpoint,
            messageCursor: page.cursor,
            channelId: page.cursor ? channel!.id : null,
          },
      complete,
    };
  } catch (error) {
    return {
      records: [],
      checkpoint: recover({ checkpoint: saved, error }),
      complete: false,
    };
  }
}

async function readChannel(input: { context: SyncContext; checkpoint: Checkpoint }) {
  const { context, checkpoint } = input;
  if (checkpoint.channelId) {
    const response = z.object({ channel: channelSchema }).parse(
      await request({
        context,
        path: '/conversations.info',
        query: { channel: checkpoint.channelId },
      }),
    );
    if (response.channel.id !== checkpoint.channelId) {
      throw new Error('Slack returned a different channel.');
    }
    return { channel: response.channel, checkpoint };
  }
  const response = z
    .object({
      channels: z.array(channelSchema).max(1),
      response_metadata: paginationSchema.optional(),
    })
    .parse(
      await request({
        context,
        path: '/users.conversations',
        query: {
          types: 'public_channel,private_channel',
          limit: 1,
          ...(checkpoint.directoryCursor ? { cursor: checkpoint.directoryCursor } : {}),
        },
      }),
    );
  const cursor = response.response_metadata?.next_cursor || null;
  if (cursor && cursor === checkpoint.directoryCursor) {
    throw new Error('Slack repeated a channel cursor.');
  }
  return {
    channel: response.channels[0],
    checkpoint: { ...checkpoint, directoryCursor: cursor },
  };
}

async function readHistory(input: {
  context: SyncContext;
  checkpoint: Checkpoint;
  channel: z.infer<typeof channelSchema>;
  workspaceUrl: string;
}) {
  const { context, checkpoint, channel } = input;
  const startedAt = new Date(checkpoint.iterationStartedAt!);
  const oldest = historyStart({ config: context.config, now: startedAt });
  // History is ordered by message creation, not modification. Revisit the selected
  // range on each poll to observe edits/replies; a last-message watermark would miss them.
  // Roots outside this range, inaccessible messages, and deletions are not discovered.
  const response = historySchema.parse(
    await request({
      context,
      path: '/conversations.history',
      query: {
        channel: channel.id,
        oldest: String(oldest ? oldest.getTime() / millisecondsPerSecond : 0),
        latest: String(startedAt.getTime() / millisecondsPerSecond),
        inclusive: true,
        limit: historyPageSize,
        ...(checkpoint.messageCursor ? { cursor: checkpoint.messageCursor } : {}),
      },
    }),
  );
  const cursor = nextCursor({ response, previous: checkpoint.messageCursor });
  const threads = new Map(
    response.messages.map((message) => [message.thread_ts ?? message.ts, message]),
  );
  const records: SyncRecord[] = [];
  for (const root of threads.values()) {
    context.signal.throwIfAborted();
    try {
      records.push(await readThread({ context, channel, root, workspaceUrl: input.workspaceUrl }));
    } catch (error) {
      // Preserve previously delivered copies when a discovered thread has since disappeared.
      if (!(error instanceof ThreadNotFound)) {
        throw error;
      }
    }
  }
  return { records, cursor };
}

function recover(input: { checkpoint: Checkpoint; error: unknown }) {
  const { checkpoint, error } = input;
  if (error instanceof ExpiredCursor) {
    if (error.path === '/users.conversations' && checkpoint.directoryCursor) {
      return { ...checkpoint, directoryCursor: null };
    }
    if (error.path === '/conversations.history' && checkpoint.messageCursor) {
      return { ...checkpoint, messageCursor: null };
    }
  }
  // Reply cursors exist only inside this step. A failure retries the entire uncommitted page.
  throw error;
}

function beginIteration(input: {
  context: SyncContext;
  account: string;
  iterationStartedAt: string;
}) {
  const checkpoint = checkpointSchema.parse(input.context.checkpoint);
  if (checkpoint.account && checkpoint.account !== input.account) {
    throw new Error('Slack account changed. Create a new sync.');
  }
  return {
    ...checkpoint,
    account: input.account,
    iterationStartedAt: checkpoint.iterationStartedAt ?? input.iterationStartedAt,
  };
}
