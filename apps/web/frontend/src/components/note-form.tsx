import { Input } from '@base-ui/react/input';
import { Button } from '@repo/ui/button';
import { useForm } from '@tanstack/react-form';
export function NoteForm(input: { onSave: (body: string) => Promise<boolean> }) {
  const form = useForm({
    defaultValues: { body: '' },
    onSubmit: async ({ value }) => {
      if (await input.onSave(value.body)) {
        form.reset();
      }
    },
  });
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <form.Field
        name="body"
        validators={{
          onSubmit: ({ value }) => (value.trim() ? undefined : 'Write something before saving.'),
        }}
      >
        {(field) => (
          <div className="space-y-2">
            <label htmlFor="note" className="font-medium text-sm">
              What’s on your mind?
            </label>
            <Input
              id="note"
              name={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onValueChange={field.handleChange}
              maxLength={280}
              aria-invalid={field.state.meta.errors.length > 0}
              aria-describedby="note-help"
              className="w-full rounded-lg border border-input bg-background px-3 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="An idea, a reminder, a small beginning…"
            />
            <p id="note-help" className="text-muted-foreground text-sm">
              Up to 280 characters.
            </p>
            {field.state.meta.errors.map((error) => (
              <p key={error} role="alert" className="text-destructive text-sm">
                {error}
              </p>
            ))}
          </div>
        )}
      </form.Field>
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(pending) => (
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save note'}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
