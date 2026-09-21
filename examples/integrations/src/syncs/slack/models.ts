import { z } from 'zod';

export const channelSchema = z.object({ id: z.string().min(1), name: z.string().optional() });
export const messageSchema = z.strictObject({
  id: z.string().min(1),
  body: z.string(),
  author: z.string().nullable(),
  sentAt: z.iso.datetime({ offset: true }),
});
export const threadSchema = z.strictObject({
  channel: z.string(),
  channelId: z.string(),
  url: z.url(),
  messages: z.array(messageSchema).min(1),
});
export const providerMessageSchema = z.object({
  ts: z.string().regex(/^\d+\.\d+$/),
  text: z.string().optional(),
  user: z.string().optional(),
  bot_id: z.string().optional(),
  thread_ts: z.string().optional(),
  reply_count: z.number().int().nonnegative().optional(),
});
export const checkpointSchema = z.strictObject({
  account: z.string().nullable(),
  oldest: z.string().nullable(),
  latest: z.string().nullable(),
  directoryCursor: z.string().nullable(),
  directoryComplete: z.boolean(),
  channels: z.array(channelSchema),
  messageCursor: z.string().nullable(),
  historyComplete: z.boolean(),
  threads: z.array(providerMessageSchema),
  replyCursor: z.string().nullable(),
  messages: z.array(messageSchema),
});
export type Checkpoint = z.infer<typeof checkpointSchema>;
export const initialCheckpoint: Checkpoint = {
  account: null,
  oldest: null,
  latest: null,
  directoryCursor: null,
  directoryComplete: false,
  channels: [],
  messageCursor: null,
  historyComplete: false,
  threads: [],
  replyCursor: null,
  messages: [],
};
export const paginationSchema = z.object({ next_cursor: z.string().optional() });
export const historySchema = z.object({
  messages: z.array(providerMessageSchema),
  has_more: z.boolean().optional(),
  response_metadata: paginationSchema.optional(),
});

export function finishChannel(checkpoint: Checkpoint): Checkpoint {
  return !checkpoint.threads.length && checkpoint.historyComplete
    ? { ...checkpoint, channels: checkpoint.channels.slice(1), historyComplete: false }
    : checkpoint;
}

export function finishThread(checkpoint: Checkpoint): Checkpoint {
  return finishChannel({
    ...checkpoint,
    threads: checkpoint.threads.slice(1),
    replyCursor: null,
    messages: [],
  });
}

export function nextCursor(input: {
  response: z.infer<typeof historySchema>;
  previous: string | null;
}) {
  const cursor = input.response.response_metadata?.next_cursor || null;
  if ((cursor && cursor === input.previous) || (input.response.has_more && !cursor)) {
    throw new Error('Slack returned incomplete message pagination.');
  }
  return cursor;
}
