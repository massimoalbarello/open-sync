import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { api, syncApi } from '../lib/api';
import { syncKeys } from './sync';

const refreshMs = 1000;
type SyncInput = { userId: string; syncId: string };
export function pendingDeliverablesOptions(input: SyncInput) {
  return infiniteQueryOptions({
    queryKey: [...syncKeys.owner(input.userId), input.syncId, 'pending'],
    initialPageParam: undefined as number | undefined,
    refetchInterval: refreshMs,
    queryFn: async ({ pageParam, signal }) => {
      const result = await syncApi.sync.syncs({ id: input.syncId }).deliverables.get({
        query: { before: pageParam },
        fetch: { signal },
      });
      if (result.error) {
        throw new Error('Could not load pending deliverables.');
      }
      return result.data;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
export function receivedDeliverablesOptions(input: SyncInput) {
  return infiniteQueryOptions({
    queryKey: [...syncKeys.owner(input.userId), input.syncId, 'received'],
    initialPageParam: undefined as number | undefined,
    refetchInterval: refreshMs,
    queryFn: async ({ pageParam, signal }) => {
      const result = await api.api.receiver.syncs({ syncId: input.syncId }).deliverables.get({
        query: { before: pageParam },
        fetch: { signal },
      });
      if (result.error) {
        throw new Error('Could not load received deliverables.');
      }
      return result.data;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
export function deliverableOptions(input: SyncInput & { id: string; received: boolean }) {
  return queryOptions({
    queryKey: [
      ...syncKeys.owner(input.userId),
      input.syncId,
      input.received ? 'received' : 'pending',
      input.id,
    ],
    queryFn: async ({ signal }) => {
      if (input.received) {
        const result = await api.api.receiver
          .syncs({ syncId: input.syncId })
          .deliverables({ id: input.id })
          .get({ fetch: { signal } });
        if (result.error) {
          throw new Error('This received deliverable is unavailable.');
        }
        return result.data.deliverable;
      }
      const result = await syncApi.sync
        .syncs({ id: input.syncId })
        .deliverables({ deliveryId: input.id })
        .get({ fetch: { signal } });
      if (result.error) {
        throw new Error(
          'This pending deliverable is no longer available. It may have been delivered.',
        );
      }
      return result.data;
    },
  });
}
export async function retryDelivery(input: { syncId: string; id: string }) {
  const result = await syncApi.sync
    .syncs({ id: input.syncId })
    .deliverables({ deliveryId: input.id })
    .retry.post();
  if (result.error) {
    throw new Error('Could not retry this deliverable.');
  }
}
