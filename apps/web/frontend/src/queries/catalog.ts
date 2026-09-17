import type { DefinitionRef } from '@open-sync/core/definition';
import type { JsonObject } from '@open-sync/core/json';
import { queryOptions } from '@tanstack/react-query';
import { syncApi } from '../lib/api';
import { syncKeys } from './sync';

export function catalogOptions(userId: string) {
  return queryOptions({
    queryKey: [...syncKeys.owner(userId), 'catalog'],
    queryFn: async () => {
      const [sources, types, destinations, connections] = await Promise.all([
        syncApi.sync.definitions.get(),
        syncApi.sync['destination-types'].get(),
        syncApi.sync.destinations.get(),
        syncApi.providers.connections.get(),
      ]);
      if (sources.error || types.error || destinations.error || connections.error) {
        throw new Error('Could not load sources and destinations.');
      }
      return {
        sources: sources.data.definitions,
        types: types.data.types,
        destinations: destinations.data.destinations,
        connections: connections.data,
      };
    },
  });
}
export async function createDestination(input: { type: string; config: string }) {
  const result = await syncApi.sync.destinations.post({
    type: input.type,
    config: jsonConfig(input.config),
  });
  if (result.error) {
    throw new Error('Could not add destination. Check its configuration against the schema.');
  }
  return result.data;
}
const millisecondsPerMinute = 60_000;
export async function createSync(input: {
  definition: DefinitionRef;
  destinationId: string;
  config: string;
  connection?: { id: string; service: string };
  intervalMinutes: number;
}) {
  const result = await syncApi.sync.installations.post({
    definition: input.definition,
    destinationId: input.destinationId,
    config: jsonConfig(input.config),
    connection: input.connection,
    intervalMs: input.intervalMinutes * millisecondsPerMinute,
  });
  if (result.error) {
    throw new Error('Could not create sync. Check configuration and account permissions.');
  }
  return result.data;
}
function jsonConfig(text: string): JsonObject {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('Configuration must be valid JSON.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Configuration must be a JSON object.');
  }
  return value as JsonObject;
}
