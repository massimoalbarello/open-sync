import type { SyncRegistration } from '@context-use/open-sync/definition';
import { z } from 'zod';
import { jsonSchema } from '../../schema';
import { step } from './meetings';
import { checkpointSchema, meetingSchema } from './models';

export const granolaMeetings = {
  definition: {
    id: 'granola.meetings',
    name: 'Granola meetings',
    description:
      'Meeting notes and summaries from the last 30 days through Granola MCP and OAuth. Rechecks accessible meetings; unavailable notes are not treated as deletions.',
    version: '2',
    artifactId: 'open-sync/granola-meetings/2',
    provider: {
      service: 'granola',
      actions: ['granola.list_meetings', 'granola.get_meetings'],
    },
    configSchema: jsonSchema(z.strictObject({})),
    checkpointSchema: jsonSchema(checkpointSchema),
    initialCheckpoint: { afterId: null },
    kinds: { meeting: jsonSchema(meetingSchema) },
  },
  load: () => ({ step }),
} satisfies SyncRegistration;
