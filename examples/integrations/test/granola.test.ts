import { expect, test } from 'bun:test';
import { granolaMeetings } from '../src/syncs/granola/definition';
import { fixture, unused } from './fixture';

test('Granola checkpoints the remaining meeting IDs, survives restart and preserves notes absent from a later listing', async () => {
  const meetingCount = 11;
  const ids = [...Array(meetingCount).keys()].map(String);
  let visible = ids;
  let incomplete = false;
  const requested: string[][] = [];
  const f = await fixture({
    registration: granolaMeetings,
    provider: {
      get: unused,
      post: unused,
      action: ({ id, input }) => {
        if (id === 'granola.list_meetings') {
          return Promise.resolve({
            meetings: visible.map((id) => ({ id, title: `Meeting ${id}` })),
          });
        }
        const batch = input.meeting_ids as string[];
        requested.push(batch);
        return Promise.resolve({
          meetings: (incomplete ? [] : batch).map((id) => ({
            id,
            title: `Meeting ${id}`,
            summary: '## Decisions\nShip it.',
            date: '2026-09-19',
            attendees: 'Alice, Sam',
          })),
        });
      },
    },
  });
  try {
    await f.engine.tick();
    expect(f.saved.checkpoint).toEqual({ remainingIds: ['10'] });
    await f.restart();
    incomplete = true;
    await f.engine.tick();
    expect(f.saved.checkpoint).toEqual({ remainingIds: ['10'] });
    incomplete = false;
    f.queue();
    await f.finish();
    expect(requested.at(-1)).toEqual(['10']);
    expect(f.records).toHaveLength(ids.length);
    expect(f.records[0]).toMatchObject({
      kind: 'meeting',
      id: '0',
      preview: 'Meeting 0',
      data: {
        title: 'Meeting 0',
        notes: '## Decisions\nShip it.',
        date: '2026-09-19',
        attendees: 'Alice, Sam',
      },
    });
    visible = [];
    expect(f.records[0]).not.toHaveProperty('createdAt');
    expect(f.records[0]).not.toHaveProperty('updatedAt');
    expect(f.records[0]).not.toHaveProperty('occurredAt');
    f.queue();
    await f.finish();
    expect(f.records).toHaveLength(ids.length);
    expect(f.saved.status).toBe('succeeded');
  } finally {
    await f.close();
  }
});
