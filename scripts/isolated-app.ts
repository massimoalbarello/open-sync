import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const START_TIMEOUT_MS = 60_000;
const PROBE_TIMEOUT_MS = 1_000;
const PROBE_INTERVAL_MS = 100;
const STOP_TIMEOUT_MS = 5_000;
function availablePort() {
  const server = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = server.port!;
  server.stop(true);
  return port;
}
async function stopProcess(child: ReturnType<typeof Bun.spawn>) {
  if (child.exitCode !== null) {
    return;
  }
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), STOP_TIMEOUT_MS);
  try {
    await child.exited;
  } finally {
    clearTimeout(timer);
  }
}
export async function startIsolatedApp(input: { serverCommand?: string[] } = {}) {
  const port = availablePort();
  let frontendPort = availablePort();
  while (port === frontendPort) {
    frontendPort = availablePort();
  }
  const origin = `http://localhost:${frontendPort}`;
  const dataFolder = await mkdtemp(join(tmpdir(), 'open-sync-isolated-'));
  const environment = {
    ...process.env,
    PORT: String(port),
    FRONTEND_PORT: String(frontendPort),
    BASE_URL: origin,
    DATA_FOLDER: dataFolder,
    BETTER_AUTH_SECRET: crypto.randomUUID(),
  };
  const spawn = (command: string[]) =>
    Bun.spawn(command, {
      cwd: join(import.meta.dir, '../apps/web'),
      stdout: 'inherit',
      stderr: 'inherit',
      env: environment,
    });
  const serverCommand = input.serverCommand ?? ['bun', 'run', '--no-orphans', 'dev:server'];
  let child = spawn(serverCommand);
  const frontend = spawn(['bun', 'run', '--no-orphans', 'dev:client']);
  async function ready() {
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || frontend.exitCode !== null) {
        throw new Error('Isolated application exited before startup.');
      }
      const healthy = await fetch(`${origin}/api/health`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      })
        .then((response) => response.ok)
        .catch(() => false);
      if (healthy) {
        return;
      }
      await Bun.sleep(PROBE_INTERVAL_MS);
    }
    throw new Error('Isolated application startup timed out.');
  }
  let stopped = false;
  const stop = async () => {
    if (stopped) {
      return;
    }
    stopped = true;
    await stopProcess(child);
    await stopProcess(frontend);
    await rm(dataFolder, { recursive: true, force: true });
  };
  try {
    await ready();
    return {
      origin,
      dataFolder,
      get child() {
        return child;
      },
      stop,
      async restartServer(input?: { beforeStart(): Promise<void> }) {
        await stopProcess(child);
        await input?.beforeStart();
        child = spawn(serverCommand);
        await ready();
      },
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
