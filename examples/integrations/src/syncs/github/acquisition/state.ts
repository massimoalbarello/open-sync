// Adapted for Open Sync from massimoalbarello/open-connector.
import type { SyncContext } from '@context-use/open-sync/definition';
import { z } from 'zod';
import { object, request } from './response';

// A GitHub cursor resumes pages within one polling iteration; it is not a change token.
// Keep the previous watermark while paging. Only a completed iteration advances it to
// iterationStartedAt: advancing to the finish time could skip edits made to PRs already read.
// For example, a 10:00–10:20 scan must revisit a PR edited at 10:05 on its next iteration.
export const checkpointSchema = z.strictObject({
  // Reject continuation under a different connected account.
  accountId: z.string().nullable(),
  // Native page position; reset after completion or cursor expiry.
  cursor: z.string().nullable(),
  // Frozen before the first request; retained across pages, retries, and restarts.
  iterationStartedAt: z.iso.datetime({ offset: true }).nullable(),
  // Start of the last completed iteration; null until the initial backfill finishes.
  watermark: z.iso.datetime({ offset: true }).nullable(),
});
export type Checkpoint = z.infer<typeof checkpointSchema>;
export const initialCheckpoint: Checkpoint = {
  accountId: null,
  cursor: null,
  iterationStartedAt: null,
  watermark: null,
};
export async function beginIteration(context: SyncContext): Promise<Checkpoint> {
  const checkpoint = checkpointSchema.parse(context.checkpoint);
  const iterationStartedAt = checkpoint.iterationStartedAt ?? new Date().toISOString();
  const viewer = object(
    (await request({ context, query: 'query SyncIdentity { viewer { id } }' })).viewer,
  );
  const accountId = z.string().min(1).parse(viewer.id);
  if (checkpoint.accountId !== null && checkpoint.accountId !== accountId) {
    throw new Error('GitHub account changed. Create a new sync.');
  }
  return {
    ...checkpoint,
    accountId,
    iterationStartedAt,
  };
}
export function finishIteration(checkpoint: Checkpoint): Checkpoint {
  return {
    ...initialCheckpoint,
    accountId: checkpoint.accountId,
    watermark: checkpoint.iterationStartedAt,
  };
}
