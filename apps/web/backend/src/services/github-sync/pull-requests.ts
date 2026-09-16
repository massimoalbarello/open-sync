import type { SyncContext, SyncPage } from '@open-sync/core/definition';
import { githubPageSize, object, readPage } from './response';

const query = `query OpenSyncAuthoredPullRequests($after: String, $first: Int!) {
  viewer {
    id
    pullRequests(first: $first, after: $after, orderBy: {field: CREATED_AT, direction: ASC}) {
      totalCount
      edges {
        cursor
        node {
          id number title body url state isDraft createdAt updatedAt mergedAt closedAt
          repository { nameWithOwner }
          author { login }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

/**
 * All accessible authored PRs, including closed/merged, in creation order; no Search result cap.
 * Each cycle is a full scan so edits to old PR descriptions are discovered. Cursors resume only
 * committed pages. Reprocess explicitly restarts an expired cursor without resetting record IDs.
 * This first definition omits comments/reviews/attachments and never infers deletes from absence.
 */
export async function* run(context: SyncContext): AsyncGenerator<SyncPage> {
  let checkpoint = object(context.checkpoint);
  let scanned = checkpoint.cursor === null ? 0 : Number(checkpoint.scanned);
  const cursors = new Set<string | null>([checkpoint.cursor as string | null]);
  while (true) {
    context.signal.throwIfAborted();
    const page = readPage(
      await context.provider.post({
        path: '/graphql',
        body: {
          query,
          variables: { after: checkpoint.cursor!, first: githubPageSize },
        },
      }),
    );
    const { accountId, cursor, edges, total } = page;
    if (checkpoint.accountId !== null && checkpoint.accountId !== accountId) {
      throw new Error('GitHub account changed. Create a new sync.');
    }
    if (cursor && (!edges.length || cursors.has(cursor))) {
      throw new Error('GitHub repeated a page cursor.');
    }
    cursors.add(cursor);
    for (const edge of edges) {
      // Commit one PR per engine page, so a group of long descriptions cannot exceed the page limit.
      checkpoint = {
        cursor: edge.cursor,
        accountId,
        total,
        scanned: ++scanned,
      };
      yield { deliverable: { records: [edge.record] }, checkpoint, complete: false };
    }
    if (cursor === null) {
      yield {
        deliverable: { records: [] },
        checkpoint: {
          cursor: null,
          accountId,
          total,
          scanned,
        },
        complete: true,
      };
      return;
    }
  }
}
