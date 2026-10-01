import type { SyncRegistration } from '@context-use/open-sync/definition';
import { jsonSchema } from '../../schema';
import { checkpointSchema, initialCheckpoint } from './models';
import { step } from './playlists';
import { playlistItemSchema } from './records';

export const youtubePlaylists = {
  definition: {
    id: 'youtube.playlists',
    name: 'YouTube playlist videos',
    description:
      'Videos saved to your owned playlists with title, channel, URL, saved time, and playlist name and URL. Backfills once, then compares playlist counts and emits only newly appended entries. Requires append-only API order; old edits/removals are not tracked. Expired item cursors require an explicit resync. Excludes Watch Later and playlists owned by others.',
    provider: {
      service: 'youtube',
      actions: [],
      proxyPaths: ['/youtube/v3/channels', '/youtube/v3/playlists', '/youtube/v3/playlistItems'],
    },
    configSchema: { type: 'object', additionalProperties: false },
    checkpointSchema: jsonSchema(checkpointSchema),
    initialCheckpoint,
    kinds: {
      'playlist-item': jsonSchema(playlistItemSchema),
    },
  },
  load: () => ({ step }),
} satisfies SyncRegistration;
