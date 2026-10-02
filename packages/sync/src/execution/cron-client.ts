import { request } from 'node:http';

const STARTUP_TIMEOUT_MS = 30_000;
const RETRY_INTERVAL_MS = 100;
const HTTP_OK = 200;

/** Wait for the existing worker to finish, retrying only while its socket is unavailable. */
export default async function requestCron(socketPath: string): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  for (;;) {
    try {
      await run(socketPath);
      return;
    } catch (error) {
      const unavailable =
        error instanceof Error &&
        'code' in error &&
        (error.code === 'ECONNREFUSED' || error.code === 'ENOENT');
      if (!unavailable || Date.now() >= deadline) {
        throw error;
      }
      await Bun.sleep(RETRY_INTERVAL_MS);
    }
  }
}

function run(socketPath: string): Promise<void> {
  // biome-ignore lint/complexity/useMaxParams: Native Promise executor signature.
  return new Promise((resolve, reject) => {
    const client = request(
      { socketPath, path: '/run', method: 'POST', agent: false },
      (response) => {
        response.on('error', reject);
        response.on('end', () => {
          if (response.statusCode === HTTP_OK) {
            resolve();
          } else {
            reject(new Error(`Open Sync cron failed: ${response.statusCode}`));
          }
        });
        response.resume();
      },
    );
    client.on('error', reject);
    client.end();
  });
}
