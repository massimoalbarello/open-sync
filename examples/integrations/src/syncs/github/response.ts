import type { ProviderResponse } from '@context-use/open-sync/definition';
import type { SyncRecord } from '@context-use/open-sync/delivery';
import type { JsonObject, JsonValue } from '@context-use/open-sync/json';
import { checkResponse } from './http';

export function object(value: JsonValue | undefined): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Incomplete GitHub response.');
  }
  return value;
}
export function identity(value: JsonValue | undefined): string {
  if (typeof value !== 'string' || !value) {
    throw new Error('Missing GitHub identity or cursor.');
  }
  return value;
}
export function record(value: JsonValue): SyncRecord {
  const pull = object(value);
  const repository = object(pull.repository);
  const fields = [
    'title',
    'body',
    'url',
    'number',
    'state',
    'createdAt',
    'updatedAt',
    'mergedAt',
    'closedAt',
  ] as const;
  const data: JsonObject = {};
  for (const field of fields) {
    if (pull[field] === undefined) {
      throw new Error('Incomplete GitHub pull request.');
    }
    data[field] = pull[field];
  }
  const { title, createdAt, updatedAt } = pull;
  if (
    typeof pull.isDraft !== 'boolean' ||
    typeof title !== 'string' ||
    typeof createdAt !== 'string' ||
    typeof updatedAt !== 'string'
  ) {
    throw new Error('Incomplete GitHub pull request.');
  }
  return {
    operation: 'upsert',
    kind: 'pull-request',
    id: identity(pull.id),
    content: { format: 'markdown', body: String(data.body ?? '') },
    preview: title,
    createdAt,
    updatedAt,
    data: {
      ...data,
      repository: identity(repository.nameWithOwner),
      draft: pull.isDraft,
      author: pull.author === null ? null : identity(object(pull.author).login),
    },
  };
}

export function readPull(response: ProviderResponse) {
  checkResponse(response);
  const body = object(response.body);
  if (body.errors !== undefined) {
    throw new Error('GitHub returned an incomplete GraphQL result.');
  }
  return record(object(body.data).node!);
}
