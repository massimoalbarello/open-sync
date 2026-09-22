import type { SyncRegistration } from '@context-use/open-sync/definition';
import { jsonSchema } from '../../schema';
import { historyConfigSchema } from '../history';
import { checkpointSchema, initialCheckpoint, threadSchema } from './models';
import { step } from './threads';

export const gmailThreads = {
  definition: {
    id: 'gmail.threads',
    name: 'Gmail threads',
    description:
      'Complete email threads with activity within the selected history range, including older messages in each conversation. Rechecks for changes; does not infer deleted threads.',
    version: '2',
    artifactId: 'open-sync/gmail-threads/2',
    provider: {
      service: 'gmail',
      actions: ['gmail.get_profile', 'gmail.list_threads'],
      proxyPaths: ['/users/me/messages/:messageId/attachments/:attachmentId'],
    },
    configSchema: jsonSchema(historyConfigSchema),
    checkpointSchema: jsonSchema(checkpointSchema),
    initialCheckpoint,
    kinds: { thread: jsonSchema(threadSchema) },
  },
  load: () => ({ step }),
} satisfies SyncRegistration;
