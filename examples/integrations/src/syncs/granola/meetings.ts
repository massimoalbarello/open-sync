import type { SyncContext, SyncStep } from '@context-use/open-sync/definition';
import type { SyncRecord } from '@context-use/open-sync/delivery';
import { checkpointSchema, responseSchema } from './models';

const batchSize = 10;

export async function step(context: SyncContext): Promise<SyncStep> {
  const { afterId } = checkpointSchema.parse(context.checkpoint);
  const listing = responseSchema.parse(
    await context.provider.action({ id: 'granola.list_meetings', input: {} }),
  );
  // The provider exposes a listing, not a pagination token. Resume by stable ID, never an array offset.
  const remaining = [...new Set(listing.meetings.map((meeting) => meeting.id))]
    .sort()
    .filter((id) => afterId === null || id > afterId);
  const ids = remaining.slice(0, batchSize);
  if (ids.length) {
    context.signal.throwIfAborted();
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
    const complete = ids.length === remaining.length;
    return {
      deliverable: { records },
      checkpoint: { afterId: complete ? null : ids.at(-1)! },
      complete,
    };
  }
  return {
    deliverable: { records: [] },
    checkpoint: { afterId: null },
    complete: true,
  };
}
