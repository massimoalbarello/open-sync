import { queryOptions } from '@tanstack/react-query';
import { api, syncApi } from '../lib/api';

const refreshMs = 5000;
export const deliveryKeys = { owner: (userId: string) => ['delivery', userId] as const };
export function deliveryOptions(input: { userId: string; offset: number }) {
  return queryOptions({
    queryKey: [...deliveryKeys.owner(input.userId), input.offset],
    refetchInterval: refreshMs,
    queryFn: async () => {
      const [page, status, receiver] = await Promise.all([
        syncApi.sync.deliveries.get({ query: { offset: input.offset } }),
        syncApi.sync.status.get(),
        api.api.receiver.status.get(),
      ]);
      if (page.error || status.error || receiver.error) {
        throw new Error('Could not load delivery status.');
      }
      return { ...page.data, queue: status.data.queue, receiver: receiver.data };
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
