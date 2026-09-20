import { type Schema, Validator } from '@cfworker/json-schema';
import type { JsonObject, JsonValue } from '@context-use/open-sync/json';

export function setupFields(schema: Schema) {
  return Object.entries(schema.properties ?? {}).map(([name, property]) => ({
    name,
    schema: typeof property === 'boolean' ? {} : property,
    required: schema.required?.includes(name) ?? false,
  }));
}
export type SetupField = ReturnType<typeof setupFields>[number];

export function setupInput(input: { fields: SetupField[]; values: string[] }): JsonObject {
  return Object.fromEntries(
    [...input.fields.entries()].flatMap(([index, field]) => {
      const value = input.values[index] ?? '';
      if (!value && !field.required) {
        return [];
      }
      return [[field.name, parseValue({ schema: field.schema, value })]];
    }),
  );
}

function parseValue(input: { schema: Schema; value: string }): JsonValue {
  return input.schema.type === 'string' ? input.value : JSON.parse(input.value);
}

export function fieldError(input: { field: SetupField; value: string }) {
  if (!input.value && !input.field.required) {
    return undefined;
  }
  const label = String(input.field.schema.title ?? input.field.name);
  if (!input.value) {
    return `${label} is required.`;
  }
  try {
    const value = parseValue({ schema: input.field.schema, value: input.value });
    if (
      new Validator(structuredClone(input.field.schema), '2020-12', false).validate(value).valid
    ) {
      return undefined;
    }
  } catch {
    // Show field labels, never submitted secret values or validator diagnostics.
  }
  return `Enter a valid ${label.toLowerCase()}.`;
}

export function setupError(input: { schema: Schema; values: JsonObject }) {
  return new Validator(structuredClone(input.schema), '2020-12', false).validate(input.values).valid
    ? undefined
    : 'Check the destination settings.';
}
