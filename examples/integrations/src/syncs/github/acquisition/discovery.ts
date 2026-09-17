// Adapted for Open Sync from massimoalbarello/open-connector.
import type { SyncContext } from '@open-sync/core/definition';
import { z } from 'zod';
import { object, request } from './response';
import type { Checkpoint } from './state';

const repositoryPage = z.object({
  edges: z
    .array(z.object({ cursor: z.string().min(1), node: z.object({ id: z.string().min(1) }) }))
    .max(1),
  pageInfo: z.object({ hasNextPage: z.boolean() }),
});
const pullPage = z.object({
  edges: z
    .array(
      z.object({
        cursor: z.string().min(1),
        node: z.object({ id: z.string().min(1), updatedAt: z.iso.datetime({ offset: true }) }),
      }),
    )
    .max(10),
  pageInfo: z.object({ hasNextPage: z.boolean() }),
});
export async function nextRepository(input: {
  context: SyncContext;
  checkpoint: Checkpoint;
  seen: Set<string>;
}) {
  const data = await request({
    context: input.context,
    query:
      'query SyncRepositories($after: String) { viewer { repositories(first: 1, after: $after, affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER], orderBy: {field: CREATED_AT, direction: ASC}) { edges { cursor node { id } } pageInfo { hasNextPage } } } }',
    variables: { after: input.checkpoint.repositoryCursor },
  });
  const page = repositoryPage.parse(object(data.viewer).repositories);
  const edge = page.edges[0];
  if (!edge) {
    if (page.pageInfo.hasNextPage) {
      throw new Error('Incomplete GitHub repository pagination.');
    }
    return null;
  }
  if (input.seen.has(edge.cursor)) {
    throw new Error('GitHub repeated a repository cursor.');
  }
  input.seen.add(edge.cursor);
  return { ...input.checkpoint, repositoryId: edge.node.id, repositoryCursor: edge.cursor };
}
export async function discoverPulls(input: {
  context: SyncContext;
  checkpoint: Checkpoint;
  seen: Set<string>;
}) {
  const { context, checkpoint } = input;
  const updates = checkpoint.phase === 'updates';
  const order = updates
    ? '{field: UPDATED_AT, direction: DESC}'
    : '{field: CREATED_AT, direction: ASC}';
  const collection = `pullRequests(first: 10, after: $after, orderBy: ${order}) { edges { cursor node { id updatedAt } } pageInfo { hasNextPage } }`;
  const accessible = context.config.scope === 'accessible';
  const data = await request({
    context,
    query: accessible
      ? `query SyncDiscover($after: String, $id: ID!) { node(id: $id) { ... on Repository { ${collection} } } }`
      : `query SyncDiscover($after: String) { viewer { ${collection} } }`,
    variables: accessible
      ? { after: checkpoint.cursor, id: checkpoint.repositoryId }
      : { after: checkpoint.cursor },
  });
  const page = pullPage.parse(object(accessible ? data.node : data.viewer).pullRequests);
  if (page.pageInfo.hasNextPage && !page.edges.length) {
    throw new Error('Incomplete GitHub discovery pagination.');
  }
  const overlapMs = 300_000;
  const cutoff = checkpoint.watermark ? Date.parse(checkpoint.watermark) - overlapMs : 0;
  const edges = [];
  for (const edge of page.edges) {
    if (updates && Date.parse(edge.node.updatedAt) < cutoff) {
      return { edges, more: false };
    }
    const key = `${checkpoint.repositoryId}:${edge.cursor}`;
    if (input.seen.has(key)) {
      throw new Error('GitHub repeated a pull request cursor.');
    }
    input.seen.add(key);
    edges.push(edge);
  }
  return { edges, more: page.pageInfo.hasNextPage };
}
