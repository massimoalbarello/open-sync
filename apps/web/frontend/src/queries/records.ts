import { queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
export function recordsOptions(input: { userId: string; sourceId?: string; offset: number }) {
  return queryOptions({
    queryKey: ['records', input.userId, input.sourceId, input.offset],
    refetchInterval: 3000,
    queryFn: async () => {
      const result = await api.api.receiver.records.get({
        query: { sourceId: input.sourceId, offset: input.offset },
      });
      if (result.error) {
        throw new Error('Could not load received records.');
      }
      return result.data;
    },
  });
}
