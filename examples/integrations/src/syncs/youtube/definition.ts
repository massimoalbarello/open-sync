import type { SyncRegistration } from '@context-use/open-sync/definition';
import { z } from 'zod';
import { jsonSchema } from '../../schema';
import { checkpointSchema, initialCheckpoint } from './models';
import { step } from './playlists';
import { playlistItemSchema, playlistSchema } from './records';

export const youtubePlaylists = {
  definition: {
    id: 'youtube.playlists',
    name: 'YouTube playlists',
    description:
      'Owned playlists and video memberships with title, uploader, URL, and time added. Backfills once, then checks each final page for appended entries. Requires append-only API order; old edits/removals are not tracked. Expired item cursors require an explicit resync. Excludes Watch Later and playlists owned by others.',
    provider: {
      service: 'youtube',
      actions: [],
      proxyPaths: ['/youtube/v3/channels', '/youtube/v3/playlists', '/youtube/v3/playlistItems'],
    },
    configSchema: jsonSchema(z.strictObject({})),
    checkpointSchema: jsonSchema(checkpointSchema),
    initialCheckpoint,
    kinds: {
      playlist: jsonSchema(playlistSchema),
      'playlist-item': jsonSchema(playlistItemSchema),
    },
  },
  load: () => ({ step }),
} satisfies SyncRegistration;
