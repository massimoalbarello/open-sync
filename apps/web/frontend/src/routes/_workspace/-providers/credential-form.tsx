import type { RuntimeProviderSetup } from '@oomol-lab/open-connector';
import { Button } from '@repo/ui/button';
import { Input } from '@repo/ui/input';
import { Textarea } from '@repo/ui/textarea';
import { useForm } from '@tanstack/react-form';
import { type ChangeEvent, useId } from 'react';

type Auth = Extract<
  RuntimeProviderSetup['auth'][number],
  { type: 'api_key' | 'custom_credential' }
>;
type Field = Auth['fields'][number] & { defaultValue?: string };

export function CredentialForm(input: {
  fields: Field[];
  label: string;
  onSubmit(values: Record<string, string>): Promise<unknown>;
}) {
  const id = useId();
  const form = useForm({
    defaultValues: { values: input.fields.map((field) => field.defaultValue ?? '') },
    onSubmit: async ({ value, formApi }) => {
      await input.onSubmit(
        Object.fromEntries(
          [...input.fields.entries()].map(([index, field]) => [
            field.key,
            value.values[index] ?? '',
          ]),
        ),
      );
      formApi.reset();
    },
  });
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit().catch(() => undefined);
      }}
    >
      {[...input.fields.entries()].map(([index, definition]) => (
        <form.Field key={definition.key} name={`values[${index}]`}>
          {(field) => {
            const props = {
              id: `${id}-${index}`,
              value: field.state.value,
              onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                field.handleChange(event.target.value),
              onBlur: field.handleBlur,
              required: definition.required,
              placeholder: definition.placeholder,
              autoComplete: 'off',
              'aria-describedby': definition.description ? `${id}-${index}-help` : undefined,
            };
            return (
              <div className="space-y-2">
                <label htmlFor={props.id} className="font-medium text-sm">
                  {definition.label}
                  {!definition.required && (
                    <span className="ml-1 font-normal text-muted-foreground">(optional)</span>
                  )}
                </label>
                {definition.inputType === 'textarea' || definition.inputType === 'json' ? (
                  <Textarea {...props} spellCheck={false} />
                ) : (
                  <Input
                    {...props}
                    type={
                      definition.secret || definition.inputType === 'password' ? 'password' : 'text'
                    }
                  />
                )}
                {definition.description && (
                  <p id={`${id}-${index}-help`} className="text-muted-foreground text-sm">
                    {definition.description}
                  </p>
                )}
              </div>
            );
          }}
        </form.Field>
      ))}
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(pending) => (
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : input.label}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
