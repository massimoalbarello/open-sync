// Adapted from massimoalbarello/open-connector at 1d72cbfd7d7348eb64b9a2daaf6457de63f16f38.
import type { SyncContext, SyncPage } from '@open-sync/core/definition';
import { discoverPulls, nextRepository } from './discovery';
import { hydrate } from './hydrate';
import { ExpiredCursor } from './response';
import { beginCycle, checkpointSchema, finishCycle } from './state';

/** Creation-order backfill, overlapping update scans and daily full discussion reconciliation. */
async function* discover(context: SyncContext): AsyncGenerator<SyncPage> {
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
      const record = await hydrate({ context, id: edge.node.id });
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
export async function* run(context: SyncContext): AsyncGenerator<SyncPage> {
  try {
    yield* discover(context);
  } catch (error) {
    if (!(error instanceof ExpiredCursor)) {
      throw error;
    }
    yield {
      deliverable: { records: [] },
      complete: false,
      checkpoint: {
        ...checkpointSchema.parse(context.checkpoint),
        cursor: null,
        repositoryCursor: null,
        repositoryId: null,
      },
    };
  }
}
