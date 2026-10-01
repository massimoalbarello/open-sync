import { expect, test } from 'bun:test';
import { playlistItemRecord } from '../src/syncs/youtube/records';

test('YouTube membership identity preserves separate playlists and uses the uploader, not the playlist owner', () => {
  const snippet = {
    title: 'A video',
    playlistId: 'playlist-one',
    publishedAt: '2020-01-02T03:04:05Z',
    resourceId: { kind: 'youtube#video' as const, videoId: 'video-one' },
    channelTitle: 'Playlist owner',
    channelId: 'owner',
    videoOwnerChannelTitle: 'Uploader',
    videoOwnerChannelId: 'uploader',
  };
  const first = playlistItemRecord({ id: 'membership-one', snippet });
  const second = playlistItemRecord({
    id: 'membership-two',
    snippet: { ...snippet, playlistId: 'playlist-two', publishedAt: '2021-01-02T03:04:05Z' },
  });
  expect(first).toMatchObject({
    id: 'membership-one',
    createdAt: snippet.publishedAt,
    data: { channel: 'Uploader', channelId: 'uploader', addedAt: snippet.publishedAt },
  });
  expect(second).toMatchObject({
    id: 'membership-two',
    data: { playlistId: 'playlist-two', videoId: 'video-one', addedAt: '2021-01-02T03:04:05Z' },
  });
});

test('YouTube unavailable video memberships keep their timestamp and missing uploader metadata', () => {
  expect(
    playlistItemRecord({
      id: 'membership',
      snippet: {
        title: 'Private video',
        playlistId: 'playlist',
        publishedAt: '2020-01-02T03:04:05Z',
        resourceId: { kind: 'youtube#video', videoId: 'video' },
      },
    }),
  ).toMatchObject({ data: { channel: null, channelId: null, addedAt: '2020-01-02T03:04:05Z' } });
});
