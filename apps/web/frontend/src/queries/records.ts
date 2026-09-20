import { infiniteQueryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
export function recordsOptions(input: { userId: string; sourceId?: string }) {
  return infiniteQueryOptions({
    queryKey: ['records', input.userId, input.sourceId],
    initialPageParam: 0,
    refetchInterval: 5000,
    queryFn: async ({ pageParam, signal }) => {
      const result = await api.api.receiver.records.get({
        query: { sourceId: input.sourceId, offset: pageParam },
        fetch: { signal },
      });
      if (result.error) {
        throw new Error('Could not load received records.');
      }
      return result.data;
    },
    // biome-ignore lint/complexity/useMaxParams: TanStack Query passes the page, pages and page parameter.
    getNextPageParam: (last, _pages, offset) => (last.hasMore ? offset + last.pageSize : undefined),
  });
}
