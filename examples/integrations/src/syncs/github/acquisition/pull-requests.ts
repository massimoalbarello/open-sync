// Adapted from massimoalbarello/open-connector at 1d72cbfd7d7348eb64b9a2daaf6457de63f16f38.
import type { SyncContext, SyncStep } from '@context-use/open-sync/definition';
import type { SyncRecord } from '@context-use/open-sync/delivery';
import { historyStart } from '../../history';
import { discoverPulls } from './discovery';
import { ExpiredCursor } from './response';
import { beginCycle, checkpointSchema, finishCycle } from './state';

type Acquisition = {
  context: SyncContext;
  readRecord(input: { context: SyncContext; id: string }): Promise<SyncRecord>;
};

/** One hydrated record per step, retaining the rest of the discovery page across restarts. */
export async function acquire(input: Acquisition): Promise<SyncStep> {
  const { context } = input;
  let checkpoint = await beginCycle(context);
  try {
    if (checkpoint.pending === null) {
      const page = await discoverPulls({
        context,
        checkpoint,
        seen: new Set(checkpoint.cursor ? [checkpoint.cursor] : []),
      });
      checkpoint = { ...checkpoint, pending: page.edges, more: page.more };
    }
    const [edge, ...pending] = checkpoint.pending!;
    if (!edge) {
      return { deliverable: { records: [] }, checkpoint: finishCycle(checkpoint), complete: true };
    }
    const oldest = historyStart({
      config: context.config,
      now: new Date(checkpoint.cycleStartedAt!),
    });
    const records =
      !oldest || Date.parse(edge.node.updatedAt) >= oldest.getTime()
        ? [await input.readRecord({ context, id: edge.node.id })]
        : [];
    return {
      deliverable: { records },
      checkpoint: {
        ...checkpoint,
        cursor: edge.cursor,
        pending: pending.length || !checkpoint.more ? pending : null,
      },
      complete: false,
    };
  } catch (error) {
    if (!(error instanceof ExpiredCursor)) {
      throw error;
    }
    return {
      deliverable: { records: [] },
      complete: false,
      checkpoint: {
        ...checkpointSchema.parse(context.checkpoint),
        cursor: null,
        pending: null,
        more: true,
      },
    };
  }
}
