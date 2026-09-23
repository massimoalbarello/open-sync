import { expect, test } from 'bun:test';
import type { SyncRegistration, SyncStep } from '../src/models/definition';
import type { Delivery } from '../src/models/delivery';
import { accepted, alpha, configure, fixture, runtime, savedSync } from './support';

test('each record kind uses its own schema and an invalid kind leaves the whole page uncommitted', async () => {
  const received: Delivery[] = [];
  let invalid = false;
  const registration: SyncRegistration = {
    definition: {
      ...fixture.definition,
      kinds: {
        ...fixture.definition.kinds,
        profile: {
          type: 'object',
          properties: { active: { type: 'boolean' } },
          required: ['active'],
          additionalProperties: false,
        },
      },
    },
    load: () => ({
      // biome-ignore lint/suspicious/useAwait: Trusted fixture implements the asynchronous source boundary.
      async step(): Promise<SyncStep> {
        return {
          deliverable: {
            records: [
              { operation: 'upsert', kind: 'item', id: 'same-id', data: { value: 1 } },
              {
                operation: 'upsert',
                kind: 'profile',
                id: 'same-id',
                data: invalid ? { active: 'wrong' } : { active: true },
              },
            ],
          },
          checkpoint: 1,
          complete: true,
        };
      },
    }),
  };
  const f = runtime({
    registration,
    destination: {
      ...accepted,
      deliver: ({ delivery }) => {
        received.push(delivery);
        return Promise.resolve({ status: 'accepted' });
      },
    },
  });
  try {
    const sync = await configure(f.engine);
    const resource = { ...alpha, id: sync.id };
    invalid = true;
    await f.engine.tick();
    expect(savedSync({ path: f.files.path, scope: resource })).toMatchObject({
      checkpoint: 0,
      status: 'invalid_page',
    });
    expect(received).toHaveLength(0);
    invalid = false;
    f.engine.api.queueRun(resource);
    await f.engine.tick();
    await f.engine.tick();
    expect(received[0]!.deliverable.records).toMatchObject([
      { kind: 'item', data: { value: 1 } },
      { kind: 'profile', data: { active: true } },
    ]);
    f.engine.api.queueRun(resource);
    await f.engine.tick();
    expect(received).toHaveLength(1);
  } finally {
    await f.close();
  }
});
