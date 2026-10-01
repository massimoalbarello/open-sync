import { chmod, lstat, mkdir, unlink } from 'node:fs/promises';
import { request } from 'node:http';
import { join, resolve } from 'node:path';
import { Crontab } from './execution/crontab';
import type { WorkerSchedule } from './execution/worker';

const CRON_ARGUMENT = '--open-sync-cron';
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_SOCKET_MODE = 0o600;
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTP_UNAVAILABLE = 503;
const PROBE_TIMEOUT_MS = 1_000;
const STARTUP_TIMEOUT_MS = 30_000;
const STARTUP_RETRY_MS = 100;

/** Handle this before starting the embedding application's server or opening its databases. */
export async function runCronCommand(input: { args: readonly string[] }): Promise<boolean> {
  if (input.args[0] !== CRON_ARGUMENT) {
    return false;
  }
  if (input.args.length !== 2 || !input.args[1]) {
    throw new Error(`${CRON_ARGUMENT} requires the private worker socket path.`);
  }
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  for (;;) {
    try {
      const status = await requestWorker({ socket: input.args[1], method: 'POST' });
      if (status !== HTTP_OK) {
        throw new Error(`Open Sync cron execution failed (${status}).`);
      }
      return true;
    } catch (error) {
      if (!unavailableSocket(error) || Date.now() >= deadline) {
        throw error;
      }
      // A host can become reachable before its embedded worker finishes startup.
      await Bun.sleep(STARTUP_RETRY_MS);
    }
  }
}

/** Standard crontab scheduling for any host binary, without web routes or provider-specific jobs. */
export async function startCrontab(input: {
  runtime: { start(schedule: WorkerSchedule): void; runDue(): Promise<void> };
  /** A private, stable directory owned by this runtime. */
  directory: string;
  /** The host's absolute binary path, or Bun followed by its absolute script path and arguments. */
  command: readonly string[];
  /** Cron daemon timezone; defaults to the host process timezone. Use UTC on nibrun. */
  timeZone?: string;
  crontabExecutable?: string;
  /** Scheduling failures require host attention; for a supervised server, shut down and restart. */
  onError(error: unknown): void;
}) {
  const directory = resolve(input.directory);
  await mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  await chmod(directory, PRIVATE_DIRECTORY_MODE);
  const socket = join(directory, 'worker.sock');
  const table = new Crontab({
    id: directory,
    command: [...input.command, CRON_ARGUMENT, socket],
    executable: input.crontabExecutable,
    timeZone: input.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  await removeStaleSocket(socket);
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
        await table.schedule(undefined);
      } finally {
        await server.stop(true);
      }
    })();
    return closing;
  };
  try {
    await chmod(socket, PRIVATE_SOCKET_MODE);
    input.runtime.start({
      scheduleNext: (at) => (closed ? Promise.resolve() : table.schedule(at)),
      onError: input.onError,
    });
    await input.runtime.runDue();
    return { close, [Symbol.asyncDispose]: close };
  } catch (error) {
    await close();
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
    await requestWorker({ socket, method: 'GET' });
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

function requestWorker(input: { socket: string; method: 'GET' | 'POST' }): Promise<number> {
  // node:http has no response deadline: a large sync may legitimately run for many minutes.
  // biome-ignore lint/complexity/useMaxParams: Native Promise executor signature.
  return new Promise((resolve, reject) => {
    const client = request(
      {
        socketPath: input.socket,
        path: input.method === 'POST' ? '/run' : '/health',
        method: input.method,
        agent: false,
        signal: input.method === 'GET' ? AbortSignal.timeout(PROBE_TIMEOUT_MS) : undefined,
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
