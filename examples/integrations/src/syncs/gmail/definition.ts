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
      'Complete email threads within the selected history range, including older conversation context. Backfills once, then follows Gmail history for replies and label changes; preserves unavailable threads.',
    provider: {
      service: 'gmail',
      actions: ['gmail.download_attachment'],
      proxyPaths: [
        '/users/me/profile',
        '/users/me/threads',
        '/users/me/threads/:id',
        '/users/me/history',
      ],
    },
    configSchema: jsonSchema(historyConfigSchema),
    checkpointSchema: jsonSchema(checkpointSchema),
    initialCheckpoint,
    kinds: { thread: jsonSchema(threadSchema) },
  },
  load: () => ({ step }),
} satisfies SyncRegistration;
