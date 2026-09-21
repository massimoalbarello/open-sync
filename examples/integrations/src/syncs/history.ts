import type { JsonObject } from '@context-use/open-sync/json';
import { z } from 'zod';

const months = { 'Last 3 months': 3, 'Last 1 year': 12, 'Last 3 years': 36 };
export const historyConfigSchema = z.strictObject({
  history: z
    .enum(['Last 3 months', 'Last 1 year', 'Last 3 years', 'All'])
    .optional()
    .meta({ title: 'Interval', default: 'All' }),
});

export function historyStart(input: { config: JsonObject; now: Date }): Date | null {
  const { history = 'All' } = historyConfigSchema.parse(input.config);
  if (history === 'All') {
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
