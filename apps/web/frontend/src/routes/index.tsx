import { Button } from '@repo/ui/button';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { NoteForm } from '../components/note-form';
import { createNote, deleteNote, noteKeys, notesOptions } from '../queries/notes';
import { sessionOptions, signOut } from '../queries/session';
export const Route = createFileRoute('/')({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.fetchQuery(sessionOptions);
    if (!session) {
      throw redirect({ to: '/login' });
    }
    return { userId: session.user.id };
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(notesOptions(context.userId)),
  component: Notebook,
});
function Notebook() {
  const { userId } = Route.useRouteContext();
  const client = useQueryClient();
  const navigate = useNavigate();
  const { data: notes } = useSuspenseQuery(notesOptions(userId));
  const refresh = () => client.invalidateQueries({ queryKey: noteKeys.owner(userId) });
  const create = useMutation({ mutationFn: createNote, onSuccess: refresh });
  const remove = useMutation({ mutationFn: deleteNote, onSuccess: refresh });
  const logout = useMutation({
    mutationFn: signOut,
    onSuccess: async () => {
      client.clear();
      await navigate({ to: '/login' });
    },
  });
  return (
    <main className="mx-auto max-w-2xl space-y-12 px-6 py-10 sm:py-16">
      <header className="flex items-center justify-between gap-4">
        <span className="font-mono text-muted-foreground text-xs uppercase tracking-widest">
          Notebook
        </span>
        <Button variant="ghost" disabled={logout.isPending} onClick={() => logout.mutate()}>
          Sign out
        </Button>
      </header>
      <section className="space-y-3">
        <h1 className="font-semibold text-4xl tracking-tight">Make a little space.</h1>
        <p className="text-muted-foreground">Your ideas, reminders, and things worth keeping.</p>
      </section>
      <NoteForm
        onSave={async (body) => {
          try {
            await create.mutateAsync(body);
            return true;
          } catch {
            return false;
          }
        }}
      />
      {(create.error || remove.error || logout.error) && (
        <p role="alert" className="text-destructive">
          {(create.error || remove.error || logout.error)?.message}
        </p>
      )}
      <section aria-label="Your notes" className="space-y-6">
        <h2 className="font-medium text-lg">Your notes</h2>
        {notes.length === 0 ? (
          <p className="text-muted-foreground">A fresh page. Write your first note above.</p>
        ) : (
          <>
            <p className="text-muted-foreground text-sm">Your latest 50 notes, newest first.</p>
            <ul className="divide-y divide-border">
              {notes.map((note) => (
                <li key={note.id} className="flex items-start justify-between gap-6 py-5">
                  <p className="break-words">{note.body}</p>
                  <Button
                    variant="ghost"
                    disabled={remove.isPending}
                    aria-label={`Delete note: ${note.body}`}
                    onClick={() => remove.mutate(note.id)}
                  >
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </main>
  );
}
