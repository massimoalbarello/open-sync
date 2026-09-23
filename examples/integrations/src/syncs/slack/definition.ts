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
      'Complete threads from joined channels within the selected history range, including all replies in chronological order. Rechecks for edits and new replies; excludes DMs and deletion detection.',
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
