import { BadRequestError, NotFoundError } from '#backend/lib/errors.ts';
import { type Actor, MAX_NOTE_LENGTH } from '#backend/models/notes/model.ts';
import type { NotesRepositoryContract } from '#backend/repositories/notes/repository.ts';
export class NotesService {
  constructor(private readonly notes: NotesRepositoryContract) {}
  list({ actor }: { actor: Actor }) {
    return this.notes.list({ ownerId: actor.userId });
  }
  async create({ actor, body }: { actor: Actor; body: string }) {
    const trimmed = body.trim();
    if (!trimmed || trimmed.length > MAX_NOTE_LENGTH) {
      throw new BadRequestError('Write a note of 1–280 characters.');
    }
    const note = { id: crypto.randomUUID(), body: trimmed, createdAt: new Date().toISOString() };
    await this.notes.create({ ownerId: actor.userId, note });
    return note;
  }
  async remove({ actor, id }: { actor: Actor; id: string }) {
    if (!(await this.notes.remove({ ownerId: actor.userId, id }))) {
      throw new NotFoundError();
    }
  }
}
export type NotesServiceContract = Pick<NotesService, 'list' | 'create' | 'remove'>;
