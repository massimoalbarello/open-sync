import type { Database } from 'bun:sqlite';
import type { Resource } from '../../models/identity';

export function claimPoll(input: { db: Database; scope: Resource }): string {
  const { db, scope } = input;
  const existing = db
    .query<{ id: string }, [string, string]>(
      'SELECT id FROM polls WHERE owner_id=? AND installation_id=? AND completed_at IS NULL',
    )
    .get(scope.ownerId, scope.id);
  const id = existing?.id ?? `poll_${crypto.randomUUID()}`;
  if (!existing) {
    db.query(
      "INSERT INTO polls(owner_id,id,installation_id,state,started_at) VALUES (?,?,?,'syncing',?)",
    ).run(scope.ownerId, id, scope.id, Date.now());
  }
  db.query(
    "UPDATE polls SET state='syncing',attempt_count=attempt_count+1 WHERE owner_id=? AND id=?",
  ).run(scope.ownerId, id);
  return id;
}

export function updatePoll(input: {
  db: Database;
  ownerId: string;
  runId: string;
  state: string;
}): void {
  const states: Record<string, string> = {
    succeeded: 'succeeded',
    yielded: 'syncing',
    waiting_for_capacity: 'waiting_for_capacity',
    interrupted: 'interrupted',
    paused: 'paused',
  };
  input.db
    .query(`UPDATE polls SET state=?,completed_at=? WHERE owner_id=? AND completed_at IS NULL
    AND id=(SELECT poll_id FROM runs WHERE owner_id=? AND id=?)`)
    .run(
      states[input.state] ?? 'retrying',
      input.state === 'succeeded' ? Date.now() : null,
      input.ownerId,
      input.ownerId,
      input.runId,
    );
}
