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
export async function discoverPulls(input: { context: SyncContext; checkpoint: Checkpoint }) {
  const { context, checkpoint } = input;
  const updates = checkpoint.watermark !== null;
  // Creation order keeps backfill stable under edits. Later iterations start at the
  // newest update and stop at the watermark; reusing a completed cursor would miss edits.
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
  const seen = new Set(checkpoint.cursor ? [checkpoint.cursor] : []);
  let previousUpdatedAt = Infinity;
  for (const edge of page.edges) {
    const key = edge.cursor;
    if (seen.has(key)) {
      throw new Error('GitHub repeated a pull request cursor.');
    }
    seen.add(key);
    const updatedAt = Date.parse(edge.node.updatedAt);
    if (updates && updatedAt > previousUpdatedAt) {
      throw new Error('GitHub returned pull requests out of update order.');
    }
    previousUpdatedAt = updatedAt;
  }
  // Include cutoff ties and overlap timestamp precision/brief visibility delays.
  // Unchanged records in this window are suppressed by the engine's change detection.
  // Old PRs newly made visible, or changes without updatedAt, require an explicit resync.
  const overlapMs = 300_000;
  const cutoff = checkpoint.watermark ? Date.parse(checkpoint.watermark) - overlapMs : null;
  const edges =
    cutoff === null
      ? page.edges
      : page.edges.filter(({ node }) => Date.parse(node.updatedAt) >= cutoff);
  return { edges, more: page.pageInfo.hasNextPage && edges.length === page.edges.length };
}
