import { startCron } from '../src/execution/cron';

const directory = process.argv[2]!;
const cron = await startCron({
  directory,
  runtime: {
    async runDue() {
      await Bun.write(`${directory}/ran`, 'done');
    },
  },
  onError: console.error,
});
console.log('ready');
process.once('SIGTERM', () => void cron.close());
