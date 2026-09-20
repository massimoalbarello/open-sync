import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { api, syncApi } from '../lib/api';

const refreshMs = 5000;
export const deliveryKeys = { owner: (userId: string) => ['delivery', userId] as const };
export function deliveryOptions(userId: string) {
  return infiniteQueryOptions({
    queryKey: [...deliveryKeys.owner(userId), 'pages'],
    initialPageParam: 0,
    refetchInterval: refreshMs,
    queryFn: async ({ pageParam, signal }) => {
      const result = await syncApi.sync.deliveries.get({
        query: { offset: pageParam },
        fetch: { signal },
      });
      if (result.error) {
        throw new Error('Could not load the queue.');
      }
      return result.data;
    },
    // biome-ignore lint/complexity/useMaxParams: TanStack Query passes the page, pages and page parameter.
    getNextPageParam: (last, _pages, offset) => (last.hasMore ? offset + last.pageSize : undefined),
  });
}
export function deliveryStatusOptions(userId: string) {
  return queryOptions({
    queryKey: [...deliveryKeys.owner(userId), 'status'],
    refetchInterval: refreshMs,
    queryFn: async () => {
      const [status, receiver] = await Promise.all([
        syncApi.sync.status.get(),
        api.api.receiver.status.get(),
      ]);
      if (status.error || receiver.error) {
        throw new Error('Could not load delivery status.');
      }
      return { queue: status.data.queue, receiver: receiver.data };
    },
  });
}
export async function setReceiverPaused(paused: boolean) {
  const result = await api.api.receiver.settings.patch({ paused });
  if (result.error) {
    throw new Error('Could not update delivery settings.');
  }
}
export async function retryDelivery(id: string) {
  const result = await syncApi.sync.deliveries({ id }).retry.post();
  if (result.error) {
    throw new Error('Could not retry this delivery.');
  }
}
