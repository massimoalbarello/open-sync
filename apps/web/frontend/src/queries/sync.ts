import { queryOptions } from '@tanstack/react-query';
import { syncApi } from '../lib/api';

const refreshMs = 1000;
export const syncKeys = { owner: (userId: string) => ['sync', userId] as const };
export function syncOptions(userId: string) {
  return queryOptions({
    queryKey: syncKeys.owner(userId),
    refetchInterval: refreshMs,
    queryFn: async () => {
      const result = await syncApi.sync.installations.get();
      if (result.error) {
        throw new Error('Could not load sync status.');
      }
      return result.data;
    },
  });
}
export async function setEnabled(input: { id: string; enabled: boolean }) {
  const result = await syncApi.sync
    .installations({ id: input.id })
    .patch({ enabled: input.enabled });
  if (result.error) {
    throw new Error('Could not update this sync.');
  }
}
export async function runSync(input: { id: string; backfill: boolean }) {
  const result = await syncApi.sync
    .installations({ id: input.id })
    .run.post({ backfill: input.backfill });
  if (result.error) {
    throw new Error('Could not queue this sync.');
  }
}
export function syncDetailOptions(input: { userId: string; id: string; offset: number }) {
  return queryOptions({
    queryKey: [...syncKeys.owner(input.userId), input.id, 'runs', input.offset],
    refetchInterval: refreshMs,
    queryFn: async () => {
      const resource = syncApi.sync.installations({ id: input.id });
      const [installation, history] = await Promise.all([
        resource.get(),
        resource.runs.get({ query: { offset: input.offset } }),
      ]);
      if (installation.error || history.error) {
        throw new Error('Could not load this sync.');
      }
      return { installation: installation.data, ...history.data };
    },
  });
}
