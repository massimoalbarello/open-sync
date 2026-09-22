import { type AssetRef, assetPlaceholder } from '@context-use/open-sync/assets';
import type { SyncContext, SyncStep } from '@context-use/open-sync/definition';
import { canonicalJson } from '@context-use/open-sync/json';
import type { z } from 'zod';
import {
  type Checkpoint,
  finishThread,
  historySchema,
  type messageSchema,
  nextCursor,
  type providerMessageSchema,
} from './models';
import { request } from './request';

const millisecondsPerSecond = 1000;
const pageSize = 15;

export async function readThread(input: {
  context: SyncContext;
  checkpoint: Checkpoint;
  workspaceUrl: string;
}): Promise<SyncStep> {
  const { context, checkpoint } = input;
  const root = checkpoint.threads[0]!;
  const rootTs = root.thread_ts ?? root.ts;
  let messages: z.infer<typeof messageSchema>[];
  let cursor: string | null = null;
  if (rootTs === root.ts && !root.reply_count) {
    // Ordinary messages are single-message threads; join/leave events cannot use replies.
    messages = [normalize(root)];
  } else {
    ({ messages, cursor } = await readReplies({ context, checkpoint, rootTs }));
  }
  if (cursor) {
    // Persist partial fetch progress, but only ever deliver a complete thread.
    return {
      deliverable: { records: [] },
      checkpoint: { ...checkpoint, replyCursor: cursor, messages },
      complete: false,
    };
  }
  const rootMessage = messages.find((message) => message.id === rootTs);
  if (!rootMessage) {
    throw new Error('Slack did not return the thread root.');
  }
  const assetRefs: Record<string, AssetRef> = {};
  const recordMessages = messages.map(({ files, ...message }) => {
    const attachments = (files ?? []).map((file) => {
      const key = `file_${Buffer.from(file.id).toString('base64url')}`;
      const name = file.name ?? file.title ?? file.id;
      assetRefs[key] = context.assets.unavailable({
        id: file.id,
        version: canonicalJson({ name, mediaType: file.mimetype ?? 'application/octet-stream' })
          .sha256,
        name,
        mediaType: file.mimetype ?? 'application/octet-stream',
        code: file.is_external ? 'external_connection_required' : 'provider_download_unavailable',
      });
      return { name, file: assetPlaceholder(key) };
    });
    return { ...message, ...(attachments.length ? { attachments } : {}) };
  });
  const channel = checkpoint.channels[0]!;
  return {
    deliverable: {
      records: [
        {
          ...(Object.keys(assetRefs).length ? { assetRefs } : {}),
          operation: 'upsert',
          kind: 'thread',
          id: `${channel.id}:${rootTs}`,
          preview: rootMessage.body,
          createdAt: rootMessage.sentAt,
          data: {
            channel: channel.name ?? channel.id,
            channelId: channel.id,
            url: new URL(
              `archives/${encodeURIComponent(channel.id)}/p${rootTs.replace('.', '')}`,
              input.workspaceUrl,
            ).href,
            messages: recordMessages,
          },
        },
      ],
    },
    checkpoint: finishThread(checkpoint),
    complete: false,
  };
}

async function readReplies(input: {
  context: SyncContext;
  checkpoint: Checkpoint;
  rootTs: string;
}) {
  const { context, checkpoint, rootTs } = input;
  const response = historySchema.parse(
    await request({
      context,
      path: '/conversations.replies',
      query: {
        channel: checkpoint.channels[0]!.id,
        ts: rootTs,
        limit: pageSize,
        ...(checkpoint.replyCursor ? { cursor: checkpoint.replyCursor } : {}),
      },
    }),
  );
  if (response.messages.some((message) => message.ts !== rootTs && message.thread_ts !== rootTs)) {
    throw new Error('Slack returned a message from a different thread.');
  }
  const cursor = nextCursor({ response, previous: checkpoint.replyCursor });
  const merged = new Map(checkpoint.messages.map((message) => [message.id, message]));
  for (const message of response.messages) {
    merged.set(message.ts, normalize(message));
  }
  const messages = [...merged.values()].sort(
    // biome-ignore lint/complexity/useMaxParams: Array.sort passes both messages.
    (a, b) => Number(a.id) - Number(b.id),
  );
  if (cursor && messages.length <= checkpoint.messages.length) {
    throw new Error('Slack reply pagination made no progress.');
  }
  return { messages, cursor };
}

function normalize(message: z.infer<typeof providerMessageSchema>) {
  return {
    id: message.ts,
    ...(message.files?.length ? { files: message.files } : {}),
    body: message.text ?? '',
    author: message.user ?? message.bot_id ?? null,
    sentAt: new Date(Number(message.ts) * millisecondsPerSecond).toISOString(),
  };
}
