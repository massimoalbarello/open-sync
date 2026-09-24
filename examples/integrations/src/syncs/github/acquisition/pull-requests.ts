// Adapted from massimoalbarello/open-connector at 1d72cbfd7d7348eb64b9a2daaf6457de63f16f38.
import type { SyncContext, SyncStep } from '@context-use/open-sync/definition';
import type { SyncRecord } from '@context-use/open-sync/record';
import { historyStart } from '../../history';
import { discoverPulls } from './discovery';
import { ExpiredCursor } from './response';
import { beginIteration, finishIteration } from './state';

type Acquisition = {
  context: SyncContext;
  readRecord(input: { context: SyncContext; id: string }): Promise<SyncRecord>;
};

/** Fetch every record in a discovery page before returning its cursor. */
export async function acquire(input: Acquisition): Promise<SyncStep> {
  const { context } = input;
  let checkpoint = await beginIteration(context);
  try {
    const page = await discoverPulls({
      context,
      checkpoint,
    });
    const oldest = historyStart({
      config: context.config,
      now: new Date(checkpoint.iterationStartedAt!),
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
      records,
      checkpoint: page.more ? checkpoint : finishIteration(checkpoint),
      complete: !page.more,
    };
  } catch (error) {
    if (!(error instanceof ExpiredCursor) || !checkpoint.cursor) {
      throw error;
    }
    return {
      records: [],
      complete: false,
      // Replay this iteration from its first page without changing its update window.
      checkpoint: { ...checkpoint, cursor: null },
    };
  }
}
