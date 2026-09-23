import { type Schema, Validator } from '@cfworker/json-schema';
import { fail } from './error';
import { canonicalJson, type JsonValue } from './json';

const maxIdentifierLength = 1024;
export function identifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxIdentifierLength) {
    fail('invalid_identifier');
  }
}
export function validate(input: { value: unknown; schema: Schema }): JsonValue {
  try {
    const json = canonicalJson(input.value);
    // The validator mutates schemas while compiling; host-provided schemas remain unchanged.
    if (
      !new Validator(structuredClone(input.schema), '2020-12', false).validate(json.value).valid
    ) {
      fail('invalid_input');
    }
    return json.value;
  } catch {
    return fail('invalid_input');
  }
}
