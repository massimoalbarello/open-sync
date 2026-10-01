import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lock } from 'proper-lockfile';

const MINUTE_MS = 60_000;
const COMMAND_TIMEOUT_MS = 10_000;
const REGISTRATION_MARGIN_MS = 11_000;
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
      /** Must match the cron daemon's timezone (nibrun uses UTC). */
      timeZone: string;
    },
  ) {
    this.marker = `open-sync:${createHash('sha256').update(input.id).digest('hex')}`;
    if (!input.command.length) {
      throw new Error('A cron task needs an executable command.');
    }
    this.command = input.command.map(shellArgument).join(' ');
  }
  schedule(at: number | undefined): Promise<void> {
    const operation = updating.then(async () => {
      // All Open Sync binaries for this OS user share one table, including separate hosts.
      const release = await lock(join(tmpdir(), `open-sync-crontab-${process.getuid!()}`), {
        realpath: false,
        stale: LOCK_STALE_MS,
        retries: { retries: LOCK_RETRIES, minTimeout: LOCK_RETRY_MS, maxTimeout: LOCK_RETRY_MS },
      });
      try {
        await this.replace(at);
      } finally {
        await release();
      }
    });
    updating = operation.catch(() => undefined);
    return operation;
  }
  private async replace(at: number | undefined): Promise<void> {
    const current = await this.read();
    // Compute after reading: the write must finish before the selected minute begins.
    const expression =
      at === undefined ? undefined : cronExpression({ at, timeZone: this.input.timeZone });
    const entry = expression === undefined ? '' : `${expression} ${this.command}\n`;
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
    if (
      input.allowMissing &&
      code === NO_CRONTAB_EXIT_CODE &&
      !stdout &&
      /no crontab for /i.test(stderr)
    ) {
      return '';
    }
    throw new Error(`crontab ${input.args.join(' ')} failed: ${stderr.trim() || `exit ${code}`}`);
  }
}

function shellArgument(value: string): string {
  // Cron processes percent signs before the shell; nibrun passes commands directly to sh.
  // Refuse this ambiguous syntax instead of emitting a command that differs across hosts.
  if (/[\r\n\0%]/.test(value)) {
    throw new Error('Cron command arguments cannot contain newlines, NUL, or percent signs.');
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function cronExpression(input: { at: number; timeZone: string }): string {
  if (!Number.isSafeInteger(input.at) || input.at < 0) {
    throw new Error('Invalid next cron timestamp.');
  }
  const next =
    Math.ceil(Math.max(input.at, Date.now() + REGISTRATION_MARGIN_MS) / MINUTE_MS) * MINUTE_MS;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: input.timeZone,
    minute: 'numeric',
    hour: 'numeric',
    hourCycle: 'h23',
    day: 'numeric',
    month: 'numeric',
  }).formatToParts(next);
  const field = (name: string) => Number(parts.find((part) => part.type === name)!.value);
  return `${field('minute')} ${field('hour')} ${field('day')} ${field('month')} *`;
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
