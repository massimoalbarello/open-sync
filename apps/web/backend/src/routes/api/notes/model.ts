import { t } from 'elysia';
import { MAX_NOTE_LENGTH } from '#backend/models/notes/model.ts';
export const NoteSchema = t.Object({
  id: t.String({ format: 'uuid' }),
  body: t.String(),
  createdAt: t.String(),
});
export const CreateNoteSchema = t.Object({
  body: t.String({ minLength: 1, maxLength: MAX_NOTE_LENGTH }),
});
