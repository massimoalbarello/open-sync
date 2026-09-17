import type { SyncRegistration } from '@open-sync/core/definition';
import { checkpointSchema, initialCheckpoint, jsonSchema } from './acquisition/state';
import { run } from './pull-requests';

export const githubPullRequests = {
  definition: {
    name: 'GitHub pull requests',
    description:
      'Authored pull requests as structured JSON. Initial backfill, then incremental polls from the saved watermark with a five-minute overlap and daily reconciliation.',
    id: 'github.pull-requests',
    version: '1',
    artifactId: 'open-sync/github-pull-requests/1',
    provider: {
      service: 'github',
      actions: [],
      proxyPostPaths: ['/graphql'],
    },
    configSchema: { type: 'object', additionalProperties: false },
    checkpointSchema: jsonSchema(checkpointSchema),
    initialCheckpoint,
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
