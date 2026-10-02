import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lock } from 'proper-lockfile';

const LOCK_STALE_MS = 30_000;
const LOCK_RETRIES = 40;
const LOCK_RETRY_MS = 1_000;
let updating = Promise.resolve();

/** Bun replaces the user's entire crontab; serialize changes across Open Sync hosts. */
export function updateSchedule(operation: () => Promise<void>): Promise<void> {
  const pending = updating.then(async () => {
    const release = await lock(join(tmpdir(), `open-sync-crontab-${process.getuid!()}`), {
      realpath: false,
      stale: LOCK_STALE_MS,
      retries: { retries: LOCK_RETRIES, minTimeout: LOCK_RETRY_MS, maxTimeout: LOCK_RETRY_MS },
    });
    try {
      if (process.platform === 'linux') {
        await verifyCrontabReadable();
      }
      await operation();
    } finally {
      await release();
    }
  });
  updating = pending.catch(() => undefined);
  return pending;
}

// Bun 1.4 treats every `crontab -l` exit 1 as an empty table. Reject permission/service errors
// before asking it to replace the table; only the documented missing-table responses are safe.
async function verifyCrontabReadable(): Promise<void> {
  const child = Bun.spawn(['crontab', '-l'], {
    env: { ...process.env, LC_ALL: 'C' },
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 10_000,
  });
  const [code, output, error] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code === 0) {
    return;
  }
  if (
    code === 1 &&
    !output &&
    (/^no crontab for [^\r\n]+$/i.test(error.trim()) ||
      /^crontab: can't open '[^/'\r\n]+': No such file or directory$/.test(error.trim()))
  ) {
    return;
  }
  throw new Error(`Cannot read crontab: ${error.trim() || `exit ${code}`}`);
}
