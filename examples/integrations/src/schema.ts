import type { SyncDefinition } from '@context-use/open-sync/definition';
import { z } from 'zod';

// Runtime definition metadata must be plain JSON, without Zod's runtime helpers.
export function jsonSchema(schema: z.ZodType): SyncDefinition['configSchema'] {
  return JSON.parse(JSON.stringify(z.toJSONSchema(schema))) as SyncDefinition['configSchema'];
}
