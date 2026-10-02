import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import requestCron from '../src/execution/cron-client';

const OBSERVATION_MS = 150;
const HTTP_UNAVAILABLE = 503;

test('the cron client waits for completion and reports worker failure without retrying', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cron-client-'));
  const socket = join(directory, 'worker.sock');
  const received = Promise.withResolvers<Request>();
  const finished = Promise.withResolvers<void>();
  let requests = 0;
  const server = Bun.serve({
    unix: socket,
    async fetch(request) {
      requests++;
      received.resolve(request);
      await finished.promise;
      return new Response(null, { status: HTTP_UNAVAILABLE });
    },
  });
  const result = requestCron(socket).then(
    () => 'completed',
    (error: unknown) => error,
  );
  try {
    const request = await received.promise;
    expect(request.method).toBe('POST');
    expect(new URL(request.url).pathname).toBe('/run');
    expect(await Promise.race([result, Bun.sleep(OBSERVATION_MS).then(() => 'pending')])).toBe(
      'pending',
    );
    finished.resolve();
    expect(await result).toEqual(new Error('Open Sync cron failed: 503'));
    expect(requests).toBe(1);
  } finally {
    finished.resolve();
    await result;
    await server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});

test('the cron client retries until the worker socket becomes available', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cron-client-'));
  const socket = join(directory, 'worker.sock');
  const result = requestCron(socket).then(
    () => 'completed',
    (error: unknown) => error,
  );
  let server: ReturnType<typeof Bun.serve> | undefined;
  try {
    await Bun.sleep(OBSERVATION_MS);
    server = Bun.serve({ unix: socket, fetch: () => new Response() });
    expect(await result).toBe('completed');
  } finally {
    await server?.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});
