import { z } from 'zod';

// The Markdown convention belongs to these examples, not to the engine or any particular receiver.
export const markdownRecord = z.strictObject({
  title: z.string().regex(/\S/),
  body: z.string().regex(/\S/),
  sourceUrl: z.url().optional(),
  sourceCreatedAt: z.iso.datetime({ offset: true }).optional(),
  sourceUpdatedAt: z.iso.datetime({ offset: true }).optional(),
  participants: z
    .array(
      z.strictObject({
        identities: z
          .array(z.strictObject({ namespace: z.string().min(1), id: z.string().min(1) }))
          .min(1),
        roles: z.array(z.string().min(1)).min(1),
        name: z.string().optional(),
      }),
    )
    .optional(),
  attributes: z.record(z.string(), z.json()).optional(),
});
export type Participant = NonNullable<z.infer<typeof markdownRecord>['participants']>[number];
