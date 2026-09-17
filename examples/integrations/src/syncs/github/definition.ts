import type { SyncRegistration } from '@open-sync/core/definition';
import { run } from './pull-requests';

export const githubPullRequests = {
  definition: {
    id: 'github.pull-requests',
    version: '1',
    artifactId: 'open-sync/github-pull-requests/1',
    provider: {
      service: 'github',
      requiredScopes: ['read:user', 'repo'],
      actions: [],
      proxyPostPaths: ['/graphql'],
    },
    configSchema: { type: 'object', additionalProperties: false },
    checkpointSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cursor: { type: ['string', 'null'] },
        accountId: { type: ['string', 'null'] },
        scanned: { type: 'integer', minimum: 0 },
        total: { type: 'integer', minimum: 0 },
      },
      required: ['cursor', 'accountId', 'scanned', 'total'],
    },
    initialCheckpoint: { cursor: null, accountId: null, scanned: 0, total: 0 },
    kinds: {
      'pull-request': {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          body: { type: 'string' },
          url: { type: 'string' },
          number: { type: 'integer', minimum: 1 },
          repository: { type: 'string' },
          author: { type: ['string', 'null'] },
          state: { enum: ['OPEN', 'CLOSED', 'MERGED'] },
          draft: { type: 'boolean' },
          createdAt: { type: 'string' },
          updatedAt: { type: 'string' },
          mergedAt: { type: ['string', 'null'] },
          closedAt: { type: ['string', 'null'] },
        },
        required: [
          'title',
          'body',
          'url',
          'number',
          'repository',
          'author',
          'state',
          'draft',
          'createdAt',
          'updatedAt',
          'mergedAt',
          'closedAt',
        ],
      },
    },
  },
  load: () => ({ run }),
} satisfies SyncRegistration;
