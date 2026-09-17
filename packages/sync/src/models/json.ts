import { createHash } from 'node:crypto';

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}
export interface CanonicalJson {
  value: JsonValue;
  json: string;
  sha256: string;
}
interface Visit {
  value: unknown;
  ancestors: Set<object>;
}

// Adapted from massimoalbarello/open-connector's src/sync/record-hash.ts.
export function canonicalJson(value: unknown): CanonicalJson {
  const normalized = normalize({ value, ancestors: new Set() });
  const json = JSON.stringify(normalized);
  return { value: normalized, json, sha256: createHash('sha256').update(json).digest('hex') };
}
function normalize(input: Visit): JsonValue {
  const { value, ancestors } = input;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object' || ancestors.has(value)) {
    throw new TypeError('Invalid JSON value');
  }
  ancestors.add(value);
  try {
    return Array.isArray(value)
      ? normalizeArray({ value, ancestors })
      : normalizeObject({ value, ancestors });
  } finally {
    ancestors.delete(value);
  }
}
function normalizeArray(input: { value: unknown[]; ancestors: Set<object> }): JsonValue[] {
  const descriptors = Object.getOwnPropertyDescriptors(input.value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== input.value.length + 1) {
    throw new TypeError('Invalid JSON array');
  }
  const result: JsonValue[] = [];
  for (let index = 0; index < input.value.length; index++) {
    const descriptor = descriptors[index];
    if (!descriptor || !('value' in descriptor)) {
      throw new TypeError('Sparse or accessor array');
    }
    result.push(normalize({ value: descriptor.value, ancestors: input.ancestors }));
  }
  return result;
}
function normalizeObject(input: { value: object; ancestors: Set<object> }): JsonObject {
  const prototype = Object.getPrototypeOf(input.value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Expected plain JSON');
  }
  if (Object.getOwnPropertySymbols(input.value).length) {
    throw new TypeError('Symbol JSON property');
  }
  const descriptors = Object.getOwnPropertyDescriptors(input.value);
  const result: JsonObject = {};
  for (const key of Object.keys(descriptors).sort()) {
    const descriptor = descriptors[key]!;
    if (!descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError('Expected data property');
    }
    Object.defineProperty(result, key, {
      value: normalize({ value: descriptor.value, ancestors: input.ancestors }),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return result;
}
