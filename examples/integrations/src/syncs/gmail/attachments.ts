import { type AssetRef, assetPlaceholder } from '@context-use/open-sync/assets';
import { SourceHttpError, type SyncContext } from '@context-use/open-sync/definition';
import { z } from 'zod';

const successStatus = 200;
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
      const key = `attachment_${Buffer.from(`${input.messageId}:${partId}`).toString('base64url')}`;
      refs[key] = await input.context.assets.capture({
        id: `${input.messageId}:${partId}`,
        version: '1',
        name: part.filename,
        mediaType: part.mimeType ?? 'application/octet-stream',
        async read() {
          let data = part.body?.data;
          if (data === undefined && part.body?.attachmentId) {
            const response = await input.context.provider.get({
              path: `/users/me/messages/${encodeURIComponent(input.messageId)}/attachments/${encodeURIComponent(part.body.attachmentId)}`,
            });
            if (response.status !== successStatus) {
              throw new SourceHttpError(response);
            }
            data = z.object({ data: z.string() }).parse(response.body).data;
          }
          if (data === undefined || !/^[A-Za-z0-9_=-]*$/.test(data)) {
            throw new Error('Invalid Gmail attachment content');
          }
          return new Blob([Buffer.from(data, 'base64url')]).stream();
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
