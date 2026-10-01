import { Crontab } from '../src/execution/crontab';

const [id, executable] = Bun.argv.slice(2);
await new Crontab({ id: id!, command: [`/host/${id}`], executable }).install();
