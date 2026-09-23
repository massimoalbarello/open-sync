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
      'Meeting notes and summaries returned by the Granola MCP last-30-days listing through OAuth. Rechecks accessible meetings; unavailable notes are not treated as deletions.',
    provider: {
      service: 'granola',
      actions: ['granola.list_meetings', 'granola.get_meetings'],
    },
    configSchema: jsonSchema(z.strictObject({})),
    checkpointSchema: jsonSchema(checkpointSchema),
    initialCheckpoint: {},
    kinds: { meeting: jsonSchema(meetingSchema) },
  },
  load: () => ({ step }),
} satisfies SyncRegistration;
