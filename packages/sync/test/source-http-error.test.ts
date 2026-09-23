import { expect, spyOn, test } from 'bun:test';
import type { SyncEvent } from '../src/execution/diagnostics';
import { SourceHttpError, type SyncContext } from '../src/models/definition';
import { createSyncRuntime } from '../src/runtime';
import { accepted, alpha, configure, fixture, page, savedSync, storage } from './support';

const retryMs = 30_000;
const rateLimited = 429;
const forbidden = 403;
const unavailable = 503;

test.each(
  Object.values({
    timeout: 408,
    conflict: 409,
    early: 425,
    limit: 429,
    internal: 500,
    gateway: 502,
    unavailable: 503,
    gatewayTimeout: 504,
  }),
)('HTTP %s backs off at the shared engine boundary', async (status) => {
  const files = storage();
  const events: SyncEvent[] = [];
  const now = Date.now();
  const clock = spyOn(Date, 'now').mockReturnValue(now);
  const engine = createSyncRuntime({
    databasePath: files.path,
    definitions: [
      {
        ...fixture,
        load: () => {
          throw new SourceHttpError({ status });
        },
      },
    ],
    destinationTypes: { local: accepted },
    onEvent: (event) => events.push(event),
  });
  try {
    const sync = await configure(engine);
    await engine.tick();
    expect(savedSync({ path: files.path, scope: { ...alpha, id: sync.id } })).toMatchObject({
      enabled: true,
      checkpoint: 0,
      status: 'retrying',
      errorCode: `source_http_${status}`,
      nextDueAt: now + retryMs,
    });
    expect(events[0]?.fields).toEqual({
      httpStatus: status,
      failureCount: 1,
      retryAfterMs: retryMs,
    });
  } finally {
    await engine.close();
    clock.mockRestore();
    files.close();
  }
});

test.each(
  Object.values({
    invalid: 400,
    authentication: 401,
    permission: 403,
    missing: 404,
    unprocessable: 422,
  }),
)('HTTP %s pauses durably and resumes the saved checkpoint after intervention', async (status) => {
  const files = storage();
  let rejected = true;
  const seen: unknown[] = [];
  const options = {
    databasePath: files.path,
    definitions: [
      {
        ...fixture,
        load: () => ({
          // biome-ignore lint/suspicious/useAwait: A promise is the source execution contract.
          async step({ checkpoint }: { checkpoint: unknown }) {
            seen.push(checkpoint);
            if (checkpoint === 0) {
              return page;
            }
            if (rejected) {
              throw new SourceHttpError({ status });
            }
            return { ...page, complete: true };
          },
        }),
      },
    ],
    destinationTypes: { local: accepted },
  };
  let engine = createSyncRuntime(options);
  try {
    const sync = await configure(engine);
    const scope = { ...alpha, id: sync.id };
    await engine.tick();
    await engine.tick();
    expect(savedSync({ path: files.path, scope: scope })).toMatchObject({
      enabled: false,
      checkpoint: 1,
      status: 'disabled',
      errorCode: `source_http_${status}`,
    });
    await engine.close();
    engine = createSyncRuntime(options);
    await engine.tick();
    expect(seen).toEqual([0, 1]);
    rejected = false;
    await engine.api.setEnabled({ ...scope, enabled: true });
    await engine.tick();
    expect(seen).toEqual([0, 1, 1]);
    expect(savedSync({ path: files.path, scope: scope })).toMatchObject({
      enabled: true,
      status: 'succeeded',
    });
  } finally {
    await engine.close();
    files.close();
  }
});

test.each([rateLimited, forbidden, unavailable])(
  'asset fetch HTTP %s retains engine recovery across restart without exhausting the attachment',
  async (status) => {
    const files = storage();
    const events: SyncEvent[] = [];
    let now = Date.now();
    const clock = spyOn(Date, 'now').mockImplementation(() => now);
    let rejected = true;
    const options = {
      databasePath: files.path,
      definitions: [
        {
          ...fixture,
          load: () => ({
            async step(context: SyncContext) {
              if (context.checkpoint === 0) {
                return page;
              }
              await context.assets.capture({
                id: 'file',
                version: '1',
                name: 'file.bin',
                mediaType: 'application/octet-stream',
                read: () =>
                  rejected
                    ? Promise.reject(new SourceHttpError({ status }))
                    : Promise.resolve(new Blob(['attachment']).stream()),
              });
              return { ...page, complete: true };
            },
          }),
        },
      ],
      destinationTypes: { local: accepted },

      onEvent: (event: SyncEvent) => events.push(event),
    };
    let engine = createSyncRuntime(options);
    try {
      const sync = await configure(engine);
      const scope = { ...alpha, id: sync.id };
      const delays = Object.values({ first: 30_000, second: 60_000, third: 120_000 });
      await engine.tick();
      for (const [index, delay] of delays.entries()) {
        await engine.tick();
        expect(savedSync({ path: files.path, scope: scope })).toMatchObject({
          enabled: status !== forbidden,
          checkpoint: 1,
          status: status === forbidden ? 'disabled' : 'retrying',
          errorCode: `source_http_${status}`,
          nextDueAt: now + delay,
        });
        expect(events.at(-1)?.fields).toEqual({
          httpStatus: status,
          failureCount: index + 1,
          ...(status === forbidden ? { paused: true } : { retryAfterMs: delay }),
        });
        await engine.close();
        engine = createSyncRuntime(options);
        now += delay;
        if (status === forbidden) {
          await engine.api.setEnabled({ ...scope, enabled: true });
        }
      }
      rejected = false;
      await engine.tick();
      expect(savedSync({ path: files.path, scope: scope })).toMatchObject({
        enabled: true,
        status: 'succeeded',
      });
    } finally {
      await engine.close();
      clock.mockRestore();
      files.close();
    }
  },
);

test('source HTTP errors validate their status without retaining provider payloads', () => {
  const response = {
    status: forbidden,
    headers: { 'retry-after': '120', 'set-cookie': 'private-secret' },
    body: { message: 'private-secret' },
  };
  const error = new SourceHttpError(response);
  expect(error).toMatchObject({ code: 'source_http_403', status: forbidden });
  expect(JSON.stringify(error)).not.toContain('private-secret');
  const invalidStatuses = {
    success: 200,
    belowErrorRange: 399,
    aboveErrorRange: 600,
    fractional: 429.5,
  };
  for (const status of Object.values(invalidStatuses)) {
    expect(() => new SourceHttpError({ status })).toThrow(TypeError);
  }
});
