import { queryOptions } from '@tanstack/react-query';
import { api, syncApi } from '../lib/api';
import { syncKeys } from './sync';

export function catalogOptions(userId: string) {
  return queryOptions({
    queryKey: [...syncKeys.owner(userId), 'catalog'],
    queryFn: loadCatalog,
  });
}
export async function createSync(input: Parameters<typeof api.api.dashboard.syncs.post>[0]) {
  const result = await api.api.dashboard.syncs.post(input);
  if (result.error) {
    throw new Error('Could not create sync. Please try again.');
  }
  return result.data;
}

export async function loadCatalog() {
  const [sources, types] = await Promise.all([
    syncApi.sync.definitions.get(),
    syncApi.sync['destination-types'].get(),
  ]);
  if (sources.error || types.error) {
    throw new Error('Could not load sources and destinations.');
  }
  return {
    sources: sources.data.definitions,
    types: types.data.types,
  };
}
