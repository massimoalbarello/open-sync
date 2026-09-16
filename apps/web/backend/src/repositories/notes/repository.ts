import { type TypedSQL, withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import { NOTE_PAGE_SIZE, type Note } from '#backend/models/notes/model.ts';
import type { Queries } from '#backend/queries.gen.ts';
export interface NotesRepositoryContract {
  list(input: { ownerId: string }): Promise<Note[]>;
  create(input: { ownerId: string; note: Note }): Promise<void>;
  remove(input: { ownerId: string; id: string }): Promise<boolean>;
}
export class NotesRepository implements NotesRepositoryContract {
  private readonly sql: TypedSQL<Queries>;
  constructor(database: SQL) {
    this.sql = withTypes<Queries>(database);
  }
  async list({ ownerId }: { ownerId: string }) {
    return await this.sql.ListNotes`
      /* @type createdAt string */
      select id, body, created_at as "createdAt" from notes
      where owner_id = ${ownerId} order by created_at desc, id desc limit ${NOTE_PAGE_SIZE}
    `;
  }
  async create({ ownerId, note }: { ownerId: string; note: Note }) {
    await this.sql.CreateNote`
      insert into notes (id, owner_id, body, created_at)
      values (${note.id}, ${ownerId}, ${note.body}, ${note.createdAt})
    `;
  }
  async remove({ ownerId, id }: { ownerId: string; id: string }) {
    const rows = await this.sql
      .RemoveNote`delete from notes where owner_id = ${ownerId} and id = ${id} returning id`;
    return rows.length > 0;
  }
}
