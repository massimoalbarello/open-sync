// Adapted from massimoalbarello/open-connector at 1d72cbfd7d7348eb64b9a2daaf6457de63f16f38.
import type { SyncContext, SyncPage } from '@context-use/open-sync/definition';
import type { SyncRecord } from '@context-use/open-sync/delivery';
import { historyStart } from '../../history';
import { discoverPulls } from './discovery';
import { ExpiredCursor } from './response';
import { beginCycle, checkpointSchema, finishCycle } from './state';

type Acquisition = {
  context: SyncContext;
  readRecord(input: { context: SyncContext; id: string }): Promise<SyncRecord>;
};

/** Creation-order backfill, overlapping update scans and daily full reconciliation. */
async function* discover(input: Acquisition): AsyncGenerator<SyncPage> {
  const { context } = input;
  let checkpoint = await beginCycle(context);
  const oldest = historyStart({
    config: context.config,
    now: new Date(checkpoint.cycleStartedAt!),
  });
  const seen = new Set<string>(checkpoint.cursor ? [checkpoint.cursor] : []);
  while (true) {
    context.signal.throwIfAborted();
    const page = await discoverPulls({ context, checkpoint, seen });
    for (const edge of page.edges) {
      const records =
        !oldest || Date.parse(edge.node.updatedAt) >= oldest.getTime()
          ? [await input.readRecord({ context, id: edge.node.id })]
          : [];
      checkpoint = { ...checkpoint, cursor: edge.cursor };
      yield { deliverable: { records }, checkpoint, complete: false };
    }
    if (!page.more) {
      break;
    }
  }
  yield { deliverable: { records: [] }, checkpoint: finishCycle(checkpoint), complete: true };
}

/** Cursor recovery moves backwards without resetting record identities or inferring deletions. */
export async function* acquire(input: Acquisition): AsyncGenerator<SyncPage> {
  const { context } = input;
  let checkpoint = context.checkpoint;
  try {
    for await (const page of discover(input)) {
      checkpoint = page.checkpoint;
      yield page;
    }
  } catch (error) {
    if (!(error instanceof ExpiredCursor)) {
      throw error;
    }
    yield {
      deliverable: { records: [] },
      complete: false,
      checkpoint: {
        ...checkpointSchema.parse(checkpoint),
        cursor: null,
      },
    };
  }
}
