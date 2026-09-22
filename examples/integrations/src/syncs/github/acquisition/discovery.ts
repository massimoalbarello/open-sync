// Adapted for Open Sync from massimoalbarello/open-connector.
import type { SyncContext } from '@context-use/open-sync/definition';
import { z } from 'zod';
import { object, request } from './response';
import type { Checkpoint } from './state';

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
  const data = await request({
    context,
    query: `query SyncDiscover($after: String) { viewer { ${collection} } }`,
    variables: { after: checkpoint.cursor },
  });
  const page = pullPage.parse(object(data.viewer).pullRequests);
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
    const key = edge.cursor;
    if (input.seen.has(key)) {
      throw new Error('GitHub repeated a pull request cursor.');
    }
    input.seen.add(key);
    edges.push(edge);
  }
  return { edges, more: page.pageInfo.hasNextPage };
}
