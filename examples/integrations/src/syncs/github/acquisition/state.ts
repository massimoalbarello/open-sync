// Adapted for Open Sync from massimoalbarello/open-connector.
import type { SyncContext } from '@context-use/open-sync/definition';
import { z } from 'zod';
import { object, request } from './response';

export const checkpointSchema = z.strictObject({
  accountId: z.string().nullable(),
  phase: z.enum(['backfill', 'updates', 'reconcile']),
  cursor: z.string().nullable(),
  cycleStartedAt: z.iso.datetime({ offset: true }).nullable(),
  watermark: z.iso.datetime({ offset: true }).nullable(),
  reconciledAt: z.iso.datetime({ offset: true }).nullable(),
});
export type Checkpoint = z.infer<typeof checkpointSchema>;
export const initialCheckpoint: Checkpoint = {
  accountId: null,
  phase: 'backfill',
  cursor: null,
  cycleStartedAt: null,
  watermark: null,
  reconciledAt: null,
};
export async function beginCycle(context: SyncContext): Promise<Checkpoint> {
  const checkpoint = checkpointSchema.parse(context.checkpoint);
  const viewer = object(
    (await request({ context, query: 'query SyncIdentity { viewer { id } }' })).viewer,
  );
  const accountId = z.string().min(1).parse(viewer.id);
  if (checkpoint.accountId !== null && checkpoint.accountId !== accountId) {
    throw new Error('GitHub account changed. Create a new sync.');
  }
  const startedAt = new Date().toISOString();
  const dayMs = 86_400_000;
  const due =
    !checkpoint.reconciledAt ||
    Date.parse(startedAt) - Date.parse(checkpoint.reconciledAt) >= dayMs;
  return {
    ...checkpoint,
    accountId,
    phase: checkpoint.cycleStartedAt === null && due ? 'reconcile' : checkpoint.phase,
    cycleStartedAt: checkpoint.cycleStartedAt ?? startedAt,
  };
}
export function finishCycle(checkpoint: Checkpoint): Checkpoint {
  return {
    ...initialCheckpoint,
    accountId: checkpoint.accountId,
    phase: 'updates',
    watermark: checkpoint.cycleStartedAt,
    reconciledAt:
      checkpoint.phase === 'updates' ? checkpoint.reconciledAt : checkpoint.cycleStartedAt,
  };
}
