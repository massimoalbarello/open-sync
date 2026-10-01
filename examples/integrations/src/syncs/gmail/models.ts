import { z } from 'zod';
import { payloadSchema } from './attachments';

export const messageSchema = z.strictObject({
  id: z.string().min(1),
  body: z.string(),
  from: z.string(),
  to: z.string(),
  sentAt: z.iso.datetime({ offset: true }),
  labels: z.array(z.string()),
  attachments: z.array(z.strictObject({ name: z.string(), file: z.string() })).optional(),
});
export const threadSchema = z.strictObject({
  subject: z.string(),
  url: z.url(),
  messages: z.array(messageSchema).min(1),
});
export const checkpointSchema = z.strictObject({
  // Mailbox identity; survives completed iterations to reject a different account.
  account: z.string().nullable(),
  // Frozen search for the initial/recovery backfill. Null afterwards selects history.list.
  query: z.string().nullable(),
  // Native page position within either listing; cleared when that listing completes.
  pageToken: z.string().nullable(),
  // Durable change token, captured BEFORE backfill and advanced only after history is exhausted.
  // Unlike pageToken, this survives completed polls and catches changes during the backfill.
  historyId: z.string().regex(/^\d+$/).nullable(),
});
export const initialCheckpoint: z.infer<typeof checkpointSchema> = {
  account: null,
  query: null,
  pageToken: null,
  historyId: null,
};

const providerMessageSchema = z.object({
  messageId: z.string().min(1),
  threadId: z.string().min(1),
  subject: z.string(),
  sender: z.string(),
  to: z.string(),
  messageTimestamp: z.iso.datetime({ offset: true }),
  messageText: z.string(),
  labelIds: z.array(z.string()),
  payload: payloadSchema,
});
export const providerThreadSchema = z.object({
  threadId: z.string().min(1),
  messages: z.array(providerMessageSchema).min(1),
});
