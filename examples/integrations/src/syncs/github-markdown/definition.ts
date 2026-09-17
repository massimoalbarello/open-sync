import type { SyncRegistration } from '@open-sync/core/definition';
import { z } from 'zod';
import { markdownRecord } from '../../formats/markdown';
import { run } from './pull-requests';
import { checkpointSchema, initialCheckpoint, jsonSchema } from './state';

export const githubPullRequests = {
  definition: {
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
