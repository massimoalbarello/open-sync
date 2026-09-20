import { z } from 'zod';

export const emailSchema = z.strictObject({
  subject: z.string(),
  body: z.string(),
  from: z.string(),
  to: z.string(),
  sentAt: z.iso.datetime({ offset: true }),
  url: z.url(),
  threadId: z.string().min(1),
  labels: z.array(z.string()),
});
export const checkpointSchema = z.strictObject({
  account: z.string().nullable(),
  query: z.string().nullable(),
  pageToken: z.string().nullable(),
});
export const initialCheckpoint: z.infer<typeof checkpointSchema> = {
  account: null,
  query: null,
  pageToken: null,
};

export const responseSchema = z.object({
  messages: z.array(
    z.object({
      messageId: z.string().min(1),
      threadId: z.string().min(1),
      subject: z.string(),
      sender: z.string(),
      to: z.string(),
      messageTimestamp: z.iso.datetime({ offset: true }),
      messageText: z.string(),
      labelIds: z.array(z.string()),
    }),
  ),
  nextPageToken: z.string().nullable().optional(),
});
