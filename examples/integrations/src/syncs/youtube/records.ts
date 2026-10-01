import type { SyncRecord } from '@context-use/open-sync/record';
import { z } from 'zod';

const id = z.string().min(1);
const timestamp = z.iso.datetime({ offset: true });
export const playlistSchema = z.strictObject({
  title: z.string(),
  description: z.string(),
  url: z.url(),
  channelId: id,
  channel: z.string(),
  createdAt: timestamp,
  privacy: z.enum(['private', 'public', 'unlisted']),
});
export const playlistItemSchema = z.strictObject({
  title: z.string(),
  videoId: id,
  url: z.url(),
  channelId: id.nullable(),
  channel: z.string().nullable(),
  playlistId: id,
  playlistUrl: z.url(),
  addedAt: timestamp,
});
export const providerPlaylistSchema = z.object({
  id,
  snippet: z.object({
    title: z.string(),
    description: z.string(),
    channelId: id,
    channelTitle: z.string(),
    publishedAt: timestamp,
  }),
  status: z.object({ privacyStatus: playlistSchema.shape.privacy }),
});
export const providerPlaylistItemSchema = z.object({
  id,
  snippet: z.object({
    title: z.string(),
    playlistId: id,
    publishedAt: timestamp,
    resourceId: z.object({ kind: z.literal('youtube#video'), videoId: id }),
    // Private/deleted videos can omit uploader identity. Preserve the membership
    // and its timestamp instead of inventing a channel or dropping the item.
    videoOwnerChannelId: id.optional(),
    videoOwnerChannelTitle: z.string().optional(),
  }),
});
type Playlist = z.infer<typeof providerPlaylistSchema>;
type PlaylistItem = z.infer<typeof providerPlaylistItemSchema>;
const playlistUrl = (id: string) =>
  `https://www.youtube.com/playlist?list=${encodeURIComponent(id)}`;

export function playlistRecord(playlist: Playlist): SyncRecord {
  const snippet = playlist.snippet;
  const data: z.infer<typeof playlistSchema> = {
    title: snippet.title,
    description: snippet.description,
    url: playlistUrl(playlist.id),
    channelId: snippet.channelId,
    channel: snippet.channelTitle,
    createdAt: snippet.publishedAt,
    privacy: playlist.status.privacyStatus,
  };
  return {
    operation: 'upsert',
    kind: 'playlist',
    id: playlist.id,
    data,
    preview: data.title,
    createdAt: data.createdAt,
    content: {
      format: 'markdown',
      body: [
        `# ${data.title}`,
        data.url,
        `Channel: ${data.channel}`,
        `Created: ${data.createdAt}`,
        `Privacy: ${data.privacy}`,
        data.description,
      ].join('\n\n'),
    },
  };
}

export function playlistItemRecord(item: PlaylistItem): SyncRecord {
  const snippet = item.snippet;
  const data: z.infer<typeof playlistItemSchema> = {
    title: snippet.title,
    videoId: snippet.resourceId.videoId,
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(snippet.resourceId.videoId)}`,
    channelId: snippet.videoOwnerChannelId ?? null,
    channel: snippet.videoOwnerChannelTitle ?? null,
    playlistId: snippet.playlistId,
    playlistUrl: playlistUrl(snippet.playlistId),
    addedAt: snippet.publishedAt,
  };
  return {
    operation: 'upsert',
    kind: 'playlist-item',
    id: item.id,
    data,
    preview: data.title,
    createdAt: data.addedAt,
    content: {
      format: 'markdown',
      body: [
        `# ${data.title}`,
        data.url,
        `Channel: ${data.channel ?? 'Unavailable'}`,
        `Playlist: ${data.playlistUrl}`,
        `Added to playlist: ${data.addedAt}`,
      ].join('\n\n'),
    },
  };
}
