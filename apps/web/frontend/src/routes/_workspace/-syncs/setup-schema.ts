import { dereference, type Schema, Validator, validate } from '@cfworker/json-schema';
import type { JsonObject, JsonValue } from '@context-use/open-sync/json';

export function setupFields(schema: Schema) {
  const root = structuredClone(schema);
  const lookup = dereference(root);
  return Object.entries(root.properties ?? {}).map(([name, property]) => ({
    name,
    schema: fieldPresentation({ schema: property, lookup }),
    required: root.required?.includes(name) ?? false,
    validate: (value: JsonValue) => validate(value, property, '2020-12', lookup, false).valid,
  }));
}

function fieldPresentation(input: {
  schema: Schema | boolean;
  lookup: ReturnType<typeof dereference>;
}): Schema {
  let current = input.schema;
  const visited = new Set<Schema>();
  let result: Schema = {};
  while (typeof current !== 'boolean' && !visited.has(current)) {
    visited.add(current);
    result = { ...current, ...result };
    const reference = current.__absolute_ref__;
    if (!reference || input.lookup[reference] === undefined) {
      break;
    }
    current = input.lookup[reference]!;
  }
  return result;
}
export type SetupField = ReturnType<typeof setupFields>[number];

export function setupValue(input: { field: SetupField; value?: string }): string {
  const fallback = input.field.schema.default;
  return (
    input.value ??
    (fallback === undefined
      ? ''
      : input.field.schema.type === 'string'
        ? String(fallback)
        : JSON.stringify(fallback))
  );
}

export function setupInput(input: { fields: SetupField[]; values: string[] }): JsonObject {
  return Object.fromEntries(
    [...input.fields.entries()].flatMap(([index, field]) => {
      const value = setupValue({ field, value: input.values[index] });
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
    if (input.field.validate(value)) {
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
    : 'Check the settings.';
}
