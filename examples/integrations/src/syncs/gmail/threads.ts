import type { SyncContext, SyncStep } from '@context-use/open-sync/definition';
import type { SyncRecord } from '@context-use/open-sync/record';
import { z } from 'zod';
import { historyStart } from '../history';
import { discover } from './discovery';
import { configSchema, matchesLabels, selectedLabelIds, threadMatchesLabels } from './labels';
import { checkpointSchema, initialCheckpoint } from './models';
import { readProviderThread, withinHistory } from './provider-thread';
import { ExpiredPageToken, NotFound, request } from './request';
import { threadRecord } from './thread';

const millisecondsPerSecond = 1000;

export async function step(context: SyncContext): Promise<SyncStep> {
  const { checkpoint, oldest, labelIds } = await begin(context);
  let page: Awaited<ReturnType<typeof discover>>;
  try {
    page = await discover({ context, checkpoint, labelIds });
  } catch (error) {
    return { records: [], checkpoint: recover({ checkpoint, error }), complete: false };
  }

  const records: SyncRecord[] = [];
  for (const id of page.ids) {
    let thread: Awaited<ReturnType<typeof readProviderThread>>;
    try {
      if (labelIds.length && !(await threadMatchesLabels({ context, id, labelIds }))) {
        continue;
      }
      thread = await readProviderThread({ context, id });
    } catch (error) {
      // A definitive 404 is not a partial download. Preserve copies of unavailable threads.
      if (error instanceof NotFound) {
        continue;
      }
      throw error;
    }
    // The backfill query already selects the history window. History events include all ages.
    if (
      matchesLabels({ messages: thread.messages, labelIds }) &&
      (checkpoint.query !== null || withinHistory({ thread, oldest }))
    ) {
      records.push(await threadRecord({ thread, context, account: checkpoint.account! }));
    }
  }
  return {
    records,
    checkpoint: page.checkpoint,
    // Immediately follow backfill with history so changes during it are included in this poll.
    complete: page.complete,
  };
}

async function begin(context: SyncContext) {
  const now = new Date();
  const config = configSchema.parse(context.config);
  let checkpoint = checkpointSchema.parse(context.checkpoint);
  const profile = z
    .object({ emailAddress: z.string().min(1), historyId: z.string().regex(/^\d+$/) })
    .parse(await request({ context, path: '/users/me/profile' }));
  if (checkpoint.account && checkpoint.account !== profile.emailAddress) {
    throw new Error('Gmail account changed. Create a new sync.');
  }
  const oldest = historyStart({ config: { history: config.history ?? 'All' }, now });
  const labelIds = await selectedLabelIds({ context, names: config.labels ?? [] });
  checkpoint = { ...checkpoint, account: profile.emailAddress };
  if (checkpoint.historyId === null) {
    // Save the mailbox token before discovery, not the token observed at backfill completion.
    checkpoint = {
      ...checkpoint,
      historyId: profile.historyId,
      query: `${oldest ? `after:${Math.floor(oldest.getTime() / millisecondsPerSecond)} ` : ''}before:${Math.ceil(now.getTime() / millisecondsPerSecond)}`,
    };
  }
  return { checkpoint, oldest, labelIds };
}

function recover(input: { checkpoint: z.infer<typeof checkpointSchema>; error: unknown }) {
  const { checkpoint, error } = input;
  if (error instanceof ExpiredPageToken && checkpoint.pageToken) {
    return { ...checkpoint, pageToken: null };
  }
  if (error instanceof NotFound && checkpoint.query === null) {
    // An expired history token requires a fresh backfill; no periodic reconciliation timer.
    return { ...initialCheckpoint, account: checkpoint.account };
  }
  throw error;
}
