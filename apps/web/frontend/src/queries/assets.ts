import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';

const notFound = 404;
export const assetKeys = { owner: (userId: string) => ['assets', userId] as const };

export function assetsOptions(input: { userId: string; sourceId?: string }) {
  return infiniteQueryOptions({
    queryKey: [...assetKeys.owner(input.userId), 'list', input.sourceId],
    initialPageParam: 0,
    refetchInterval: 5000,
    queryFn: async ({ pageParam, signal }) => {
      const result = await api.api.receiver.assets.get({
        query: { sourceId: input.sourceId, offset: pageParam },
        fetch: { signal },
      });
      if (result.error) {
        throw new Error('Could not load received assets.');
      }
      return result.data;
    },
    // biome-ignore lint/complexity/useMaxParams: TanStack Query passes the page, pages and page parameter.
    getNextPageParam: (last, _pages, offset) => (last.hasMore ? offset + last.pageSize : undefined),
  });
}

export function assetOptions(input: { userId: string; id: string }) {
  return queryOptions({
    queryKey: [...assetKeys.owner(input.userId), 'detail', input.id],
    queryFn: async ({ signal }) => {
      const result = await api.api.receiver
        .assets({ id: input.id })
        .details.get({ fetch: { signal } });
      if (result.status === notFound) {
        return null;
      }
      if (result.error) {
        throw new Error('Could not load this asset.');
      }
      return result.data.asset;
    },
  });
}
