import { type AssetRef, assetPlaceholder } from '@context-use/open-sync/assets';
import type { SyncContext } from '@context-use/open-sync/definition';
import { canonicalJson } from '@context-use/open-sync/json';
import type { z } from 'zod';
import type { fileSchema } from './models';

export async function slackAttachments(input: {
  context: SyncContext;
  files: z.infer<typeof fileSchema>[];
}) {
  const refs: Record<string, AssetRef> = {};
  const attachments: { name: string; file: string }[] = [];
  for (const file of input.files) {
    const key = `file_${Buffer.from(file.id).toString('base64url')}`;
    const name = file.name ?? file.title ?? file.id;
    const mediaType = file.mimetype ?? 'application/octet-stream';
    const asset = {
      id: file.id,
      name,
      mediaType,
      version: canonicalJson({ name, mediaType }).sha256,
    };
    refs[key] = file.is_external
      ? input.context.assets.unavailable({ ...asset, code: 'external_connection_required' })
      : await input.context.assets.capture({
          ...asset,
          read() {
            if (!input.context.provider.download) {
              throw new Error('Provider does not support file downloads');
            }
            return input.context.provider.download({
              id: 'slack.download_file',
              input: { fileId: file.id },
              fileField: 'file',
            });
          },
        });
    attachments.push({ name, file: assetPlaceholder(key) });
  }
  return { refs, attachments };
}
