import type { SyncRegistration } from '@context-use/open-sync/definition';
import { z } from 'zod';
import { jsonSchema } from '../../schema';
import { checkpointSchema, initialCheckpoint, threadSchema } from './models';
import { run } from './threads';

export const slackThreads = {
  definition: {
    id: 'slack.threads',
    name: 'Slack threads',
    description:
      'Complete threads discovered in the last 30 days of joined-channel history, including all replies. Rechecks for edits; excludes DMs and deletion detection.',
    version: '1',
    artifactId: 'open-sync/slack-threads/1',
    provider: {
      service: 'slack',
      actions: [],
      proxyPaths: [
        '/auth.test',
        '/users.conversations',
        '/conversations.history',
        '/conversations.replies',
      ],
    },
    configSchema: jsonSchema(z.strictObject({})),
    checkpointSchema: jsonSchema(checkpointSchema),
    initialCheckpoint,
    kinds: { thread: jsonSchema(threadSchema) },
  },
  load: () => ({ run }),
} satisfies SyncRegistration;
