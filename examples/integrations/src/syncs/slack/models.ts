import { z } from 'zod';

export const channelSchema = z.object({ id: z.string().min(1), name: z.string().optional() });
export const fileSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  title: z.string().optional(),
  mimetype: z.string().optional(),
  is_external: z.boolean().optional(),
});
export const messageSchema = z.strictObject({
  id: z.string().min(1),
  body: z.string(),
  author: z.string().nullable(),
  sentAt: z.iso.datetime({ offset: true }),
  files: z.array(fileSchema).optional(),
});
export const threadSchema = z.strictObject({
  channel: z.string(),
  channelId: z.string(),
  url: z.url(),
  messages: z
    .array(
      messageSchema.omit({ files: true }).extend({
        attachments: z.array(z.strictObject({ name: z.string(), file: z.string() })).optional(),
      }),
    )
    .min(1),
});
export const providerMessageSchema = z.object({
  ts: z.string().regex(/^\d+\.\d+$/),
  text: z.string().optional(),
  user: z.string().optional(),
  bot_id: z.string().optional(),
  thread_ts: z.string().optional(),
  reply_count: z.number().int().nonnegative().optional(),
  files: z.array(fileSchema).optional(),
});
export const checkpointSchema = z.strictObject({
  // Team and user identity; retained after completion to reject a different account.
  account: z.string().nullable(),
  // Frozen before provider I/O. Derives both history bounds across pages/restarts;
  // cleared on completion because Slack history has no cross-iteration change token.
  iterationStartedAt: z.iso.datetime({ offset: true }).nullable(),
  // Next directory page after the active channel; null before discovery or on the last page.
  directoryCursor: z.string().nullable(),
  // Active channel whose history is unfinished; avoids rediscovering its directory page.
  channelId: z.string().nullable(),
  // Native position within that channel's history; reply pages finish within the step.
  messageCursor: z.string().nullable(),
});
export type Checkpoint = z.infer<typeof checkpointSchema>;
export const initialCheckpoint: Checkpoint = {
  account: null,
  iterationStartedAt: null,
  directoryCursor: null,
  channelId: null,
  messageCursor: null,
};
export const paginationSchema = z.object({ next_cursor: z.string().optional() });
export const historySchema = z.object({
  // An explicit provider history limit is not an exhausted, complete scan.
  is_limited: z.literal(false).optional(),
  messages: z.array(providerMessageSchema),
  has_more: z.boolean().optional(),
  response_metadata: paginationSchema.optional(),
});

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
