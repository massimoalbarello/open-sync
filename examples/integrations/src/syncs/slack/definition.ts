import type { SyncRegistration } from '@context-use/open-sync/definition';
import { jsonSchema } from '../../schema';
import { historyConfigSchema } from '../history';
import { checkpointSchema, initialCheckpoint, threadSchema } from './models';
import { step } from './threads';

export const slackThreads = {
  definition: {
    id: 'slack.threads',
    name: 'Slack threads',
    description:
      'Complete threads whose roots appear in joined-channel history within the selected range, including all replies. Rescans that range for edits and replies; excludes DMs and deletion detection.',
    provider: {
      service: 'slack',
      actions: ['slack.download_file'],
      proxyPaths: [
        '/auth.test',
        '/users.conversations',
        '/conversations.info',
        '/conversations.history',
        '/conversations.replies',
      ],
    },
    configSchema: jsonSchema(historyConfigSchema),
    checkpointSchema: jsonSchema(checkpointSchema),
    initialCheckpoint,
    kinds: { thread: jsonSchema(threadSchema) },
  },
  load: () => ({ step }),
} satisfies SyncRegistration;
