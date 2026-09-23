import { expect, test } from 'bun:test';
import type { SyncStep } from '../src/models/definition';
import type { Deliverable } from '../src/models/delivery';
import { defaultLimits } from '../src/models/limits';
import { preparePage } from '../src/models/page';
import type { RecordContent } from '../src/models/record';
import { accepted, alpha, configure, fixture, runtime } from './support';

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

test('content-only changes and removal advance revisions, and deduplicate unchanged records', async () => {
  let content: RecordContent | undefined;
  const received: Deliverable[] = [];
  const f = runtime({
    registration: {
      ...fixture,
      load: () => ({
        // biome-ignore lint/suspicious/useAwait: The fixture implements the asynchronous source boundary.
        async step() {
          return {
            records: [
              {
                operation: 'upsert',
                kind: 'item',
                id: 'one',
                data: { value: 1 },
                ...(content ? { content } : {}),
              },
            ],
            checkpoint: 1,
            complete: true,
          };
        },
      }),
    },
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
    const run = async () => {
      f.engine.api.runNow({ ...alpha, id: sync.id });
      await f.engine.tick();
      await f.engine.tick();
    };
    await run();
    content = { format: 'markdown', body: '# New content' };
    await run();
    await run();
    content = { format: 'markdown', body: '# Updated content' };
    await run();
    content = undefined;
    await run();
    const expectedRevisions = Array.from(
      { length: received.length },
      // biome-ignore lint/complexity/useMaxParams: Array.from supplies the revision index.
      (_, index) => index + 1,
    );
    const expectedDeliveries = 4;
    expect(received).toHaveLength(expectedDeliveries);
    expect(received.map((delivery) => delivery.records[0]!.revision)).toEqual(expectedRevisions);
    expect(received[1]!.records[0]).toMatchObject({
      content: { format: 'markdown', body: '# New content' },
    });
    expect(received[3]!.records[0]).not.toHaveProperty('content');
  } finally {
    await f.close();
  }
});
