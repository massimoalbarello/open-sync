// Adapted from massimoalbarello/open-connector at 1d72cbfd7d7348eb64b9a2daaf6457de63f16f38.
import type { SyncContext, SyncPage } from '@open-sync/core/definition';
import type { SyncRecord } from '@open-sync/core/delivery';
import { discoverPulls, nextRepository } from './discovery';
import { ExpiredCursor } from './response';
import { beginCycle, checkpointSchema, finishCycle } from './state';

type Acquisition = {
  context: SyncContext;
  readRecord(input: { context: SyncContext; id: string }): Promise<SyncRecord>;
};

/** Creation-order backfill, overlapping update scans and daily full discussion reconciliation. */
async function* discover(input: Acquisition): AsyncGenerator<SyncPage> {
  const { context } = input;
  let checkpoint = await beginCycle(context);
  const accessible = context.config.scope === 'accessible';
  const seen = new Set<string>(
    checkpoint.cursor ? [`${checkpoint.repositoryId}:${checkpoint.cursor}`] : [],
  );
  const repositories = new Set<string>(
    checkpoint.repositoryCursor ? [checkpoint.repositoryCursor] : [],
  );
  while (true) {
    context.signal.throwIfAborted();
    if (accessible && !checkpoint.repositoryId) {
      const next = await nextRepository({ context, checkpoint, seen: repositories });
      if (next === null) {
        break;
      }
      checkpoint = next;
    }
    const page = await discoverPulls({ context, checkpoint, seen });
    for (const edge of page.edges) {
      const record = await input.readRecord({ context, id: edge.node.id });
      checkpoint = { ...checkpoint, cursor: edge.cursor };
      yield { deliverable: { records: [record] }, checkpoint, complete: false };
    }
    if (page.more) {
      continue;
    }
    if (!accessible) {
      break;
    }
    checkpoint = { ...checkpoint, cursor: null, repositoryId: null };
    yield { deliverable: { records: [] }, checkpoint, complete: false };
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
        repositoryCursor: null,
        repositoryId: null,
      },
    };
  }
}
