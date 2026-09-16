import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteDatabase } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { NotesRepository } from '../src/repositories/notes/repository';
import { NotesService } from '../src/services/notes/service';

test('SQLite enforces ownership, constraints, and deletion boundaries', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'app-test-'));
  const database = await createSqliteDatabase({ dataFolder: folder });
  try {
    await runMigrations({ db: database });
    for (const id of ['alice', 'bob']) {
      await database`insert into auth_user (id, name, email, emailVerified, createdAt, updatedAt) values (${id}, ${id}, ${`${id}@test.invalid`}, 0, '2026-01-01', '2026-01-01')`;
    }
    const notes = new NotesService(new NotesRepository(database));
    const alice = { userId: 'alice' };
    const bob = { userId: 'bob' };
    const note = await notes.create({ actor: alice, body: '  Private note  ' });
    expect(note.body).toBe('Private note');
    expect(await notes.list({ actor: bob })).toEqual([]);
    await expect(notes.remove({ actor: bob, id: note.id })).rejects.toThrow('Not Found');
    expect(await notes.list({ actor: alice })).toEqual([note]);
    await expect(notes.create({ actor: alice, body: '  ' })).rejects.toThrow();
    await expect(
      notes.create({ actor: { userId: 'missing' }, body: 'Invalid owner' }),
    ).rejects.toThrow();
    await notes.remove({ actor: alice, id: note.id });
    expect(await notes.list({ actor: alice })).toEqual([]);
    await expect(notes.remove({ actor: alice, id: note.id })).rejects.toThrow('Not Found');
  } finally {
    await database.close();
    await rm(folder, { recursive: true, force: true });
  }
});
