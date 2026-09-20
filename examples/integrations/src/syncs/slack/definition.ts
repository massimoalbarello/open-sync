import type { SyncRegistration } from '@context-use/open-sync/definition';
import { z } from 'zod';
import { jsonSchema } from '../../schema';
import { run } from './messages';
import { checkpointSchema, initialCheckpoint, messageSchema } from './models';

export const slackMessages = {
  definition: {
    id: 'slack.messages',
    name: 'Slack channel messages',
    description:
      'Top-level messages from your joined public and private channels over the last 30 days. Rechecks for edits; excludes thread replies, DMs and deletion detection.',
    version: '1',
    artifactId: 'open-sync/slack-messages/1',
    provider: {
      service: 'slack',
      actions: [],
      proxyPaths: ['/auth.test', '/users.conversations', '/conversations.history'],
    },
    configSchema: jsonSchema(z.strictObject({})),
    checkpointSchema: jsonSchema(checkpointSchema),
    initialCheckpoint,
    kinds: { message: jsonSchema(messageSchema) },
  },
  load: () => ({ run }),
} satisfies SyncRegistration;
