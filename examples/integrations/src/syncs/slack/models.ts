import { z } from 'zod';

export const channelSchema = z.object({ id: z.string().min(1), name: z.string().optional() });
export const checkpointSchema = z.strictObject({
  account: z.string().nullable(),
  oldest: z.string().nullable(),
  latest: z.string().nullable(),
  directoryCursor: z.string().nullable(),
  directoryComplete: z.boolean(),
  channels: z.array(channelSchema),
  messageCursor: z.string().nullable(),
});
export const initialCheckpoint: z.infer<typeof checkpointSchema> = {
  account: null,
  oldest: null,
  latest: null,
  directoryCursor: null,
  directoryComplete: false,
  channels: [],
  messageCursor: null,
};
export const messageSchema = z.strictObject({
  body: z.string(),
  author: z.string().nullable(),
  channel: z.string(),
  channelId: z.string(),
  sentAt: z.iso.datetime({ offset: true }),
  url: z.url(),
  threadId: z.string().nullable(),
});
export const paginationSchema = z.object({ next_cursor: z.string().optional() });
export const historySchema = z.object({
  messages: z.array(
    z.object({
      ts: z.string().regex(/^\d+\.\d+$/),
      text: z.string().optional(),
      user: z.string().optional(),
      bot_id: z.string().optional(),
      thread_ts: z.string().optional(),
    }),
  ),
  has_more: z.boolean().optional(),
  response_metadata: paginationSchema.optional(),
});
