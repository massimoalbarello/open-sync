import { type AssetRef, assetPlaceholder } from '@context-use/open-sync/assets';
import type { SyncContext } from '@context-use/open-sync/definition';
import { z } from 'zod';

interface Part {
  partId?: string;
  filename?: string;
  mimeType?: string;
  body?: { attachmentId?: string; data?: string };
  parts?: Part[];
}
const partSchema: z.ZodType<Part> = z.lazy(() =>
  z.object({
    partId: z.string().optional(),
    filename: z.string().optional(),
    mimeType: z.string().optional(),
    body: z.object({ attachmentId: z.string().optional(), data: z.string().optional() }).optional(),
    parts: z.array(partSchema).optional(),
  }),
);
export const payloadSchema = partSchema.nullable().optional();

export async function gmailAttachments(input: {
  context: SyncContext;
  messageId: string;
  payload?: Part | null;
}) {
  const refs: Record<string, AssetRef> = {};
  const attachments: { name: string; file: string }[] = [];
  const visit = async (part: Part) => {
    if (part.filename) {
      const partId = part.partId ?? part.body?.attachmentId;
      if (!partId) {
        throw new Error('Gmail attachment has no stable part identity');
      }
      const data = part.body?.data;
      const attachmentId = part.body?.attachmentId;
      const mediaType = part.mimeType ?? 'application/octet-stream';
      const key = `attachment_${Buffer.from(`${input.messageId}:${partId}`).toString('base64url')}`;
      refs[key] = await input.context.assets.capture({
        id: `${input.messageId}:${partId}`,
        version: '1',
        name: part.filename,
        mediaType,
        read() {
          if (data === undefined && attachmentId) {
            if (!input.context.provider.download) {
              throw new Error('Provider does not support file downloads');
            }
            return input.context.provider.download({
              id: 'gmail.download_attachment',
              input: {
                messageId: input.messageId,
                attachmentId,
                fileName: part.filename!,
                mimeType: mediaType,
              },
            });
          }
          if (data === undefined || !/^[A-Za-z0-9_=-]*$/.test(data)) {
            throw new Error('Invalid Gmail attachment content');
          }
          return Promise.resolve(new Blob([Buffer.from(data, 'base64url')]).stream());
        },
      });
      attachments.push({ name: part.filename, file: assetPlaceholder(key) });
    }
    for (const child of part.parts ?? []) {
      await visit(child);
    }
  };
  if (input.payload) {
    await visit(input.payload);
  }
  return { refs, attachments };
}
