// Adapted for Open Sync from massimoalbarello/open-connector.
import type { SyncContext, SyncPage } from '@open-sync/core/definition';
import type { JsonObject, JsonValue } from '@open-sync/core/json';
import { githubPullRequests } from '@open-sync/examples/syncs/github-markdown';

const timestamp = '2026-09-01T00:00:00Z';
const actor = { id: 'U_1', login: 'octocat', url: 'https://github.com/octocat' };
const comment = (id: number) => ({
  id: `comment-${id}`,
  body: `Comment ${id}`,
  createdAt: timestamp,
  updatedAt: timestamp,
  url: `https://github.com/a/b/pull/1#comment-${id}`,
  author: actor,
});
export function collection(input: { nodes: JsonObject[]; offset?: number }) {
  const offset = input.offset ?? 0;
  const pageSize = 50;
  return {
    totalCount: input.nodes.length,
    nodes: input.nodes.slice(offset, offset + pageSize),
    pageInfo: {
      hasNextPage: offset + pageSize < input.nodes.length,
      endCursor: String(offset + pageSize),
    },
  };
}
export interface GraphQLRequest {
  query: string;
  variables: JsonObject;
}

/** The only simulated boundary is GitHub's GraphQL response. */
export function githubFixture() {
  const threePages = 101;
  const twoPages = 51;
  const comments = Array.from(Array(threePages).keys(), comment);
  const reviews = Array.from(Array(twoPages).keys(), (index) => ({
    id: `review-${index}`,
    body: `Review ${index}`,
    submittedAt: timestamp,
    state: 'APPROVED',
    url: `https://github.com/a/b/pull/1#review-${index}`,
    author: actor,
  }));
  const threadComments = Array.from(Array(twoPages).keys(), (index) => ({
    ...comment(index),
    body: `Thread ${index}`,
  }));
  const pull: JsonObject = {
    id: 'PR_native',
    number: 1,
    title: 'Complete PR',
    body: 'Author Markdown',
    url: 'https://github.com/a/b/pull/1',
    createdAt: timestamp,
    updatedAt: timestamp,
    state: 'MERGED',
    isDraft: false,
    mergedAt: timestamp,
    closedAt: timestamp,
    baseRefName: 'main',
    headRefName: 'feature',
    headRefOid: 'sha-300',
    repository: { id: 'R_native', nameWithOwner: 'a/b', url: 'https://github.com/a/b' },
    author: actor,
  };
  const thread = {
    id: 'thread-1',
    path: 'src/file.ts',
    line: 7,
    isResolved: true,
    isOutdated: false,
  };
  function read({ query, variables }: GraphQLRequest): JsonValue {
    switch (query.match(/query (\w+)/)?.[1]) {
      case 'SyncIdentity':
        return { viewer: { id: 'U_1' } };
      case 'SyncRepositories':
        return {
          viewer: {
            repositories: {
              edges: variables.after ? [] : [{ cursor: 'repo-cursor', node: { id: 'R_native' } }],
              pageInfo: { hasNextPage: false },
            },
          },
        };
      case 'SyncDiscover': {
        const pulls = {
          pullRequests: {
            edges: variables.after
              ? []
              : [{ cursor: 'record-cursor', node: { id: 'PR_native', updatedAt: timestamp } }],
            pageInfo: { hasNextPage: false },
          },
        };
        return variables.id ? { node: pulls } : { viewer: pulls };
      }
      case 'SyncPullRequest':
        return {
          node: {
            ...structuredClone(pull),
            comments: collection({ nodes: comments }),
            reviews: collection({ nodes: reviews }),
            reviewThreads: collection({
              nodes: [{ ...thread, comments: collection({ nodes: threadComments }) }],
            }),
          },
        };
      case 'SyncVerifyPull':
        return { node: { updatedAt: pull.updatedAt!, headRefOid: pull.headRefOid! } };
      default:
        return related({ query, variables });
    }
  }
  function related({ query, variables }: GraphQLRequest): JsonValue {
    const offset = Number(variables.after);
    if (variables.id === 'thread-1') {
      return { node: { comments: collection({ nodes: threadComments, offset }) } };
    }
    if (query.includes('comments(first:')) {
      return { node: { comments: collection({ nodes: comments, offset }) } };
    }
    if (query.includes('reviews(first:')) {
      return { node: { reviews: collection({ nodes: reviews, offset }) } };
    }
    throw new Error(`Unexpected GraphQL query: ${query}`);
  }
  const fixture = {
    pull,
    comments,
    reviews,
    threadComments,
    requests: [] as GraphQLRequest[],
    reply: (input: GraphQLRequest): JsonValue => ({ data: read(input) }),
  };
  const context: SyncContext = {
    config: { scope: 'authored' },
    checkpoint: structuredClone(githubPullRequests.definition.initialCheckpoint),
    sourceId: 'fixture-source',
    signal: new AbortController().signal,
    log() {},
    provider: {
      action: () => Promise.reject(new Error('Unexpected action')),
      get: () => Promise.reject(new Error('Unexpected GET')),
      post: (input) => {
        if (input.path !== '/graphql') {
          throw new Error('Unexpected proxy path');
        }
        const request = {
          query: String(input.body.query),
          variables: (input.body.variables ?? {}) as JsonObject,
        };
        fixture.requests.push(request);
        return Promise.resolve({ status: 200, headers: {}, body: fixture.reply(request) });
      },
    },
  };
  return { fixture, context };
}
export async function pages(context: SyncContext): Promise<SyncPage[]> {
  return await Array.fromAsync((await githubPullRequests.load()).run(context));
}
