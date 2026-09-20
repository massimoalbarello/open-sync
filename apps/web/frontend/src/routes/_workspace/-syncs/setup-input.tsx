import { Input } from '@repo/ui/input';
import { Select } from '@repo/ui/select';
import { Textarea } from '@repo/ui/textarea';
import type { SetupField } from './setup-schema';

export function SetupInput(input: {
  field: SetupField;
  id: string;
  value: string;
  onChange(value: string): void;
  onBlur(): void;
}) {
  const schema = input.field.schema;
  const props = {
    id: input.id,
    value: input.value,
    onBlur: input.onBlur,
    'aria-describedby': schema.description ? `${input.id}-help` : undefined,
    autoComplete: 'off',
  };
  if (!schema.writeOnly && (schema.enum || schema.type === 'boolean')) {
    const options: unknown[] = schema.enum ?? [true, false];
    return (
      <Select
        {...props}
        onValueChange={input.onChange}
        options={options.map((value) => ({
          label: String(value),
          value: schema.type === 'string' ? String(value) : JSON.stringify(value),
        }))}
      />
    );
  }
  if (!schema.writeOnly && !['string', 'number', 'integer'].includes(String(schema.type))) {
    return (
      <Textarea
        {...props}
        spellCheck={false}
        onChange={(event) => input.onChange(event.target.value)}
      />
    );
  }
  return (
    <Input
      {...props}
      type={schema.writeOnly ? 'password' : schema.format === 'uri' ? 'url' : 'text'}
      placeholder={typeof schema.examples?.[0] === 'string' ? schema.examples[0] : undefined}
      onChange={(event) => input.onChange(event.target.value)}
    />
  );
}
