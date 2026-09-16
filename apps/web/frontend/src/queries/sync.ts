import { queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';

const refreshMs = 1000;
export const syncKeys = { owner: (userId: string) => ['sync', userId] as const };
export function syncOptions(userId: string) {
  return queryOptions({
    queryKey: syncKeys.owner(userId),
    refetchInterval: refreshMs,
    queryFn: async () => {
      const [syncs, queue, deliveries, receiver] = await Promise.all([
        api.api.sync.installations.get(),
        api.api.sync.status.get(),
        api.api.sync.deliveries.get(),
        api.api.receiver.status.get(),
      ]);
      if (syncs.error || queue.error || deliveries.error || receiver.error) {
        throw new Error('Could not load sync status.');
      }
      return {
        installations: syncs.data.installations,
        queue: queue.data.queue,
        deliveries: deliveries.data.deliveries,
        receiver: receiver.data,
      };
    },
  });
}
export async function createSampleSync() {
  const result = await api.api['sample-syncs'].post();
  if (result.error) {
    throw new Error('Could not create the sample sync.');
  }
  return result.data;
}
export async function setEnabled(input: { id: string; enabled: boolean }) {
  const result = await api.api.sync
    .installations({ id: input.id })
    .patch({ enabled: input.enabled });
  if (result.error) {
    throw new Error('Could not update this sync.');
  }
}
export async function runSync(input: { id: string; backfill: boolean }) {
  const result = await api.api.sync
    .installations({ id: input.id })
    .run.post({ backfill: input.backfill });
  if (result.error) {
    throw new Error('Could not queue this sync.');
  }
}
export async function setReceiverPaused(paused: boolean) {
  const result = await api.api.receiver.settings.patch({ paused });
  if (result.error) {
    throw new Error('Could not update delivery settings.');
  }
}
export async function retryDelivery(id: string) {
  const result = await api.api.sync.deliveries({ id }).retry.post();
  if (result.error) {
    throw new Error('Could not retry this delivery.');
  }
}

export function githubConnectionsOptions(userId: string) {
  return queryOptions({
    queryKey: [...syncKeys.owner(userId), 'github-connections'],
    queryFn: async () => {
      const result = await api.api.syncs.github.connections.get();
      if (result.error) {
        throw new Error('Could not load GitHub accounts.');
      }
      return result.data;
    },
  });
}
export async function createGithubSync(connectionId: string) {
  const result = await api.api.syncs.github.post({ connectionId });
  if (result.error) {
    throw new Error(
      'Could not create the GitHub sync. Check the account authorization in Providers.',
    );
  }
  return result.data;
}
