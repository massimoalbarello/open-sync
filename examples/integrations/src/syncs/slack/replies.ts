import type { AssetRef } from '@context-use/open-sync/assets';
import type { SyncContext } from '@context-use/open-sync/definition';
import type { SyncRecord } from '@context-use/open-sync/delivery';
import type { z } from 'zod';
import { slackAttachments } from './attachments';
import {
  type channelSchema,
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
  channel: z.infer<typeof channelSchema>;
  root: z.infer<typeof providerMessageSchema>;
  workspaceUrl: string;
}): Promise<SyncRecord> {
  const { context, channel, root } = input;
  const rootTs = root.thread_ts ?? root.ts;
  let messages: z.infer<typeof messageSchema>[];
  if (rootTs === root.ts && !root.reply_count) {
    // Ordinary messages are single-message threads; join/leave events cannot use replies.
    messages = [normalize(root)];
  } else {
    messages = await readReplies({ context, channelId: channel.id, rootTs });
  }
  const rootMessage = messages.find((message) => message.id === rootTs);
  if (!rootMessage) {
    throw new Error('Slack did not return the thread root.');
  }
  const assetRefs: Record<string, AssetRef> = {};
  const recordMessages = [];
  for (const { files, ...message } of messages) {
    const { refs, attachments } = await slackAttachments({ context, files: files ?? [] });
    Object.assign(assetRefs, refs);
    recordMessages.push({ ...message, ...(attachments.length ? { attachments } : {}) });
  }
  return {
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
  };
}

async function readReplies(input: { context: SyncContext; channelId: string; rootTs: string }) {
  const { context, channelId, rootTs } = input;
  const merged = new Map<string, z.infer<typeof messageSchema>>();
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    context.signal.throwIfAborted();
    const response = historySchema.parse(
      await request({
        context,
        path: '/conversations.replies',
        query: { channel: channelId, ts: rootTs, limit: pageSize, ...(cursor ? { cursor } : {}) },
      }),
    );
    if (
      response.messages.some((message) => message.ts !== rootTs && message.thread_ts !== rootTs)
    ) {
      throw new Error('Slack returned a message from a different thread.');
    }
    const previousSize = merged.size;
    for (const message of response.messages) {
      merged.set(message.ts, normalize(message));
    }
    cursor = nextCursor({ response, previous: cursor });
    if (cursor && (seen.has(cursor) || merged.size <= previousSize)) {
      throw new Error('Slack reply pagination made no progress.');
    }
    if (cursor) {
      seen.add(cursor);
    }
  } while (cursor);
  return [...merged.values()].sort(
    // biome-ignore lint/complexity/useMaxParams: Array.sort passes both messages.
    (a, b) => Number(a.id) - Number(b.id),
  );
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
