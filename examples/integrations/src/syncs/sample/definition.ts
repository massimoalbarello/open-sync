import type { SyncRegistration } from '@open-sync/core/definition';

const maxCount = 100;
const maxPageSize = 10;
export const sampleSync: SyncRegistration = {
  definition: {
    name: 'Sample data',
    description:
      'Synthetic numbered records for testing checkpoints and destinations without a provider. Once complete, later polls produce no new records.',
    id: 'sample',
    version: '1',
    artifactId: 'open-sync.sample/1',
    configSchema: {
      type: 'object',
      properties: {
        count: { type: 'integer', minimum: 1, maximum: maxCount },
        pageSize: { type: 'integer', minimum: 1, maximum: maxPageSize },
      },
      required: ['count', 'pageSize'],
      additionalProperties: false,
    },
    checkpointSchema: { type: 'integer', minimum: 0 },
    initialCheckpoint: 0,
    kinds: {
      item: {
        type: 'object',
        properties: { value: { type: 'integer' } },
        required: ['value'],
        additionalProperties: false,
      },
    },
  },
  load: () => ({
    // biome-ignore lint/suspicious/useAwait: Implements the host's asynchronous acquisition boundary without external I/O.
    async *run({ config, checkpoint, signal }) {
      let cursor = Number(checkpoint);
      const count = Number(config.count);
      do {
        signal.throwIfAborted();
        const end = Math.min(count, cursor + Number(config.pageSize));
        const records = [];
        for (let value = cursor; value < end; value++) {
          records.push({
            operation: 'upsert' as const,
            kind: 'item',
            id: String(value),
            data: { value },
          });
        }
        cursor = end;
        yield { deliverable: { records }, checkpoint: cursor, complete: cursor === count };
      } while (cursor < count);
    },
  }),
};
