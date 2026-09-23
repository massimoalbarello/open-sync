import { expect, test } from 'bun:test';
import type { SyncRegistration, SyncStep } from '../src/models/definition';
import type { Deliverable } from '../src/models/delivery';
import { defaultLimits } from '../src/models/limits';
import { preparePage } from '../src/models/page';
import { accepted, alpha, configure, fixture, runtime, savedSync } from './support';

test('each record kind uses its own schema and an invalid kind leaves the whole page uncommitted', async () => {
  const received: Deliverable[] = [];
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
          records: [
            { operation: 'upsert', kind: 'item', id: 'same-id', data: { value: 1 } },
            {
              operation: 'upsert',
              kind: 'profile',
              id: 'same-id',
              data: invalid ? { active: 'wrong' } : { active: true },
            },
          ],
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
      deliver: ({ deliverable: delivery }) => {
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
      status: 'retrying',
      errorCode: 'invalid_page',
    });
    expect(received).toHaveLength(0);
    invalid = false;
    f.engine.api.runNow(resource);
    await f.engine.tick();
    await f.engine.tick();
    expect(received[0]!.records).toMatchObject([
      { kind: 'item', data: { value: 1 } },
      { kind: 'profile', data: { active: true } },
    ]);
    f.engine.api.runNow(resource);
    await f.engine.tick();
    expect(received).toHaveLength(1);
  } finally {
    await f.close();
  }
});

test('content is independent of the data schema and invalid content rejects the entire page', () => {
  const page = (content: unknown) =>
    ({
      records: [{ operation: 'upsert', kind: 'item', id: 'one', data: { value: 1 }, content }],
      checkpoint: 1,
      complete: true,
    }) as SyncStep;
  const valid = { format: 'markdown', body: '# Full record\n\nNo copy in data.' };
  expect(
    preparePage({ page: page(valid), definition: fixture.definition, limits: defaultLimits })
      .records[0],
  ).toMatchObject({ content: valid });
  for (const invalid of [
    null,
    '',
    [],
    { format: 'html', body: '<p>No</p>' },
    { format: 'markdown', body: 1 },
    { format: 'markdown', body: '', extra: true },
  ]) {
    expect(() =>
      preparePage({ page: page(invalid), definition: fixture.definition, limits: defaultLimits }),
    ).toThrow();
  }
});
