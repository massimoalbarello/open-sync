import { expect, test } from 'bun:test';
import { playlistItemRecord } from '../src/syncs/youtube/records';

test('YouTube membership identity preserves separate playlists and uses the uploader, not the playlist owner', () => {
  const snippet = {
    title: 'A video',
    playlistId: 'playlist-one',
    position: 0,
    publishedAt: '2020-01-02T03:04:05Z',
    resourceId: { kind: 'youtube#video' as const, videoId: 'video-one' },
    channelTitle: 'Playlist owner',
    channelId: 'owner',
    videoOwnerChannelTitle: 'Uploader',
    videoOwnerChannelId: 'uploader',
  };
  const first = playlistItemRecord({
    item: { id: 'membership-one', snippet },
    playlistTitle: 'Learning',
  });
  const second = playlistItemRecord({
    item: {
      id: 'membership-two',
      snippet: { ...snippet, playlistId: 'playlist-two', publishedAt: '2021-01-02T03:04:05Z' },
    },
    playlistTitle: 'Favorites',
  });
  expect(first).toMatchObject({
    id: 'membership-one',
    createdAt: snippet.publishedAt,
    data: {
      channel: 'Uploader',
      channelId: 'uploader',
      addedAt: snippet.publishedAt,
      playlistTitle: 'Learning',
    },
  });
  expect(second).toMatchObject({
    id: 'membership-two',
    data: {
      playlistId: 'playlist-two',
      videoId: 'video-one',
      addedAt: '2021-01-02T03:04:05Z',
      playlistTitle: 'Favorites',
    },
  });
});

test('YouTube unavailable video memberships keep their timestamp and missing uploader metadata', () => {
  expect(
    playlistItemRecord({
      item: {
        id: 'membership',
        snippet: {
          title: 'Private video',
          playlistId: 'playlist',
          position: 0,
          publishedAt: '2020-01-02T03:04:05Z',
          resourceId: { kind: 'youtube#video', videoId: 'video' },
        },
      },
      playlistTitle: 'Learning',
    }),
  ).toMatchObject({ data: { channel: null, channelId: null, addedAt: '2020-01-02T03:04:05Z' } });
});
