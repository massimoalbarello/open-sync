import type { SyncContext } from '@context-use/open-sync/definition';
import { acquire } from './acquisition/pull-requests';
import { readPull } from './response';

const query = `query SyncPullSummary($id: ID!) {
  node(id: $id) { ... on PullRequest {
    id number title body url state isDraft createdAt updatedAt mergedAt closedAt
    repository { nameWithOwner }
    author { login }
  } }
}`;

export function run(context: SyncContext) {
  return acquire({
    context,
    async readRecord({ context, id }) {
      const record = readPull(
        await context.provider.post({ path: '/graphql', body: { query, variables: { id } } }),
      );
      if (record.id !== id) {
        throw new Error('GitHub returned a different pull request identity.');
      }
      return record;
    },
  });
}
