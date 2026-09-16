import { Elysia, t } from 'elysia';
import type { Auth } from '#backend/lib/auth/better-auth.ts';
import { ForbiddenError, UnauthorizedError } from '#backend/lib/errors.ts';
import { CreateNoteSchema, NoteSchema } from '#backend/routes/api/notes/model.ts';
import type { NotesServiceContract } from '#backend/services/notes/service.ts';
export function createNotesController(input: {
  auth: Auth;
  notes: NotesServiceContract;
  origin: string;
}) {
  return new Elysia({ prefix: '/notes' })
    .resolve(async ({ request }) => {
      const session = await input.auth.getSession({ headers: request.headers });
      if (!session) {
        throw new UnauthorizedError();
      }
      if (request.method !== 'GET' && request.headers.get('origin') !== input.origin) {
        throw new ForbiddenError('Invalid request origin.');
      }
      return { actor: { userId: session.user.id } };
    })
    .get('/', ({ actor }) => input.notes.list({ actor }), { response: t.Array(NoteSchema) })
    .post('/', ({ actor, body }) => input.notes.create({ actor, body: body.body }), {
      body: CreateNoteSchema,
      response: NoteSchema,
    })
    .delete(
      '/:id',
      async ({ actor, params }) => {
        await input.notes.remove({ actor, id: params.id });
        return { deleted: true };
      },
      {
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        response: t.Object({ deleted: t.Boolean() }),
      },
    );
}
