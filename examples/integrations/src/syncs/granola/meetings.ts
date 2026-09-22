import type { SyncContext, SyncStep } from '@context-use/open-sync/definition';
import type { SyncRecord } from '@context-use/open-sync/record';
import { checkpointSchema, responseSchema } from './models';

// The connector limits get_meetings to ten IDs per request, not ten records per step.
const detailRequestLimit = 10;

export async function step(context: SyncContext): Promise<SyncStep> {
  checkpointSchema.parse(context.checkpoint);
  context.signal.throwIfAborted();
  const listing = responseSchema.parse(
    await context.provider.action({ id: 'granola.list_meetings', input: {} }),
  );
  // This OAuth MCP action has no native continuation. Finish its entire listing before yielding.
  const meetingIds = [...new Set(listing.meetings.map((meeting) => meeting.id))].sort();
  const records: SyncRecord[] = [];
  for (let offset = 0; offset < meetingIds.length; offset += detailRequestLimit) {
    context.signal.throwIfAborted();
    const ids = meetingIds.slice(offset, offset + detailRequestLimit);
    const result = responseSchema.parse(
      await context.provider.action({ id: 'granola.get_meetings', input: { meeting_ids: ids } }),
    );
    const meetings = new Map(result.meetings.map((meeting) => [meeting.id, meeting]));
    if (
      result.meetings.length !== ids.length ||
      meetings.size !== ids.length ||
      ids.some((id) => !meetings.has(id))
    ) {
      throw new Error('Granola returned an incomplete meeting batch.');
    }
    records.push(
      ...ids.map((id): SyncRecord => {
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
      }),
    );
  }
  return {
    deliverable: { records },
    checkpoint: {},
    complete: true,
  };
}
