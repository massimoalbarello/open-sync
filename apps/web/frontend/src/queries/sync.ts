import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { syncApi } from '../lib/api';

const refreshMs = 1000;
export const syncKeys = { owner: (userId: string) => ['sync', userId] as const };
export function syncOptions(userId: string) {
  return queryOptions({
    queryKey: syncKeys.owner(userId),
    refetchInterval: refreshMs,
    queryFn: async () => {
      const [result, connections] = await Promise.all([
        syncApi.sync.syncs.get(),
        syncApi.providers.connections.get(),
      ]);
      if (result.error || connections.error) {
        throw new Error('Could not load sync status.');
      }
      return { ...result.data, connections: connections.data };
    },
  });
}
export async function setEnabled(input: { id: string; enabled: boolean }) {
  const result = await syncApi.sync.syncs({ id: input.id }).patch({ enabled: input.enabled });
  if (result.error) {
    throw new Error('Could not update this sync.');
  }
}
export async function runSync(input: { id: string }) {
  const result = await syncApi.sync.syncs({ id: input.id }).run.post();
  if (result.error) {
    throw new Error('Could not queue this sync.');
  }
}
export async function resync(input: { id: string }) {
  const result = await syncApi.sync.syncs(input).resync.post();
  if (result.error) {
    throw new Error('Could not resync.');
  }
}
export async function removeSync(input: { id: string }) {
  const result = await syncApi.sync.syncs(input).delete();
  if (result.error) {
    throw new Error('Could not remove this sync.');
  }
}
export function syncDetailOptions(input: { userId: string; id: string }) {
  return queryOptions({
    queryKey: [...syncKeys.owner(input.userId), input.id],
    refetchInterval: refreshMs,
    queryFn: async () => {
      const resource = syncApi.sync.syncs({ id: input.id });
      const [sync, connections] = await Promise.all([
        resource.get(),
        syncApi.providers.connections.get(),
      ]);
      if (sync.error || connections.error) {
        throw new Error('Could not load this sync.');
      }
      return { sync: sync.data, connections: connections.data };
    },
  });
}

export function pollOptions(input: { userId: string; id: string }) {
  return infiniteQueryOptions({
    queryKey: [...syncKeys.owner(input.userId), input.id, 'polls'],
    initialPageParam: undefined as number | undefined,
    refetchInterval: refreshMs,
    queryFn: async ({ pageParam, signal }) => {
      const result = await syncApi.sync.syncs({ id: input.id }).polls.get({
        query: { before: pageParam },
        fetch: { signal },
      });
      if (result.error) {
        throw new Error('Could not load polling iterations.');
      }
      return result.data;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
