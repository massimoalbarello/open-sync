// Adapted from massimoalbarello/open-connector at 1d72cbfd7d7348eb64b9a2daaf6457de63f16f38.
import type { SyncContext, SyncStep } from '@context-use/open-sync/definition';
import type { SyncRecord } from '@context-use/open-sync/record';
import { historyStart } from '../../history';
import { discoverPulls } from './discovery';
import { ExpiredCursor } from './response';
import { beginCycle, checkpointSchema, finishCycle } from './state';

type Acquisition = {
  context: SyncContext;
  readRecord(input: { context: SyncContext; id: string }): Promise<SyncRecord>;
};

/** Fetch every record in a discovery page before returning its cursor. */
export async function acquire(input: Acquisition): Promise<SyncStep> {
  const { context } = input;
  let checkpoint = await beginCycle(context);
  try {
    const page = await discoverPulls({
      context,
      checkpoint,
      seen: new Set(checkpoint.cursor ? [checkpoint.cursor] : []),
    });
    const oldest = historyStart({
      config: context.config,
      now: new Date(checkpoint.cycleStartedAt!),
    });
    const records: SyncRecord[] = [];
    for (const edge of page.edges) {
      context.signal.throwIfAborted();
      if (!oldest || Date.parse(edge.node.updatedAt) >= oldest.getTime()) {
        records.push(await input.readRecord({ context, id: edge.node.id }));
      }
      checkpoint = { ...checkpoint, cursor: edge.cursor };
    }
    return {
      deliverable: { records },
      checkpoint: page.more ? checkpoint : finishCycle(checkpoint),
      complete: !page.more,
    };
  } catch (error) {
    if (!(error instanceof ExpiredCursor)) {
      throw error;
    }
    return {
      deliverable: { records: [] },
      complete: false,
      checkpoint: { ...checkpointSchema.parse(context.checkpoint), cursor: null },
    };
  }
}
