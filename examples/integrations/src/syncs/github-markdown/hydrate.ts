// Adapted for Open Sync from massimoalbarello/open-connector.
import type { SyncContext } from '@open-sync/core/definition';
import { actorSelection, collectNodes, pageSelection } from './graphql';
import { renderPullRequest } from './render';
import { object, request } from './response';

const commentsSelection = `id body url createdAt updatedAt author { ${actorSelection} }`;
const reviewsSelection = `id body url submittedAt state author { ${actorSelection} }`;
const threadSelection = `id path line isResolved isOutdated comments(first: 50) { nodes { ${commentsSelection} } ${pageSelection} }`;
const coreSelection = `id number title body url createdAt updatedAt state isDraft mergedAt closedAt baseRefName headRefName headRefOid repository { id nameWithOwner url } author { ${actorSelection} }`;
const hydrateQuery = `query SyncPullRequest($id: ID!) { node(id: $id) { ... on PullRequest { ${coreSelection}
  comments(first: 50) { nodes { ${commentsSelection} } ${pageSelection} }
  reviews(first: 50) { nodes { ${reviewsSelection} } ${pageSelection} }
  reviewThreads(first: 50) { nodes { ${threadSelection} } ${pageSelection} }
} } }`;

export async function hydrate(input: { context: SyncContext; id: string }) {
  const { context, id } = input;
  const pull = object((await request({ context, query: hydrateQuery, variables: { id } })).node);
  if (pull.id !== id) {
    throw new Error('GitHub returned a different pull request identity.');
  }
  const parent = { context, id, type: 'PullRequest' };
  const comments = await collectNodes({
    ...parent,
    field: 'comments',
    selection: commentsSelection,
    first: pull.comments,
  });
  const reviews = await collectNodes({
    ...parent,
    field: 'reviews',
    selection: reviewsSelection,
    first: pull.reviews,
  });
  const threads = await collectNodes({
    ...parent,
    field: 'reviewThreads',
    selection: threadSelection,
    first: pull.reviewThreads,
  });
  for (const thread of threads) {
    thread.comments = await collectNodes({
      context,
      id: String(thread.id),
      type: 'PullRequestReviewThread',
      field: 'comments',
      selection: commentsSelection,
      first: thread.comments,
    });
  }
  const latest = object(
    (
      await request({
        context,
        query:
          'query SyncVerifyPull($id: ID!) { node(id: $id) { ... on PullRequest { updatedAt headRefOid } } }',
        variables: { id },
      })
    ).node,
  );
  if (latest.updatedAt !== pull.updatedAt || latest.headRefOid !== pull.headRefOid) {
    throw new Error('Pull request changed during hydration; retry the record.');
  }
  return renderPullRequest({ pull, comments, reviews, threads });
}
