import { Crontab } from '../src/execution/crontab';

const [id, executable] = Bun.argv.slice(2);
await new Crontab({ id: id!, command: [`/host/${id}`], executable, timeZone: 'UTC' }).schedule(
  Date.parse('2030-01-02T03:04:01Z'),
);
