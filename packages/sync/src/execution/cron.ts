import { chmod, lstat, mkdir, unlink, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { join, resolve } from 'node:path';
import { Crontab } from './crontab';

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_SOCKET_MODE = 0o600;
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTP_UNAVAILABLE = 503;
const PROBE_TIMEOUT_MS = 1_000;

// The compiled host already contains Bun. Run only this client through its documented CLI mode,
// so embedding applications need no cron argument handler and no second database initialization.
const CRON_CLIENT = `
const { request } = require('node:http');
const deadline = Date.now() + 30000;
for (;;) {
  try {
    await new Promise((resolve, reject) => {
      const client = request({socketPath: process.argv[2], path: '/run', method: 'POST', agent: false}, response => {
        response.on('error', reject);
        response.on('end', () => response.statusCode === 200 ? resolve() : reject(new Error('Open Sync cron failed: ' + response.statusCode)));
        response.resume();
      });
      client.on('error', reject);
      client.end();
    });
    break;
  } catch (error) {
    if (!['ECONNREFUSED', 'ENOENT'].includes(error.code) || Date.now() >= deadline) throw error;
    await Bun.sleep(100);
  }
}
`;

/** One half-hourly check for every sync owned by this runtime. */
export async function startCrontab(input: {
  runtime: { runDue(): Promise<void> };
  /** A private, stable directory owned by this runtime. */
  directory: string;
  crontabExecutable?: string;
  /** Report a failed run; the recurring job remains registered for the next invocation. */
  onError(error: unknown): void;
}) {
  const directory = resolve(input.directory);
  await mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  await chmod(directory, PRIVATE_DIRECTORY_MODE);
  const socket = join(directory, 'worker.sock');
  await removeStaleSocket(socket);
  const client = join(directory, 'request.mjs');
  await writeFile(client, CRON_CLIENT, { mode: PRIVATE_SOCKET_MODE });
  const table = new Crontab({
    id: directory,
    command: [process.execPath, client, socket],
    executable: input.crontabExecutable,
  });
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
        await table.remove();
      } finally {
        await server.stop(true);
      }
    })();
    return closing;
  };
  try {
    await chmod(socket, PRIVATE_SOCKET_MODE);
    await table.install();
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
