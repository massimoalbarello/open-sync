import type { SyncRegistration } from '@open-sync/core/definition';
import { z } from 'zod';
import { markdownRecord } from '../../formats/markdown';
import { checkpointSchema, initialCheckpoint, jsonSchema } from '../github/acquisition/state';
import { run } from './pull-requests';

export const githubPullRequests = {
  definition: {
    name: 'GitHub pull requests (Markdown)',
    description:
      'Pull requests with discussions rendered as Markdown. Authored scope uses incremental polls and daily reconciliation; accessible scope reconciles all repositories.',
    id: 'example.github.pull-requests',
    version: '1',
    artifactId: 'open-sync/examples/github-complete/1',
    provider: { service: 'github', requiredScopes: [], actions: [], proxyPostPaths: ['/graphql'] },
    configSchema: jsonSchema(z.strictObject({ scope: z.enum(['authored', 'accessible']) })),
    checkpointSchema: jsonSchema(checkpointSchema),
    initialCheckpoint,
    kinds: { 'pull-request': jsonSchema(markdownRecord) },
  },
  load: () => ({ run }),
} satisfies SyncRegistration;
