import { z } from 'zod';

export const meetingSchema = z.strictObject({
  title: z.string().nullable(),
  notes: z.string(),
  date: z.string().nullable(),
  attendees: z.string(),
});
export const checkpointSchema = z.strictObject({
  afterId: z.string().min(1).nullable(),
});
export const responseSchema = z.object({
  meetings: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().nullable(),
      summary: z.string().optional(),
      date: z.string().optional(),
      attendees: z.string().optional(),
    }),
  ),
});
