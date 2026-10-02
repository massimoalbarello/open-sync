import { chmod, lstat, mkdir, unlink, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { join, resolve } from 'node:path';
import { cronTitle } from './cron-invocation';
import { updateSchedule } from './schedule';

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_SOCKET_MODE = 0o600;
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTP_UNAVAILABLE = 503;
const PROBE_TIMEOUT_MS = 1_000;

/** One half-hourly check for every sync owned by this runtime. */
export async function startCron(input: {
  runtime: { runDue(): Promise<void> };
  /** A private, stable directory owned by this runtime. */
  directory: string;
  /** Report a failed run; the recurring job remains registered for the next invocation. */
  onError(error: unknown): void;
}) {
  const directory = resolve(input.directory);
  await mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  await chmod(directory, PRIVATE_DIRECTORY_MODE);
  const socket = join(directory, 'worker.sock');
  await removeStaleSocket(socket);
  const title = cronTitle(socket);
  let entrypoint = Bun.main;
  if (!Bun.isStandaloneExecutable) {
    // Bun consumes cron arguments in source mode and invokes default.scheduled().
    // Only the absolute import and socket path are generated; the client remains ordinary code.
    entrypoint = join(directory, 'scheduled.ts');
    await writeFile(
      entrypoint,
      `import requestCron from ${JSON.stringify(import.meta.resolve('./cron-client.ts'))};\n` +
        `export default { scheduled: () => requestCron(${JSON.stringify(socket)}) };\n`,
      { mode: PRIVATE_SOCKET_MODE },
    );
  }
  let closed = false;
  const server = Bun.serve({
    unix: socket,
    async fetch(request) {
      this.timeout(request, 0);
      const path = new URL(request.url).pathname;
      if (path === '/health') {
        return new Response(null, { status: HTTP_OK });
      }
      if (path !== '/run' || request.method !== 'POST') {
        return new Response(null, { status: HTTP_NOT_FOUND });
      }
      if (closed) {
        return new Response(null, { status: HTTP_UNAVAILABLE });
      }
      try {
        await input.runtime.runDue();
        return new Response(null, { status: HTTP_OK });
      } catch (error) {
        input.onError(error);
        return new Response(null, { status: HTTP_UNAVAILABLE });
      }
    },
  });
  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= (async () => {
      closed = true;
      try {
        await updateSchedule(() => Bun.cron.remove(title));
      } finally {
        await server.stop(true);
      }
    })();
    return closing;
  };
  try {
    await chmod(socket, PRIVATE_SOCKET_MODE);
    await updateSchedule(() => Bun.cron(entrypoint, '*/30 * * * *', title));
    return { close, [Symbol.asyncDispose]: close };
  } catch (error) {
    await server.stop(true);
    throw error;
  }
}

async function removeStaleSocket(socket: string): Promise<void> {
  const existing = await lstat(socket).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  });
  if (!existing) {
    return;
  }
  if (!existing.isSocket()) {
    throw new Error('The cron worker socket path is occupied by another file.');
  }
  try {
    await probeWorker(socket);
  } catch (error) {
    if (unavailableSocket(error)) {
      await unlink(socket);
      return;
    }
    throw error;
  }
  throw new Error('An Open Sync cron worker already owns this directory.');
}

function unavailableSocket(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    ['ECONNREFUSED', 'ENOENT'].includes(String(error.code))
  );
}

function probeWorker(socket: string): Promise<number> {
  // biome-ignore lint/complexity/useMaxParams: Native Promise executor signature.
  return new Promise((resolve, reject) => {
    const client = request(
      {
        socketPath: socket,
        path: '/health',
        agent: false,
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      },
      (response) => {
        response.on('error', reject);
        response.on('end', () => resolve(response.statusCode!));
        response.resume();
      },
    );
    client.on('error', reject);
    client.end();
  });
}
