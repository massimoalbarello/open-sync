import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';

const notFound = 404;
export const recordKeys = { owner: (userId: string) => ['records', userId] as const };

export function recordsOptions(input: { userId: string; sourceId?: string }) {
  return infiniteQueryOptions({
    queryKey: [...recordKeys.owner(input.userId), 'list', input.sourceId],
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

export function recordOptions(input: {
  userId: string;
  sourceId: string;
  kind: string;
  id: string;
}) {
  return queryOptions({
    queryKey: [...recordKeys.owner(input.userId), 'detail', input.sourceId, input.kind, input.id],
    refetchInterval: 5000,
    queryFn: async ({ signal }) => {
      const result = await api.api.receiver.records.detail.get({
        query: { sourceId: input.sourceId, kind: input.kind, id: input.id },
        fetch: { signal },
      });
      if (result.status === notFound) {
        return null;
      }
      if (result.error) {
        throw new Error('Could not load this record.');
      }
      return result.data.record;
    },
  });
}
