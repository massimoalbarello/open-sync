import type { JsonObject } from '@context-use/open-sync/json';
import { z } from 'zod';

const months = { '3 months': 3, '1 year': 12, '3 years': 36 };
export const historyConfigSchema = z.strictObject({
  history: z
    .enum(['3 months', '1 year', '3 years', 'Unlimited'])
    .optional()
    .meta({ title: 'History', default: 'Unlimited' }),
});

export function historyStart(input: { config: JsonObject; now: Date }): Date | null {
  const { history = 'Unlimited' } = historyConfigSchema.parse(input.config);
  if (history === 'Unlimited') {
    return null;
  }
  const start = new Date(input.now);
  const day = start.getUTCDate();
  start.setUTCDate(1);
  start.setUTCMonth(start.getUTCMonth() - months[history]);
  const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  start.setUTCDate(Math.min(day, lastDay.getUTCDate()));
  return start;
}
