import type { SyncRegistration } from '@context-use/open-sync/definition';
import { jsonSchema } from '../../schema';
import { historyConfigSchema } from '../history';
import { checkpointSchema, initialCheckpoint } from './acquisition/state';
import { step } from './pull-requests';

export const githubPullRequests = {
  definition: {
    name: 'GitHub pull requests',
    description:
      'Authored pull requests as structured JSON. Initial backfill, then incremental polls from the saved watermark with a five-minute overlap.',
    id: 'github.pull-requests',
    provider: {
      service: 'github',
      actions: [],
      proxyPostPaths: ['/graphql'],
    },
    configSchema: jsonSchema(historyConfigSchema),
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
  load: () => ({ step }),
} satisfies SyncRegistration;
