import { join } from 'node:path';
import { openDatabase } from '../src/db/client';
import { defaultLimits } from '../src/models/limits';
import { SqliteAcquisition } from '../src/repositories/acquisition/sqlite';
import { SqliteCatalog } from '../src/repositories/catalog/sqlite';
import { SqliteDeliveries } from '../src/repositories/delivery/sqlite';
import { alpha, fixture, page } from './support';

const db = openDatabase(join(process.argv[2]!, 'sync.db'));
const catalog = new SqliteCatalog(db);
const acquisition = new SqliteAcquisition({ db, limits: defaultLimits, historyLimit: 1 });
const deliveries = new SqliteDeliveries(db);
const leaseMs = 60_000;

const destination = { type: 'local', config: {} };
catalog.createSync({
  ...alpha,
  destination,
  definition: fixture.definition.id,
  config: { count: 3 },
  initialCheckpoint: 0,
});
acquisition.commit({ lease: acquisition.claim(leaseMs)!, page, definition: fixture.definition });
acquisition.claim(leaseMs);
deliveries.claim(leaseMs);
process.kill(process.pid, 'SIGKILL');
