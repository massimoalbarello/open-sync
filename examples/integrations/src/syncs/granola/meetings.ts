import type { SyncContext, SyncStep } from '@context-use/open-sync/definition';
import type { SyncRecord } from '@context-use/open-sync/delivery';
import { checkpointSchema, responseSchema } from './models';

const batchSize = 10;

export async function step(context: SyncContext): Promise<SyncStep> {
  let { remainingIds } = checkpointSchema.parse(context.checkpoint);
  if (remainingIds === null) {
    const result = responseSchema.parse(
      await context.provider.action({ id: 'granola.list_meetings', input: {} }),
    );
    remainingIds = [...new Set(result.meetings.map((meeting) => meeting.id))];
  }
  if (remainingIds.length) {
    context.signal.throwIfAborted();
    const ids = remainingIds.slice(0, batchSize);
    const result = responseSchema.parse(
      await context.provider.action({ id: 'granola.get_meetings', input: { meeting_ids: ids } }),
    );
    const meetings = new Map(result.meetings.map((meeting) => [meeting.id, meeting]));
    if (meetings.size !== ids.length || ids.some((id) => !meetings.has(id))) {
      throw new Error('Granola returned an incomplete meeting batch.');
    }
    const records: SyncRecord[] = ids.map((id) => {
      const meeting = meetings.get(id)!;
      return {
        operation: 'upsert',
        kind: 'meeting',
        id,
        content: { format: 'markdown', body: meeting.summary ?? '' },
        ...(meeting.title ? { preview: meeting.title } : {}),
        data: {
          title: meeting.title,
          notes: meeting.summary ?? '',
          date: meeting.date ?? null,
          attendees: meeting.attendees ?? '',
        },
      };
    });
    remainingIds = remainingIds.slice(batchSize);
    return { deliverable: { records }, checkpoint: { remainingIds }, complete: false };
  }
  return {
    deliverable: { records: [] },
    checkpoint: { remainingIds: null },
    complete: true,
  };
}
