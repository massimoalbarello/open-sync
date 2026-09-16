import type { SyncRecord } from '@open-sync/core/delivery';
import type { JsonObject, JsonValue } from '@open-sync/core/json';

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
  if (typeof pull.isDraft !== 'boolean') {
    throw new Error('Incomplete GitHub pull request.');
  }
  return {
    operation: 'upsert',
    kind: 'pull-request',
    id: identity(pull.id),
    data: {
      ...data,
      repository: identity(repository.nameWithOwner),
      draft: pull.isDraft,
      author: pull.author === null ? null : identity(object(pull.author).login),
    },
  };
}

export const githubPageSize = 25;
export function readPage(value: JsonValue) {
  const response = object(value);
  const ok = 200;
  if (response.status !== ok) {
    throw new Error('GitHub request failed.');
  }
  const body = object(response.data);
  if (body.errors !== undefined) {
    throw new Error('GitHub returned an incomplete GraphQL result.');
  }
  const viewer = object(object(body.data).viewer);
  const accountId = identity(viewer.id);
  const pulls = object(viewer.pullRequests);
  const page = object(pulls.pageInfo);
  if (
    !Array.isArray(pulls.edges) ||
    pulls.edges.length > githubPageSize ||
    !Number.isSafeInteger(pulls.totalCount) ||
    Number(pulls.totalCount) < 0 ||
    typeof page.hasNextPage !== 'boolean'
  ) {
    throw new Error('Incomplete GitHub page.');
  }
  const cursor = page.hasNextPage ? identity(page.endCursor) : null;
  const edges = pulls.edges.map((value) => {
    const edge = object(value);
    return { cursor: identity(edge.cursor), record: record(edge.node!) };
  });
  if (
    new Set(edges.map((edge) => edge.cursor)).size !== edges.length ||
    new Set(edges.map((edge) => edge.record.id)).size !== edges.length ||
    (cursor && cursor !== edges.at(-1)?.cursor)
  ) {
    throw new Error('Invalid GitHub pagination.');
  }
  return { accountId, cursor, edges, total: Number(pulls.totalCount) };
}
