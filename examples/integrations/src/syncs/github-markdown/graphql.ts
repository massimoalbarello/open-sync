// Adapted for Open Sync from massimoalbarello/open-connector.
import type { SyncContext } from '@open-sync/core/definition';
import { z } from 'zod';
import { object, request } from '../github/acquisition/response';

export const actorSelection =
  'login url ... on User { id } ... on Bot { id } ... on Organization { id }';
export const pageSelection = 'pageInfo { hasNextPage endCursor } totalCount';
const node = z.looseObject({ id: z.string().min(1) });
const connection = z.object({
  nodes: z.array(node),
  totalCount: z.number().int().nonnegative(),
  pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
});
function readConnection(value: unknown) {
  const page = connection.parse(value);
  if (page.pageInfo.hasNextPage && (!page.pageInfo.endCursor || !page.nodes.length)) {
    throw new Error('GitHub collection pagination is incomplete.');
  }
  return {
    nodes: page.nodes,
    cursor: page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null,
    total: page.totalCount,
  };
}

/** Every child must be present before its parent record is emitted. */
export async function collectNodes(input: {
  context: SyncContext;
  id: string;
  type: string;
  field: string;
  selection: string;
  first: unknown;
}): Promise<Record<string, unknown>[]> {
  let page = readConnection(input.first);
  const expected = page.total;
  const maxItems = 5000;
  if (expected > maxItems) {
    throw new Error('GitHub discussion exceeds the example hydration limit.');
  }
  const nodes: Record<string, unknown>[] = [];
  const ids = new Set<string>();
  const cursors = new Set<string>();
  while (true) {
    for (const item of page.nodes) {
      if (ids.has(item.id)) {
        throw new Error('GitHub collection repeated an item.');
      }
      ids.add(item.id);
      nodes.push(item);
    }
    if (page.total !== expected || nodes.length > expected) {
      throw new Error('GitHub collection changed during hydration.');
    }
    if (page.cursor === null) {
      break;
    }
    if (cursors.has(page.cursor)) {
      throw new Error('GitHub pagination repeated a cursor.');
    }
    cursors.add(page.cursor);
    const data = await request({
      context: input.context,
      query: `query SyncRelated($id: ID!, $after: String) { node(id: $id) { ... on ${input.type} { ${input.field}(first: 50, after: $after) { nodes { ${input.selection} } ${pageSelection} } } } }`,
      variables: { id: input.id, after: page.cursor },
    });
    page = readConnection(object(data.node)[input.field]);
  }
  if (nodes.length !== expected) {
    throw new Error('GitHub collection was truncated.');
  }
  return nodes;
}
