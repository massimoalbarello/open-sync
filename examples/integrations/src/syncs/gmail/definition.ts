import type { SyncRegistration } from '@context-use/open-sync/definition';
import { z } from 'zod';
import { jsonSchema } from '../../schema';
import { run } from './messages';
import { checkpointSchema, emailSchema, initialCheckpoint } from './models';

export const gmailEmails = {
  definition: {
    id: 'gmail.emails',
    name: 'Gmail emails',
    description:
      'Email subjects, bodies and participants from the last 30 days. Rechecks that window for changes; does not remove previously saved emails.',
    version: '1',
    artifactId: 'open-sync/gmail-emails/1',
    provider: { service: 'gmail', actions: ['gmail.get_profile', 'gmail.fetch_emails'] },
    configSchema: jsonSchema(z.strictObject({})),
    checkpointSchema: jsonSchema(checkpointSchema),
    initialCheckpoint,
    kinds: { email: jsonSchema(emailSchema) },
  },
  load: () => ({ run }),
} satisfies SyncRegistration;
