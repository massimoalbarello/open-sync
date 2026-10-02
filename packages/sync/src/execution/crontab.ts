import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lock } from 'proper-lockfile';

const SCHEDULE = '*/30 * * * *';
const COMMAND_TIMEOUT_MS = 10_000;
const NO_CRONTAB_EXIT_CODE = 1;
const LOCK_STALE_MS = 30_000;
const LOCK_RETRIES = 40;
const LOCK_RETRY_MS = 1_000;

// crontab replaces the whole table. Serialize updates made by runtimes in this process.
let updating = Promise.resolve();

export class Crontab {
  private readonly marker: string;
  private readonly command: string;
  constructor(
    private readonly input: {
      id: string;
      command: readonly string[];
      executable?: string;
    },
  ) {
    this.marker = `open-sync:${createHash('sha256').update(input.id).digest('hex')}`;
    if (!input.command.length) {
      throw new Error('A cron task needs an executable command.');
    }
    this.command = `BUN_BE_BUN=1 ${input.command.map(shellArgument).join(' ')}`;
  }
  install(): Promise<void> {
    return this.update(`${SCHEDULE} ${this.command}\n`);
  }
  remove(): Promise<void> {
    return this.update('');
  }
  private update(entry: string): Promise<void> {
    const operation = updating.then(async () => {
      // All Open Sync binaries for this OS user share one table, including separate hosts.
      const release = await lock(join(tmpdir(), `open-sync-crontab-${process.getuid!()}`), {
        realpath: false,
        stale: LOCK_STALE_MS,
        retries: { retries: LOCK_RETRIES, minTimeout: LOCK_RETRY_MS, maxTimeout: LOCK_RETRY_MS },
      });
      try {
        await this.replace(entry);
      } finally {
        await release();
      }
    });
    updating = operation.catch(() => undefined);
    return operation;
  }
  private async replace(entry: string): Promise<void> {
    const current = await this.read();
    const remaining = removeEntry({ text: current, marker: this.marker });
    const next = entry
      ? `# ${this.marker} begin\n${entry}# ${this.marker} end\n${remaining}`
      : remaining;
    if (next !== current) {
      await this.execute({ args: ['-'], stdin: next });
    }
  }
  private async read(): Promise<string> {
    return await this.execute({ args: ['-l'], allowMissing: true });
  }
  private async execute(input: { args: string[]; stdin?: string; allowMissing?: boolean }) {
    const child = Bun.spawn([this.input.executable ?? 'crontab', ...input.args], {
      env: { ...process.env, LC_ALL: 'C' },
      stdin: input.stdin === undefined ? 'ignore' : new Blob([input.stdin]),
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: COMMAND_TIMEOUT_MS,
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (code === 0) {
      return stdout;
    }
    const error = stderr.trim();
    if (
      input.allowMissing &&
      code === NO_CRONTAB_EXIT_CODE &&
      !stdout &&
      (/^no crontab for [^\r\n]+$/i.test(error) ||
        /^crontab: can't open '[^/'\r\n]+': No such file or directory$/.test(error))
    ) {
      return '';
    }
    throw new Error(`crontab ${input.args.join(' ')} failed: ${error || `exit ${code}`}`);
  }
}

function shellArgument(value: string): string {
  // Cron processes percent signs before shell quoting, so they cannot be literal arguments.
  if (/[\r\n\0%]/.test(value)) {
    throw new Error('Cron command arguments cannot contain newlines, NUL, or percent signs.');
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function removeEntry(input: { text: string; marker: string }): string {
  const begin = `# ${input.marker} begin\n`;
  const end = `# ${input.marker} end\n`;
  const start = input.text.indexOf(begin);
  if (start < 0) {
    return input.text;
  }
  const finish = input.text.indexOf(end, start + begin.length);
  if (finish < 0) {
    throw new Error('Malformed Open Sync crontab entry; the table was left unchanged.');
  }
  return input.text.slice(0, start) + input.text.slice(finish + end.length);
}
