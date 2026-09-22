import { expect, test } from 'bun:test';
import { openDatabase } from '../src/db/client';
import { fixture, page, repositories } from './support';

test('every attempt requires a poll and recorded counts', () => {
  const f = repositories();
  try {
    const leaseMs = 60_000;
    f.acquisition.claim(leaseMs);
    for (const column of ['poll_id', 'records_processed', 'records_changed']) {
      expect(() => f.db.exec(`UPDATE runs SET ${column}=NULL`)).toThrow('NOT NULL');
    }
    expect(() => f.db.exec("UPDATE runs SET poll_id='missing'")).toThrow('FOREIGN KEY');
    expect(f.db.query('SELECT records_processed,records_changed FROM runs').get()).toEqual({
      records_processed: 0,
      records_changed: 0,
    });
  } finally {
    f.close();
  }
});

test('reopening the current schema preserves checkpoints, queued bodies and leases', () => {
  const f = repositories();
  const leaseMs = 60_000;
  try {
    const lease = f.acquisition.claim(leaseMs)!;
    f.acquisition.commit({
      lease,
      page: { ...page, checkpoint: 7 },
      definition: fixture.definition,
    });
    f.acquisition.claim(leaseMs);
    f.deliveries.claim(leaseMs);
    const deliveries = f.db.query('SELECT * FROM deliveries').all();
    const before = f.db.query('SELECT * FROM installations').all();
    const runs = f.db.query('SELECT * FROM runs').all();
    const reopened = openDatabase(f.files.path);
    try {
      expect(reopened.query('SELECT * FROM installations').all()).toEqual(before);
      expect(reopened.query('SELECT * FROM runs').all()).toEqual(runs);
      expect(reopened.query('SELECT * FROM deliveries').all()).toEqual(deliveries);
      expect(reopened.query('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    } finally {
      reopened.close();
    }
  } finally {
    f.close();
  }
});
