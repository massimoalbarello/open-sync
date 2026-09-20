import { queryOptions } from '@tanstack/react-query';
import { api, syncApi } from '../lib/api';
import { syncKeys } from './sync';

export function catalogOptions(userId: string) {
  return queryOptions({
    queryKey: [...syncKeys.owner(userId), 'catalog'],
    queryFn: async () => {
      const [sources, types, destinations] = await Promise.all([
        syncApi.sync.definitions.get(),
        syncApi.sync['destination-types'].get(),
        syncApi.sync.destinations.get(),
      ]);
      if (sources.error || types.error || destinations.error) {
        throw new Error('Could not load sources and destinations.');
      }
      return {
        sources: sources.data.definitions,
        types: types.data.types,
        destinations: destinations.data.destinations,
      };
    },
  });
}
export async function createSync(input: { source: string; destination: 'local' }) {
  const result = await api.api.dashboard.syncs.post(input);
  if (result.error) {
    throw new Error('Could not create sync. Please try again.');
  }
  return result.data;
}
