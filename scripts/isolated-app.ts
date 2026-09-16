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
export async function startIsolatedApp() {
  const port = availablePort();
  let frontendPort = availablePort();
  while (port === frontendPort) {
    frontendPort = availablePort();
  }
  const origin = `http://localhost:${frontendPort}`;
  const dataFolder = await mkdtemp(join(tmpdir(), 'bun-app-isolated-'));
  const child = Bun.spawn(['bun', 'run', '--no-orphans', 'dev'], {
    cwd: join(import.meta.dir, '..'),
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      PORT: String(port),
      FRONTEND_PORT: String(frontendPort),
      BASE_URL: origin,
      DATA_FOLDER: dataFolder,
      BETTER_AUTH_SECRET: crypto.randomUUID(),
    },
  });
  let stopped = false;
  const stop = async () => {
    if (stopped) {
      return;
    }
    stopped = true;
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), STOP_TIMEOUT_MS);
      try {
        await child.exited;
      } finally {
        clearTimeout(timer);
      }
    }
    await rm(dataFolder, { recursive: true, force: true });
  };
  try {
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error('Isolated application exited before startup.');
      }
      const ready = await fetch(`${origin}/api/health`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      })
        .then((response) => response.ok)
        .catch(() => false);
      if (ready) {
        return { origin, dataFolder, child, stop };
      }
      await Bun.sleep(PROBE_INTERVAL_MS);
    }
    throw new Error('Isolated application startup timed out.');
  } catch (error) {
    await stop();
    throw error;
  }
}
