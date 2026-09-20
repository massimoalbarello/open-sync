import type { SyncRegistration } from '@context-use/open-sync/definition';
import { z } from 'zod';
import { jsonSchema } from '../../schema';
import { checkpointSchema, initialCheckpoint, threadSchema } from './models';
import { run } from './threads';

export const gmailThreads = {
  definition: {
    id: 'gmail.threads',
    name: 'Gmail threads',
    description:
      'Complete email threads with activity in the last 30 days, including older messages in each conversation. Rechecks for changes; does not infer deleted threads.',
    version: '1',
    artifactId: 'open-sync/gmail-threads/1',
    provider: { service: 'gmail', actions: ['gmail.get_profile', 'gmail.list_threads'] },
    configSchema: jsonSchema(z.strictObject({})),
    checkpointSchema: jsonSchema(checkpointSchema),
    initialCheckpoint,
    kinds: { thread: jsonSchema(threadSchema) },
  },
  load: () => ({ run }),
} satisfies SyncRegistration;
