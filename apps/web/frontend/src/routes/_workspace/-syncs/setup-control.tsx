import { SetupInput } from './setup-input';
import { type SetupField, setupValue } from './setup-schema';

export function SetupControl(input: {
  definition: SetupField;
  id: string;
  value: string | undefined;
  onChange(value: string): void;
  onBlur(): void;
  errors: readonly unknown[];
}) {
  const { definition, id } = input;
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="font-medium text-sm">
        {String(definition.schema.title ?? definition.name)}
      </label>
      <SetupInput
        field={definition}
        id={id}
        value={setupValue({ field: definition, value: input.value })}
        onChange={input.onChange}
        onBlur={input.onBlur}
      />
      {definition.schema.description && (
        <p id={`${id}-help`} className="text-muted-foreground text-sm">
          {String(definition.schema.description)}
        </p>
      )}
      {input.errors.map((error) => (
        <p key={String(error)} role="alert" className="text-destructive text-sm">
          {String(error)}
        </p>
      ))}
    </div>
  );
}
