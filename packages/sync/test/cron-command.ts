import { runCronCommand } from '../src/cron';

if (!(await runCronCommand({ args: Bun.argv.slice(2) }))) {
  throw new Error('The cron process must not start another runtime.');
}
